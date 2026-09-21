"""Integration tests for source preservation and the local inspection API."""

from __future__ import annotations

import hashlib
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import threading

import numpy as np
import pytest
import soundfile as sf

from click_detector.web import ScanState, UIServer, preview_audio, waveform, waveform_overview


@pytest.fixture
def recording(tmp_path: Path) -> Path:
    sr = 48_000
    mono = (0.2 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype(np.float32)
    stereo = np.column_stack((mono, mono))
    stereo[19_000:19_008, 1] = 0
    path = tmp_path / "Guitar #01.aif"
    sf.write(path, stereo, sr, format="AIFF", subtype="PCM_24")
    return path


def scan(path: Path) -> ScanState:
    state = ScanState()
    state.start(str(path), "conservative")
    assert state.worker is not None
    state.worker.join(timeout=10)
    assert not state.worker.is_alive()
    return state


def test_scan_waveform_preview_preserves_source(recording: Path) -> None:
    before = hashlib.sha256(recording.read_bytes()).hexdigest()
    state = scan(recording)
    summary = state.snapshot()
    assert summary["status"] == "done"
    assert summary["completed"] == summary["total"] == 1
    result = next(iter(state.results.values()))
    assert len(result.events) == 1
    event = result.events[0]
    assert event.channels == (2,)
    window = waveform(result, event)
    index = event.sample_index - window["start_sample"]
    assert len(window["channels"]) == 2
    assert window["channels"][1][index:index + 8] == [0.0] * 8
    assert any(window["channels"][0][index:index + 8])
    data, sr = sf.read(io.BytesIO(preview_audio(result, event)), always_2d=True)
    assert sr == 48_000 and data.shape[1] == 2
    assert len(data) <= 2 * sr + 1
    assert hashlib.sha256(recording.read_bytes()).hexdigest() == before
    assert "files" not in state.snapshot(summary["revision"])


def test_directory_continues_after_corrupt_file(recording: Path) -> None:
    (recording.parent / "broken.wav").write_bytes(b"not audio")
    state = scan(recording.parent)
    snapshot = state.snapshot()
    assert snapshot["status"] == "done"
    assert snapshot["total"] == snapshot["completed"] == 2
    assert len(snapshot["files"]) == 1
    assert "broken.wav" in snapshot["errors"][0]


@pytest.mark.parametrize("repaired", [False, True])
def test_preview_fades_only_edges(recording: Path, repaired: bool) -> None:
    original = recording.read_bytes()
    state = scan(recording)
    result = next(iter(state.results.values()))
    data, sr = sf.read(io.BytesIO(preview_audio(result, result.events[0], repaired)), always_2d=True)
    raw, _ = sf.read(recording, always_2d=True)
    fade = round(sr * .010)
    assert np.all(data[0] == 0) and np.all(data[-1] == 0)
    # The unaffected first channel retains its level throughout the interior.
    assert np.max(np.abs(data[fade:-fade, 0] - raw[fade:-fade, 0])) <= 1 / 32768
    assert np.max(np.abs(data[1:40, 0])) < np.max(np.abs(raw[1:40, 0]))
    assert recording.read_bytes() == original


def test_missing_input_and_empty_audio_are_reported(tmp_path: Path) -> None:
    missing = scan(tmp_path / "missing.aif").snapshot()
    assert missing["status"] == "error" and missing["errors"]
    path = tmp_path / "empty.wav"
    sf.write(path, np.empty(0), 48_000)
    empty = scan(path).snapshot()
    assert empty["status"] == "done"
    assert empty["files"][0]["events"] == []


@pytest.fixture
def http_ui(recording: Path):
    state = scan(recording)
    state.output_root = recording.parent / "exports"
    server = UIServer(0, state)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server, state
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def request(server: UIServer, method: str, path: str, body: str | None = None, headers: dict | None = None):
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    status, content_type, data = response.status, response.getheader("Content-Type"), response.read()
    connection.close()
    return status, content_type, data


def test_http_assets_and_actual_waveform(http_ui) -> None:
    server, state = http_ui
    status, content_type, data = request(server, "GET", "/")
    assert status == 200 and content_type.startswith("text/html")
    assert b'<div id="root"></div>' in data
    assert b"<title>Declick" in data and b'src="/app.js"' in data
    assert b"Click Detector" not in data
    for asset in ("/style.css", "/app.js"):
        assert request(server, "GET", asset)[0] == 200
    # The packaged local bundle supplies the React UI without a CDN or Node.
    assert b"Sample-level detail" in request(server, "GET", "/app.js")[2]
    result = next(iter(state.results.values()))
    status, _, data = request(server, "GET", f"/api/waveform?file={result.id}&event=0&context=20")
    assert status == 200
    assert json.loads(data)["center_sample"] == 19_000
    assert request(server, "GET", "/api/report.csv")[0] == 404
    assert request(server, "GET", f"/api/audio?file={result.id}&event=0")[2][:4] == b"RIFF"


def test_browser_file_import_is_a_separate_identical_copy(http_ui, recording: Path) -> None:
    server, state = http_ui
    original = recording.read_bytes()
    headers = {"Content-Type": "application/octet-stream", "X-Filename": "Picked%20audio.aif"}
    status, _, body = request(server, "POST", "/api/import", original, headers)
    assert status == 202
    imported = Path(json.loads(body)["path"])
    assert imported != recording and imported.name == "Picked audio.aif"
    assert imported.read_bytes() == original == recording.read_bytes()
    state.worker.join(timeout=10)
    assert state.snapshot()["status"] == "done"
    for name in ["../escape.aif", "%2Ftmp%2Fescape.aif", "bad.txt", "bad%00.aif"]:
        status, _, _ = request(server, "POST", "/api/import", original, {**headers, "X-Filename": name})
        assert status == 400
    assert request(server, "POST", "/api/import", b"not audio", headers)[0] == 400
    assert request(server, "POST", "/api/import", original, {**headers, "Origin": "https://example.com"})[0] == 403


def test_http_rejects_invalid_and_cross_origin_requests(http_ui) -> None:
    server, state = http_ui
    result = next(iter(state.results.values()))
    assert request(server, "GET", "/api/state", headers={"Host": "untrusted.example"})[0] == 403
    assert request(server, "POST", "/api/scan", "{}", {"Origin": "https://untrusted.example", "Content-Type": "application/json"})[0] == 403
    assert request(server, "POST", "/api/scan", "{}", {"Content-Type": "text/plain"})[0] == 415
    assert request(server, "POST", "/api/scan", "[]", {"Content-Type": "application/json"})[0] == 400
    assert request(server, "GET", f"/api/waveform?file={result.id}&event=0&context=9000")[0] == 400
    assert request(server, "GET", "/api/waveform?file=stale&event=0")[0] == 404
    assert request(server, "GET", "/../../pyproject.toml")[0] == 404


def test_scan_api_and_busy_state(http_ui, recording: Path) -> None:
    server, state = http_ui
    with state.lock:
        state.status = "scanning"
    payload = json.dumps({"path": str(recording), "sensitivity": "conservative"})
    assert request(server, "POST", "/api/scan", payload, {"Content-Type": "application/json"})[0] == 409
    with state.lock:
        state.status = "done"
    assert request(server, "POST", "/api/scan", payload, {"Content-Type": "application/json"})[0] == 202
    state.worker.join(timeout=10)
    assert state.status == "done"


def test_repair_api_export_download_and_preview(http_ui, recording: Path) -> None:
    server, state = http_ui
    digest = hashlib.sha256(recording.read_bytes()).hexdigest()
    result = next(iter(state.results.values()))
    status, _, data = request(server, "GET", f"/api/waveform?file={result.id}&event=0")
    preview = json.loads(data)
    center = preview["center_sample"] - preview["start_sample"]
    assert status == 200 and any(preview["repaired_channels"][1][center:center + 8])
    assert preview["repaired_channels"][0] == preview["channels"][0]
    payload = json.dumps({"file": result.id, "selected": [0]})
    status, _, data = request(server, "POST", "/api/repair", payload, {"Content-Type": "application/json"})
    report = json.loads(data)
    assert status == 201 and report["repaired_candidates"] == 1
    assert Path(report["output"]).is_file()
    assert request(server, "GET", report["download_url"])[2] == Path(report["output"]).read_bytes()
    assert request(server, "GET", report["report_url"])[0] == 200
    assert hashlib.sha256(recording.read_bytes()).hexdigest() == digest
    assert request(server, "GET", f"/api/audio?file={result.id}&event=0&repaired=1")[2][:4] == b"RIFF"


def test_repair_api_requires_explicit_valid_selections(http_ui) -> None:
    server, state = http_ui
    result = next(iter(state.results.values()))
    for selection in [[], None, "all", [True], [100]]:
        payload = json.dumps({"file": result.id, "selected": selection})
        assert request(server, "POST", "/api/repair", payload, {"Content-Type": "application/json"})[0] == 400
    assert not state.output_root.exists()


@pytest.mark.parametrize("frames", [0, 1, 17, 2048, 2051, 48000])
def test_overview_bounds_and_channel_extrema(frames: int) -> None:
    mono = np.linspace(0.1, 0.9, frames, dtype=np.float32)
    samples = np.column_stack((mono, -mono))
    overview = waveform_overview(samples)
    assert overview["frames"] == frames
    assert len(overview["buckets"]) == min(frames, 2048)
    edges = np.linspace(0, frames, min(frames, 2048) + 1, dtype=np.int64)
    for (lo, hi), bucket in zip(zip(edges[:-1], edges[1:]), overview["buckets"]):
        assert bucket == [float(samples[lo:hi].min()), float(samples[lo:hi].max())]
        assert bucket[0] < 0 < bucket[1]  # Opposite channels must not cancel.


def test_overview_silence_and_boundary_peaks() -> None:
    samples = np.zeros((48000, 1), dtype=np.float32)
    assert all(bucket == [0.0, 0.0] for bucket in waveform_overview(samples)["buckets"])
    samples[0, 0], samples[-1, 0] = -0.75, 0.5
    overview = waveform_overview(samples)
    assert overview["buckets"][0] == [-0.75, 0.0]
    assert overview["buckets"][-1] == [0.0, 0.5]


def test_scan_publishes_bounded_overview(recording: Path) -> None:
    original = recording.read_bytes()
    result = scan(recording).snapshot()["files"][0]
    assert result["overview"]["frames"] == 48000
    assert len(result["overview"]["buckets"]) == 2048
    assert recording.read_bytes() == original
