"""Repair explicitly selected short spans in a new, byte-preserving PCM copy.

Only selected sample bytes are patched. Container headers, ancillary chunks,
unselected audio, and the original file remain byte-for-byte unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import tempfile
from typing import BinaryIO

import numpy as np
from scipy.interpolate import PchipInterpolator
import soundfile as sf

from .detector import Detection


class RepairError(ValueError):
    """The requested copy cannot be repaired without violating its invariants."""


@dataclass(frozen=True)
class PCMLayout:
    offset: int
    data_size: int
    channels: int
    frames: int
    sample_rate: int
    bits: int
    byteorder: str
    unsigned: bool

    @property
    def width(self) -> int:
        return self.bits // 8


@dataclass(frozen=True)
class Patch:
    event_id: int
    channel: int
    start: int
    end: int
    values: np.ndarray


def file_hash(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def pcm_layout(path: Path) -> PCMLayout:
    """Find raw PCM without rewriting metadata; refuse unsupported encodings."""
    info = sf.info(path)
    if info.subtype not in {"PCM_S8", "PCM_U8", "PCM_16", "PCM_24", "PCM_32"}:
        raise RepairError("Repair export supports integer PCM AIFF/WAV only (8, 16, 24, or 32 bit).")
    size = path.stat().st_size
    with path.open("rb") as source:
        head = source.read(12)
        if len(head) != 12:
            raise RepairError("Truncated audio header.")
        aiff = head[:4] == b"FORM" and head[8:] in {b"AIFF", b"AIFC"}
        wave = head[:4] == b"RIFF" and head[8:] == b"WAVE"
        if not (aiff or wave):
            raise RepairError("Repair export supports AIFF/AIFF-C PCM and RIFF WAV. RF64 and other containers are not supported.")
        order = "big" if aiff else "little"
        boundary = int.from_bytes(head[4:8], order) + 8
        if boundary > size or boundary < 12:
            raise RepairError("Invalid container size.")
        fmt: bytes | None = None
        audio: tuple[int, int] | None = None
        position = 12

        def valid_metadata_tail(start: int) -> bool:
            """Validate a complete chunk chain before accepting omitted SSND padding."""
            while start < boundary:
                if start + 8 > boundary:
                    return False
                source.seek(start)
                header = source.read(8)
                if len(header) != 8 or not all(32 <= byte <= 126 for byte in header[:4]):
                    return False
                end = start + 8 + int.from_bytes(header[4:], order)
                if end > boundary:
                    return False
                start = end + ((end - start - 8) & 1)
            return start == boundary

        while position + 8 <= boundary:
            source.seek(position)
            tag = source.read(4)
            length = int.from_bytes(source.read(4), order)
            body = position + 8
            if body + length > boundary:
                raise RepairError("Truncated audio chunk.")
            if tag == (b"COMM" if aiff else b"fmt "):
                if fmt is not None:
                    raise RepairError("Multiple format chunks are ambiguous.")
                fmt = source.read(min(length, 64))
            if tag == (b"SSND" if aiff else b"data"):
                if audio is not None:
                    raise RepairError("Multiple audio chunks are not supported.")
                if aiff:
                    if length < 8:
                        raise RepairError("Truncated SSND header.")
                    offset = int.from_bytes(source.read(4), "big")
                    if offset > length - 8:
                        raise RepairError("Invalid SSND offset.")
                    audio = (body + 8 + offset, length - 8 - offset)
                else:
                    audio = (body, length)
            position = body + length + (length & 1)
            # Some Logic AIFFs place MARK immediately after odd-length SSND
            # data, omitting its alignment byte. Accept only a fully validated
            # metadata tail when the standard padded interpretation is invalid.
            # Do not rewrite or insert padding: export preserves the container.
            if aiff and tag == b"SSND" and length & 1:
                unpadded = body + length
                source.seek(unpadded)
                next_tag = source.read(4)
                if (
                    next_tag in {b"MARK", b"COMT", b"ANNO", b"INST", b"APPL", b"NAME", b"AUTH", b"LGWV", b"ResU"}
                    and not valid_metadata_tail(position)
                    and valid_metadata_tail(unpadded)
                ):
                    position = unpadded
        if fmt is None or audio is None:
            raise RepairError("Missing format or audio chunk.")

    if aiff:
        if len(fmt) < 18:
            raise RepairError("Truncated COMM chunk.")
        channels, frames, bits = struct.unpack(">HIH", fmt[:8])
        if head[8:] == b"AIFC":
            compression = fmt[18:22]
            if compression not in {b"NONE", b"sowt"}:
                raise RepairError("This AIFF-C encoding is not supported for repair.")
            order = "little" if compression == b"sowt" else "big"
    else:
        if len(fmt) < 16:
            raise RepairError("Truncated WAV format chunk.")
        code, channels, _, _, align, bits = struct.unpack("<HHIIHH", fmt[:16])
        if code == 0xFFFE:
            pcm_guid = bytes.fromhex("0100000000001000800000aa00389b71")
            if len(fmt) < 40 or fmt[24:40] != pcm_guid or int.from_bytes(fmt[18:20], "little") != bits:
                raise RepairError("Only full-width integer PCM WAVEX is supported.")
        elif code != 1:
            raise RepairError("Only integer PCM WAV is supported.")
        if align != channels * (bits // 8):
            raise RepairError("Unexpected PCM frame alignment.")
        frames = info.frames
    expected_bits = {"PCM_S8": 8, "PCM_U8": 8, "PCM_16": 16, "PCM_24": 24, "PCM_32": 32}[info.subtype]
    if bits != expected_bits or channels != info.channels or frames != info.frames:
        raise RepairError("Container metadata disagrees with the decoded audio.")
    if audio[1] < frames * channels * (bits // 8):
        raise RepairError("Audio data is shorter than declared.")
    return PCMLayout(audio[0], audio[1], channels, frames, info.samplerate, bits, order, info.subtype == "PCM_U8")


def repair_reason(event: Detection, frames: int) -> str | None:
    if not event.spans:
        return "Scan again to obtain exact repair bounds."
    for _, start, end in event.spans:
        if not 1 <= end - start + 1 <= 32:
            return "This event spans more than 32 samples; inspect and repair it manually."
        if start < 4 or end + 4 >= frames:
            return "Not enough surrounding audio to interpolate this event."
    return None


def interpolate_gap(samples: np.ndarray, start: int, end: int) -> np.ndarray:
    """Shape-preserving cubic interpolation from four clean samples on each side.

    PCHIP avoids overshooting the local boundary amplitudes. It estimates missing
    values; it cannot recover the exact original performance.
    """
    if start < 4 or end + 4 >= len(samples) or not 1 <= end - start + 1 <= 32:
        raise RepairError("Repair needs 1–32 samples and four neighbours on each side.")
    indices = np.r_[np.arange(start - 4, start), np.arange(end + 1, end + 5)]
    values = np.asarray(samples[indices], dtype=np.float64)
    if not np.all(np.isfinite(values)):
        raise RepairError("Nonfinite samples around the repair.")
    return PchipInterpolator(indices, values)(np.arange(start, end + 1))


def plan_repairs(path: Path, events: list[Detection], selected: list[int]) -> list[Patch]:
    if not selected or any(type(index) is not int or not 0 <= index < len(events) for index in selected):
        raise RepairError("Select one or more valid candidates for this recording.")
    if len(set(selected)) != len(selected):
        raise RepairError("Candidate selections must be unique.")
    patches: list[Patch] = []
    with sf.SoundFile(path, mode="r") as source:
        # Reject cases whose interpolation context overlaps any other detected
        # event in the same channel, whether that event is selected or left alone.
        bounds = [(eid, channel, start, end) for eid, ev in enumerate(events) for channel, start, end in ev.spans]
        for event_id in sorted(selected):
            ev = events[event_id]
            reason = repair_reason(ev, source.frames)
            if reason:
                raise RepairError(reason)
            for channel, start, end in ev.spans:
                if not 1 <= channel <= source.channels:
                    raise RepairError("Invalid repair channel.")
                for other_id, other_channel, other_start, other_end in bounds:
                    if other_id != event_id and other_channel == channel and other_start <= end + 4 and other_end >= start - 4:
                        raise RepairError("Candidates overlap or are too close for independent repair. Inspect them manually.")
                source.seek(start - 4)
                window = source.read(end - start + 9, dtype="float64", always_2d=True)[:, channel - 1]
                values = interpolate_gap(window, 4, 4 + end - start)
                bits = {"PCM_S8": 8, "PCM_U8": 8, "PCM_16": 16, "PCM_24": 24, "PCM_32": 32}.get(source.subtype)
                if bits is None:
                    raise RepairError("Only integer PCM repair is supported.")
                scale = 1 << (bits - 1)
                values = np.clip(np.rint(values * scale), -scale, scale - 1) / scale
                patches.append(Patch(event_id, channel, start, end, values))
    return patches


def encode_sample(value: float, layout: PCMLayout) -> bytes:
    scale = 1 << (layout.bits - 1)
    signed = int(np.clip(np.rint(value * scale), -scale, scale - 1))
    if layout.unsigned:
        return bytes([signed + scale])
    return signed.to_bytes(layout.width, layout.byteorder, signed=True)


def encoded_patches(patches: list[Patch], layout: PCMLayout) -> dict[int, bytes]:
    encoded: dict[int, bytes] = {}
    for patch in patches:
        for index, value in enumerate(patch.values, patch.start):
            offset = layout.offset + (index * layout.channels + patch.channel - 1) * layout.width
            if offset in encoded:
                raise RepairError("Repair spans overlap.")
            encoded[offset] = encode_sample(float(value), layout)
    return encoded


def _equal_bytes(source: BinaryIO, repaired: BinaryIO, count: int) -> None:
    while count:
        size = min(count, 1024 * 1024)
        original = source.read(size)
        updated = repaired.read(size)
        if len(original) != size or original != updated:
            raise RepairError("Verification failed: bytes outside selected repairs changed.")
        count -= size


def verify_copy(source: Path, repaired: Path, patches: dict[int, bytes]) -> None:
    size = source.stat().st_size
    if repaired.stat().st_size != size:
        raise RepairError("Verification failed: file size changed.")
    with source.open("rb") as before, repaired.open("rb") as after:
        cursor = 0
        for offset, expected in sorted(patches.items()):
            _equal_bytes(before, after, offset - cursor)
            before.read(len(expected))
            if after.read(len(expected)) != expected:
                raise RepairError("Verification failed: repair samples do not match the plan.")
            cursor = offset + len(expected)
        _equal_bytes(before, after, size - cursor)


def export_repaired_copy(
    source: Path, events: list[Detection], selected: list[int], output_root: Path, expected_sha256: str
) -> dict:
    """Create a unique output directory; never open the source in write mode."""
    if file_hash(source) != expected_sha256:
        raise RepairError("The source changed since the scan. Scan it again before repairing.")
    layout = pcm_layout(source)
    planned = plan_repairs(source, events, selected)
    encoded = encoded_patches(planned, layout)
    output_root.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", source.stem)[:60]
    folder = Path(tempfile.mkdtemp(prefix=f"{safe_name}-", dir=output_root.resolve()))
    output = folder / f"{source.stem}-repaired{source.suffix}"
    manifest = folder / "repair-report.json"
    try:
        # The fresh private directory guarantees no existing file is overwritten.
        # Copy bytes instead of decoding/re-encoding the entire recording.
        with source.open("rb") as original, output.open("xb") as copy:
            shutil.copyfileobj(original, copy, 1024 * 1024)
        with output.open("r+b") as copy:
            for offset, values in sorted(encoded.items()):
                copy.seek(offset)
                copy.write(values)
        verify_copy(source, output, encoded)
        if file_hash(source) != expected_sha256:
            raise RepairError("The source changed during export. Scan it again.")
        info = sf.info(output)
        if (info.frames, info.samplerate, info.channels) != (layout.frames, layout.sample_rate, layout.channels):
            raise RepairError("Output audio characteristics failed verification.")
        report = {
            "source": str(source), "output": str(output), "report": str(manifest),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "method": "shape-preserving cubic interpolation (PCHIP)",
            "source_sha256": expected_sha256, "output_sha256": file_hash(output),
            "selected_event_ids": sorted(selected), "repaired_candidates": len(selected),
            "patched_channel_samples": len(encoded), "format": info.format, "subtype": info.subtype,
            "sample_rate": info.samplerate, "channels": info.channels, "frames": info.frames,
            "verified_outside_repairs_identical": True, "verified_source_unchanged": True,
            "repairs": [{"event_id": patch.event_id, "channel": patch.channel, "start_sample": patch.start, "end_sample": patch.end} for patch in planned],
        }
        with manifest.open("x", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
            handle.write("\n")
        return report
    except BaseException:
        # Only remove the incomplete files created in this fresh export directory.
        output.unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)
        folder.rmdir()
        raise
