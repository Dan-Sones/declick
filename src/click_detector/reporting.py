"""Human-readable and CSV reporting."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Iterable

from .analysis import AudioStats
from .detector import Detection


CSV_FIELDS = [
    "file",
    "timestamp",
    "seconds",
    "sample_index",
    "channel",
    "confidence",
    "confidence_level",
    "duration_ms",
    "type",
    "evidence",
]


def format_timestamp(seconds: float) -> str:
    milliseconds = int(round(seconds * 1000.0))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def print_file_report(path: Path, stats: AudioStats, detections: list[Detection]) -> None:
    depth = f", {stats.bit_depth}-bit" if stats.bit_depth else ""
    print(f"\n{path}")
    print(
        f"  {stats.format}/{stats.subtype}: {stats.sample_rate} Hz{depth}, "
        f"{stats.channels} channel(s), {format_timestamp(stats.duration_seconds)}"
    )
    print(
        f"  peak {stats.peak_dbfs:.2f} dBFS, RMS {stats.rms_dbfs:.2f} dBFS, "
        f"DC {stats.dc_offset:+.7f}, crest factor {stats.crest_factor_db:.2f} dB"
    )
    if not detections:
        print("  No candidates at the selected sensitivity/confidence.")
        return
    print(f"  {len(detections)} candidate(s):")
    for detection in detections:
        seconds = detection.seconds(stats.sample_rate)
        channels = ",".join(str(channel) for channel in detection.channels)
        evidence = detection.evidence
        details = []
        if "zero_run_samples" in evidence:
            details.append(f"zero run {evidence['zero_run_samples']} samples")
        if "interpolation_residual_mad" in evidence:
            details.append(f"residual {evidence['interpolation_residual_mad']:.1f} MAD")
        if "neighbour_discontinuity_mad" in evidence:
            details.append(f"edge {evidence['neighbour_discontinuity_mad']:.1f} MAD")
        details.append(f"HF burst {evidence.get('hf_burst_db', 0.0):+.1f} dB")
        print(
            f"    {format_timestamp(seconds)}  sample {detection.sample_index:<10d} "
            f"ch {channels:<5s} {detection.confidence_level:<6s} {detection.confidence:.3f}  "
            f"{detection.duration_ms(stats.sample_rate):.3f} ms  {detection.kind}"
        )
        print(f"      {'; '.join(details)}")


def rows_for_csv(
    detections: Iterable[Detection], sample_rates: dict[Path, int]
) -> list[dict[str, str | int | float]]:
    rows: list[dict[str, str | int | float]] = []
    for detection in detections:
        if detection.file is None:
            continue
        sample_rate = sample_rates[detection.file]
        seconds = detection.seconds(sample_rate)
        rows.append(
            {
                "file": str(detection.file),
                "timestamp": format_timestamp(seconds),
                "seconds": f"{seconds:.9f}",
                "sample_index": detection.sample_index,
                "channel": ";".join(str(channel) for channel in detection.channels),
                "confidence": f"{detection.confidence:.6f}",
                "confidence_level": detection.confidence_level,
                "duration_ms": f"{detection.duration_ms(sample_rate):.6f}",
                "type": detection.kind,
                "evidence": json.dumps(detection.evidence, sort_keys=True),
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, str | int | float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
