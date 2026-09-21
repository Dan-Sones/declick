"""Loopback-only UI with background scans and read-only waveform previews."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import tempfile
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid
import webbrowser

import numpy as np
import soundfile as sf

from .analysis import AudioStats, analyse_audio
from .audio import discover_audio_files, read_audio
from .detector import Detection, Sensitivity, detect_array
from .reporting import format_timestamp
from .repair import (
    RepairError, export_repaired_copy, file_hash, pcm_layout, plan_repairs, repair_reason,
)


def waveform_overview(samples: np.ndarray) -> dict[str, Any]:
    """Retain a bounded envelope, including peaks on every channel."""
    frames = len(samples)
    count = min(frames, 2048)
    if not count:
        return {"frames": 0, "buckets": []}
    edges = np.linspace(0, frames, count + 1, dtype=np.int64)
    buckets = [
        [float(samples[lo:hi].min()), float(samples[lo:hi].max())]
        for lo, hi in zip(edges[:-1], edges[1:])
    ]
    return {"frames": frames, "buckets": buckets}


@dataclass(frozen=True)
class ScanResult:
    id: str
    path: Path
    stats: AudioStats
    events: list[Detection]
    sha256: str
    repair_error: str | None = None
    overview: dict[str, Any] | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.path.name,
            "path": str(self.path),
            "stats": asdict(self.stats),
            "sha256": self.sha256,
            **({"overview": self.overview} if self.overview is not None else {}),
            "repair_error": self.repair_error,
            "events": [
                {
                    "id": index,
                    "sample_index": event.sample_index,
                    "seconds": event.seconds(self.stats.sample_rate),
                    "timestamp": format_timestamp(event.seconds(self.stats.sample_rate)),
                    "channels": event.channels,
                    "confidence": event.confidence,
                    "level": event.confidence_level,
                    "duration_samples": event.duration_samples,
                    "duration_ms": event.duration_ms(self.stats.sample_rate),
                    "kind": event.kind,
                    "evidence": event.evidence,
                    "spans": event.spans,
                    "repair_error": self.repair_error or repair_reason(event, self.stats.frames),
                }
                for index, event in enumerate(self.events)
            ],
        }


class ScanState:
    """One scan at a time; retain metadata, never whole session audio."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status = "idle"
        self.path = ""
        self.sensitivity = "conservative"
        self.current = ""
        self.completed = 0
        self.total = 0
        self.revision = 0
        self.errors: list[str] = []
        self.results: dict[str, ScanResult] = {}
        self.worker: threading.Thread | None = None
        self.output_root = Path("repaired-audio")
        self.exports: dict[str, dict] = {}
        self.export_lock = threading.Lock()

    def start(self, path: str, sensitivity: str) -> None:
        if not isinstance(path, str) or not path.strip():
            raise ValueError("Enter the full path to an audio file or session folder.")
        Sensitivity(sensitivity)
        with self.lock:
            if self.status == "scanning":
                raise RuntimeError("A scan is already running.")
            self.path = path.strip()
            self.sensitivity = sensitivity
            self.status = "scanning"
            self.current = "Finding audio files…"
            self.completed = self.total = 0
            self.errors = []
            self.results = {}
            self.revision += 1
            self.worker = threading.Thread(target=self._scan, daemon=True)
            self.worker.start()

    def _scan(self) -> None:
        try:
            paths = discover_audio_files([Path(self.path)])
            if not paths:
                raise ValueError("No WAV or AIFF files were found in that folder.")
            with self.lock:
                self.total = len(paths)
            for path in paths:
                with self.lock:
                    self.current = path.name
                try:
                    digest = file_hash(path)
                    audio = read_audio(path)
                    # Reject nonfinite data before computing report statistics.
                    events = detect_array(
                        audio.data, audio.sample_rate, file=path, sensitivity=self.sensitivity
                    )
                    if file_hash(path) != digest:
                        raise ValueError("Source changed during the scan. Scan again.")
                    repair_error = None
                    try:
                        pcm_layout(path)
                    except RepairError as exc:
                        repair_error = str(exc)
                    result = ScanResult(
                        uuid.uuid4().hex, path, analyse_audio(audio), events, digest,
                        repair_error, waveform_overview(audio.data),
                    )
                    del audio
                    with self.lock:
                        self.results[result.id] = result
                        self.revision += 1
                except (OSError, RuntimeError, ValueError) as exc:
                    with self.lock:
                        self.errors.append(f"{path.name}: {exc}")
                with self.lock:
                    self.completed += 1
        except (OSError, RuntimeError, ValueError) as exc:
            with self.lock:
                self.errors.append(str(exc))
        finally:
            with self.lock:
                self.status = "done" if self.results else "error"
                self.current = ""
                self.revision += 1

    def snapshot(self, after_revision: int = -1) -> dict[str, Any]:
        with self.lock:
            snapshot: dict[str, Any] = {
                "status": self.status,
                "path": self.path,
                "sensitivity": self.sensitivity,
                "current": self.current,
                "completed": self.completed,
                "total": self.total,
                "revision": self.revision,
                "errors": list(self.errors),
            }
            if after_revision != self.revision:
                snapshot["files"] = [result.summary() for result in self.results.values()]
            return snapshot

    def event(self, file_id: str, event_id: int) -> tuple[ScanResult, Detection]:
        with self.lock:
            result = self.results.get(file_id)
            if result is None or not 0 <= event_id < len(result.events):
                raise KeyError("That candidate is no longer available. Select a current candidate.")
            return result, result.events[event_id]

    def repair(self, file_id: str, selected: list[int]) -> dict:
        if not self.export_lock.acquire(blocking=False):
            raise RuntimeError("An export is already running.")
        try:
            with self.lock:
                if self.status == "scanning":
                    raise RuntimeError("Wait for the scan to finish before exporting.")
                result = self.results.get(file_id)
            if result is None:
                raise RepairError("Select a recording from the current scan.")
            if result.repair_error:
                raise RepairError(result.repair_error)
            if not isinstance(selected, list):
                raise RepairError("Expected a list of selected candidate IDs.")
            report = export_repaired_copy(result.path, result.events, selected, self.output_root, result.sha256)
            export_id = uuid.uuid4().hex
            with self.lock:
                self.exports[export_id] = report
            return {**report, "download_url": f"/api/download?id={export_id}", "report_url": f"/api/download?id={export_id}&report=1"}
        finally:
            self.export_lock.release()


def read_window(result: ScanResult, event: Detection, radius: int) -> tuple[np.ndarray, int]:
    """Read only a small window, preserving channels and exact sample coordinates."""
    lo = max(0, event.sample_index - radius)
    hi = min(result.stats.frames, event.sample_index + radius + 1)
    with sf.SoundFile(result.path, mode="r") as source:
        if (
            source.samplerate != result.stats.sample_rate
            or source.frames != result.stats.frames
            or source.channels != result.stats.channels
        ):
            raise ValueError("The audio file changed since the scan. Scan it again.")
        source.seek(lo)
        samples = source.read(hi - lo, dtype="float32", always_2d=True)
    if not np.isfinite(samples).all():
        raise ValueError("The audio window contains nonfinite samples.")
    return samples, lo


def waveform(result: ScanResult, event: Detection, context_ms: int = 50) -> dict[str, Any]:
    radius = round(result.stats.sample_rate * context_ms / 2000)
    samples, start = read_window(result, event, radius)
    payload = {
        "start_sample": start,
        "sample_rate": result.stats.sample_rate,
        "center_sample": event.sample_index,
        "channels": samples.T.tolist(),
    }
    if not result.repair_error and not repair_reason(event, result.stats.frames):
        try:
            # Compare the source stat before/after preview; export performs full hashes.
            before = result.path.stat()
            event_id = next(i for i, candidate in enumerate(result.events) if candidate is event)
            repaired = samples.copy()
            for patch in plan_repairs(result.path, result.events, [event_id]):
                lo, hi = patch.start - start, patch.end - start + 1
                repaired[lo:hi, patch.channel - 1] = patch.values
            if before.st_mtime_ns != result.path.stat().st_mtime_ns:
                raise RepairError("Source changed while loading the preview.")
            payload["repaired_channels"] = repaired.T.tolist()
        except RepairError as exc:
            payload["repair_error"] = str(exc)
    return payload


def preview_audio(result: ScanResult, event: Detection, repaired: bool = False) -> bytes:
    # Two seconds of unnormalised audio; the source is never opened for writing.
    samples, start = read_window(result, event, result.stats.sample_rate)
    if repaired:
        if result.repair_error:
            raise RepairError(result.repair_error)
        event_id = next(i for i, candidate in enumerate(result.events) if candidate is event)
        for patch in plan_repairs(result.path, result.events, [event_id]):
            samples[patch.start - start:patch.end - start + 1, patch.channel - 1] = patch.values
    # Listening-only 10 ms raised-cosine fades. Never touch the source, graphs,
    # or repair export; keep the middle of the preview at its original level.
    fade_frames = min(round(result.stats.sample_rate * 0.010), len(samples) // 2)
    if fade_frames:
        ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade_frames)))[:, None]
        samples[:fade_frames] *= ramp
        samples[-fade_frames:] *= ramp[::-1]
    output = io.BytesIO()
    sf.write(output, samples, result.stats.sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


class UIServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, state: ScanState) -> None:
        self.state = state
        super().__init__(("127.0.0.1", port), UIHandler)
        self.authorities = {f"127.0.0.1:{self.server_port}", f"localhost:{self.server_port}"}


class UIHandler(BaseHTTPRequestHandler):
    server: UIServer

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'",
        )
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, payload: Any, status: int = 200) -> None:
        self._send(json.dumps(payload, allow_nan=False).encode(), "application/json", status)

    def _download(self, export_id: str, report: bool) -> None:
        with self.server.state.lock:
            exported = self.server.state.exports.get(export_id)
        if exported is None:
            raise KeyError("Export not found.")
        path = Path(exported["report" if report else "output"])
        with path.open("rb") as source:
            self.send_response(200)
            self.send_header("Content-Type", "application/json" if report else "application/octet-stream")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(path.name)}")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                while block := source.read(1024 * 1024):
                    self.wfile.write(block)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _local_request(self) -> bool:
        if self.headers.get("Host") not in self.server.authorities:
            self._json({"error": "Use the local UI address printed in the terminal."}, 403)
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in self.server.authorities}:
            self._json({"error": "Cross-origin access is not allowed."}, 403)
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self._json({"error": "Cross-site access is not allowed."}, 403)
            return False
        return True

    def do_GET(self) -> None:
        if not self._local_request():
            return
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == "/api/state":
                self._json(self.server.state.snapshot(int(query.get("revision", ["-1"])[0])))
            elif url.path == "/api/download":
                self._download(query.get("id", [""])[0], query.get("report", ["0"])[0] == "1")
            elif url.path in {"/api/waveform", "/api/audio"}:
                result, event = self.server.state.event(
                    query.get("file", [""])[0], int(query.get("event", ["-1"])[0])
                )
                if url.path == "/api/audio":
                    self._send(preview_audio(result, event, query.get("repaired", ["0"])[0] == "1"), "audio/wav")
                else:
                    context = int(query.get("context", ["50"])[0])
                    if context not in {20, 50, 100}:
                        raise ValueError("Context must be 20, 50, or 100 ms.")
                    self._json(waveform(result, event, context))
            else:
                assets = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
                if url.path not in assets:
                    self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
                    return
                name, content_type = assets[url.path]
                self._send((Path(__file__).parent / "static" / name).read_bytes(), content_type + "; charset=utf-8")
        except KeyError as exc:
            self._json({"error": str(exc).strip("'")}, 404)
        except (OSError, RuntimeError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)

    def do_POST(self) -> None:
        if not self._local_request():
            return
        if self.path == "/api/import":
            self._import_audio()
            return
        if self.path not in {"/api/scan", "/api/repair"}:
            self._json({"error": "Not found"}, 404)
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self._json({"error": "Expected JSON"}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16_384:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Expected an object")
            if self.path == "/api/repair":
                if not isinstance(payload.get("file"), str):
                    raise ValueError("Choose a recording to export.")
                self._json(self.server.state.repair(payload["file"], payload.get("selected")), 201)
                return
            sensitivity = payload.get("sensitivity", "conservative")
            if not isinstance(sensitivity, str):
                raise ValueError("Invalid sensitivity")
            self.server.state.start(payload.get("path", ""), sensitivity)
            self._json({"status": "scanning"}, 202)
        except (OSError, ValueError, TypeError, UnicodeDecodeError) as exc:
            self._json({"error": str(exc)}, 400)
        except RuntimeError as exc:
            self._json({"error": str(exc)}, 409)

    def _import_audio(self) -> None:
        """Receive a browser-selected file into a unique local working copy."""
        path = None
        try:
            if self.headers.get("Content-Type") != "application/octet-stream":
                raise ValueError("Expected an audio file.")
            name = unquote(self.headers.get("X-Filename", ""))
            if not name or Path(name).name != name or "\\" in name or "\0" in name or Path(name).suffix.lower() not in {".aif", ".aiff", ".wav", ".aifc"}:
                raise ValueError("Choose a WAV or AIFF file.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 2 * 1024**3:
                raise ValueError("Choose a file smaller than 2 GiB.")
            root = self.server.state.output_root / "imports"
            root.mkdir(parents=True, exist_ok=True)
            path = Path(tempfile.mkdtemp(prefix="audio-", dir=root)) / name
            with path.open("xb") as target:
                remaining = length
                while remaining:
                    block = self.rfile.read(min(remaining, 1024 * 1024))
                    if not block:
                        raise ValueError("Incomplete file transfer.")
                    target.write(block)
                    remaining -= len(block)
            sf.info(path)
            self.server.state.start(str(path), "conservative")
            self._json({"status": "scanning", "path": str(path)}, 202)
        except (OSError, ValueError, RuntimeError) as exc:
            if path is not None:
                path.unlink(missing_ok=True)
                path.parent.rmdir()
            self._json({"error": str(exc)}, 400)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open Declick, the local audio repair and waveform inspector.")
    parser.add_argument("path", nargs="?", help="Optional audio file or session folder to scan on launch")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="Print the URL without opening a browser")
    parser.add_argument("--output-dir", type=Path, default=Path("repaired-audio"), help="Directory for new repaired copies and verification reports")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    state = ScanState()
    state.output_root = args.output_dir.expanduser().resolve()
    try:
        server = UIServer(args.port, state)
    except OSError as exc:
        parser.exit(1, f"Could not start local UI: {exc}. Try a different --port.\n")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Declick → {url}\nPress Ctrl+C to stop.", flush=True)
    if args.path:
        state.start(args.path, "conservative")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
