"""Repair invariants: new files, identical metadata, and precisely bounded changes."""

from __future__ import annotations

import json
from pathlib import Path
import struct

import numpy as np
import pytest
import soundfile as sf

from click_detector.detector import Detection
from click_detector.repair import (
    RepairError, encode_sample, encoded_patches, export_repaired_copy, file_hash,
    interpolate_gap, pcm_layout, plan_repairs, verify_copy,
)


def candidate(start: int, channel: int = 1, length: int = 8) -> Detection:
    return Detection(None, start, (channel,), .99, length, "exact-zero dropout", {}, ((channel, start, start + length - 1),))


def make_recording(tmp_path: Path, format: str = "AIFF", subtype: str = "PCM_24") -> Path:
    signal = .4 * np.sin(2 * np.pi * 440 * np.arange(4800) / 48000 + .6)
    audio = np.column_stack([signal, signal * .5])
    audio[1000:1008, 0] = 0
    audio[3000:3008, 1] = 0
    source = tmp_path / ("Guitar #01.aif" if format == "AIFF" else "Guitar #01.wav")
    sf.write(source, audio, 48000, format=format, subtype=subtype)
    return source


@pytest.mark.parametrize("format,subtype", [
    ("AIFF", "PCM_S8"), ("WAV", "PCM_U8"),
    ("AIFF", "PCM_16"), ("WAV", "PCM_16"),
    ("AIFF", "PCM_24"), ("WAV", "PCM_24"),
    ("AIFF", "PCM_32"), ("WAV", "PCM_32"), ("WAVEX", "PCM_24"),
])
def test_selective_export_preserves_all_other_bytes(tmp_path: Path, format: str, subtype: str) -> None:
    source = make_recording(tmp_path, format, subtype)
    original = source.read_bytes()
    digest = file_hash(source)
    events = [candidate(1000), candidate(3000, 2)]
    report = export_repaired_copy(source, events, [0], tmp_path / "exports", digest)
    output = Path(report["output"])
    before, sr = sf.read(source, dtype="float64", always_2d=True)
    after, out_sr = sf.read(output, dtype="float64", always_2d=True)
    assert sr == out_sr == 48000 and before.shape == after.shape
    assert sf.info(source).subtype == sf.info(output).subtype == subtype
    assert np.array_equal(before[:, 1], after[:, 1])
    assert np.array_equal(before[:1000], after[:1000])
    assert np.array_equal(before[1008:], after[1008:])
    assert np.any(after[1000:1008, 0] != 0)
    assert source.read_bytes() == original
    assert report["verified_outside_repairs_identical"] and report["verified_source_unchanged"]
    assert report["patched_channel_samples"] == 8
    assert json.loads(Path(report["report"]).read_text())["selected_event_ids"] == [0]
    layout = pcm_layout(source)
    changed = {i for i, (a, b) in enumerate(zip(original, output.read_bytes(), strict=True)) if a != b}
    allowed = {layout.offset + (sample * 2) * layout.width + byte for sample in range(1000, 1008) for byte in range(layout.width)}
    assert changed and changed <= allowed


def test_aiff_markers_and_unknown_chunks_survive(tmp_path: Path) -> None:
    source = make_recording(tmp_path)
    raw = bytearray(source.read_bytes())
    for tag, body in [(b"MARK", struct.pack(">HHI", 1, 7, 3000) + b"\x01A"), (b"ANNO", b"Session annotation"), (b"CSTM", b"odd")]:
        raw.extend(tag + len(body).to_bytes(4, "big") + body + (b"\0" if len(body) % 2 else b""))
    raw[4:8] = (len(raw) - 8).to_bytes(4, "big")
    source.write_bytes(raw)
    report = export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", file_hash(source))
    updated = Path(report["output"]).read_bytes()
    assert updated[-60:] == raw[-60:]
    assert b"Session annotation" in updated and b"CSTM" in updated and b"MARK" in updated


def test_aifc_little_endian_and_ssnd_offset(tmp_path: Path) -> None:
    source = tmp_path / "little.aif"
    data = .3 * np.sin(np.arange(4800) * .04 + .4)
    data[1000:1008] = 0
    sf.write(source, data, 48000, format="AIFF", subtype="PCM_16", endian="LITTLE")
    raw = bytearray(source.read_bytes())
    position = raw.index(b"SSND")
    size = int.from_bytes(raw[position + 4:position + 8], "big")
    raw[position + 4:position + 8] = (size + 4).to_bytes(4, "big")
    raw[position + 8:position + 12] = (4).to_bytes(4, "big")
    raw[position + 16:position + 16] = b"PAD!"
    raw[4:8] = (len(raw) - 8).to_bytes(4, "big")
    source.write_bytes(raw)
    layout = pcm_layout(source)
    assert layout.byteorder == "little"
    report = export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", file_hash(source))
    updated = Path(report["output"]).read_bytes()
    assert updated[:layout.offset] == raw[:layout.offset]


@pytest.mark.parametrize("omit_padding", [False, True])
def test_odd_aiff_audio_with_metadata_tail(tmp_path: Path, omit_padding: bool) -> None:
    source = tmp_path / "odd.aif"
    data = .3 * np.sin(np.arange(4801) * .04 + .4)
    data[1000:1008] = 0
    sf.write(source, data, 48000, format="AIFF", subtype="PCM_24")
    raw = bytearray(source.read_bytes())
    ssnd = raw.index(b"SSND")
    # libsndfile may count its alignment byte in SSND; make the odd payload
    # length explicit so both fixtures exercise the same container variant.
    raw[ssnd + 4:ssnd + 8] = (8 + len(data) * 3).to_bytes(4, "big")
    end = ssnd + 8 + int.from_bytes(raw[ssnd + 4:ssnd + 8], "big")
    raw = raw[:end] + (b"" if omit_padding else b"\0")
    tail = b"MARK" + struct.pack(">I", 2) + b"\0\0" + b"LGWV" + struct.pack(">I", 4) + b"test"
    raw.extend(tail)
    raw[4:8] = (len(raw) - 8).to_bytes(4, "big")
    source.write_bytes(raw)
    digest = file_hash(source)
    assert pcm_layout(source).frames == 4801
    report = export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", digest)
    assert Path(report["output"]).read_bytes().endswith(tail)
    assert file_hash(source) == digest
    assert report["verified_outside_repairs_identical"]
    # A plausible MARK header must not hide an actually truncated following chunk.
    raw[-8:-4] = struct.pack(">I", 1000)
    source.write_bytes(raw)
    with pytest.raises(RepairError, match="Truncated audio chunk"):
        pcm_layout(source)


def test_interpolation_reduces_known_gap_error_and_does_not_overshoot() -> None:
    clean = .3 * np.sin(np.arange(128) * .03 + .5)
    damaged = clean.copy()
    damaged[50:58] = 0
    original = damaged.copy()
    predicted = interpolate_gap(damaged, 50, 57)
    assert np.mean((predicted - clean[50:58]) ** 2) < .01 * np.mean(clean[50:58] ** 2)
    assert min(clean[49], clean[58]) <= predicted.min() <= predicted.max() <= max(clean[49], clean[58])
    assert np.array_equal(damaged, original)


def test_staggered_stereo_repairs_use_each_channels_own_bounds(tmp_path: Path) -> None:
    source = make_recording(tmp_path)
    event = candidate(1000)
    event.channels = (1, 2)
    event.spans = ((1, 1000, 1007), (2, 3000, 3007))
    report = export_repaired_copy(source, [event], [0], tmp_path / "exports", file_hash(source))
    before, _ = sf.read(source, always_2d=True)
    after, _ = sf.read(report["output"], always_2d=True)
    mask = np.ones(before.shape, dtype=bool)
    mask[1000:1008, 0] = False
    mask[3000:3008, 1] = False
    assert np.array_equal(before[mask], after[mask])
    assert report["patched_channel_samples"] == 16


@pytest.mark.parametrize("selected", [[], [-1], [0, 0], ["0"], [True], [123]])
def test_invalid_selection_produces_no_output(tmp_path: Path, selected: list) -> None:
    source = make_recording(tmp_path)
    with pytest.raises(RepairError):
        export_repaired_copy(source, [candidate(1000)], selected, tmp_path / "exports", file_hash(source))
    assert not (tmp_path / "exports").exists()


def test_stale_source_refused_and_repeat_exports_never_overwrite(tmp_path: Path) -> None:
    source = make_recording(tmp_path)
    digest = file_hash(source)
    first = export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", digest)
    second = export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", digest)
    assert first["output"] != second["output"]
    assert Path(first["output"]).read_bytes() == Path(second["output"]).read_bytes()
    source.write_bytes(source.read_bytes() + b"changed")
    with pytest.raises(RepairError, match="changed since"):
        export_repaired_copy(source, [candidate(1000)], [0], tmp_path / "exports", digest)


def test_unsafe_bounds_overlap_and_float_encoding_are_refused(tmp_path: Path) -> None:
    source = make_recording(tmp_path)
    for ev in [candidate(1), candidate(1000, length=40), candidate(4795, length=5)]:
        with pytest.raises(RepairError):
            plan_repairs(source, [ev], [0])
    with pytest.raises(RepairError, match="overlap"):
        plan_repairs(source, [candidate(1000), candidate(1009)], [0])
    path = tmp_path / "float.wav"
    sf.write(path, np.zeros(100), 48000, subtype="FLOAT")
    with pytest.raises(RepairError, match="integer PCM"):
        pcm_layout(path)


def test_verification_rejects_changes_outside_repair(tmp_path: Path) -> None:
    source = make_recording(tmp_path)
    events = [candidate(1000)]
    layout = pcm_layout(source)
    encoded = encoded_patches(plan_repairs(source, events, [0]), layout)
    report = export_repaired_copy(source, events, [0], tmp_path / "exports", file_hash(source))
    output = Path(report["output"])
    with output.open("r+b") as handle:
        handle.seek(layout.offset)
        handle.write(encode_sample(.9, layout))
    with pytest.raises(RepairError, match="outside selected"):
        verify_copy(source, output, encoded)
