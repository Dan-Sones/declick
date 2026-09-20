"""Copy-only diagnostic plots and snippets."""

from __future__ import annotations

from pathlib import Path
import re

import numpy as np
import soundfile as sf

from .audio import AudioFile
from .detector import Detection


def _safe_stem(path: Path) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", path.stem).strip("_") or "audio"


def diagnostic_basename(audio: AudioFile, detection: Detection, rank: int) -> str:
    millis = round(1000.0 * detection.sample_index / audio.sample_rate)
    return f"{_safe_stem(audio.path)}_{rank:03d}_{millis:010d}ms"


def write_diagnostic_plot(
    audio: AudioFile,
    detection: Detection,
    output_dir: Path,
    rank: int,
    *,
    context_ms: float = 50.0,
) -> Path:
    # Keep Matplotlib out of ordinary scans and snippet-only runs.
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    output_dir.mkdir(parents=True, exist_ok=True)
    sr = audio.sample_rate
    center = detection.sample_index
    radius = max(1, round(sr * context_ms / 2000.0))
    lo, hi = max(0, center - radius), min(audio.frames, center + radius + 1)
    zoom_radius = max(24, detection.duration_samples * 3)
    zlo, zhi = max(0, center - zoom_radius), min(audio.frames, center + zoom_radius + 1)

    figure, axes = plt.subplots(2, 1, figsize=(11, 7), constrained_layout=True)
    for channel in range(audio.channels):
        axes[0].plot(np.arange(lo, hi) / sr, audio.data[lo:hi, channel], linewidth=0.8, label=f"ch {channel + 1}")
        axes[1].plot(np.arange(zlo, zhi) - center, audio.data[zlo:zhi, channel], marker=".", markersize=3, linewidth=0.8, label=f"ch {channel + 1}")
    axes[0].axvline(center / sr, color="crimson", linestyle="--", linewidth=1.0)
    axes[0].set(title=f"{audio.path.name} — {detection.kind}, confidence {detection.confidence:.3f}", xlabel="Time (seconds)", ylabel="Amplitude")
    axes[1].axvline(0, color="crimson", linestyle="--", linewidth=1.0)
    axes[1].axvspan(0, max(1, detection.duration_samples - 1), color="crimson", alpha=0.12)
    axes[1].set(title="Sample-level view", xlabel="Samples relative to detection", ylabel="Amplitude")
    if audio.channels > 1:
        axes[0].legend(loc="upper right")
        axes[1].legend(loc="upper right")
    output = output_dir / f"{diagnostic_basename(audio, detection, rank)}.png"
    figure.savefig(output, dpi=160)
    plt.close(figure)
    return output


def export_snippet(
    audio: AudioFile,
    detection: Detection,
    output_dir: Path,
    rank: int,
    *,
    context_ms: float = 100.0,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    radius = max(1, round(audio.sample_rate * context_ms / 2000.0))
    lo = max(0, detection.sample_index - radius)
    hi = min(audio.frames, detection.sample_index + radius + 1)
    output = output_dir / f"{diagnostic_basename(audio, detection, rank)}.wav"
    sf.write(output, audio.data[lo:hi], audio.sample_rate, subtype="PCM_24")
    return output
