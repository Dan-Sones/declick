"""Signal and file-level descriptive analysis."""

from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from .audio import AudioFile


@dataclass(frozen=True, slots=True)
class AudioStats:
    sample_rate: int
    channels: int
    frames: int
    duration_seconds: float
    format: str
    subtype: str
    bit_depth: int | None
    peak: float
    peak_dbfs: float
    rms: float
    rms_dbfs: float
    dc_offset: float
    crest_factor_db: float
    zero_sample_fraction: float


def amplitude_to_db(value: float, *, floor_db: float = -300.0) -> float:
    if value <= 0.0:
        return floor_db
    return max(floor_db, 20.0 * math.log10(value))


def bit_depth_from_subtype(subtype: str) -> int | None:
    for token in reversed(subtype.split("_")):
        if token.isdigit():
            return int(token)
    return None


def analyse_audio(audio: AudioFile) -> AudioStats:
    data = audio.data
    frames = audio.frames
    if data.size:
        samples = data.astype(np.float64, copy=False)
        peak = float(np.max(np.abs(samples)))
        rms = float(np.sqrt(np.mean(np.square(samples))))
        dc_offset = float(np.mean(samples))
        zero_fraction = float(np.count_nonzero(samples == 0.0) / samples.size)
    else:
        peak = rms = dc_offset = zero_fraction = 0.0
    crest = amplitude_to_db(peak / rms) if rms > 0.0 else 0.0
    return AudioStats(
        sample_rate=audio.sample_rate,
        channels=audio.channels,
        frames=frames,
        duration_seconds=frames / audio.sample_rate if audio.sample_rate else 0.0,
        format=audio.format,
        subtype=audio.subtype,
        bit_depth=bit_depth_from_subtype(audio.subtype),
        peak=peak,
        peak_dbfs=amplitude_to_db(peak),
        rms=rms,
        rms_dbfs=amplitude_to_db(rms),
        dc_offset=dc_offset,
        crest_factor_db=crest,
        zero_sample_fraction=zero_fraction,
    )


def robust_mad(values: np.ndarray) -> float:
    """Return a Gaussian-consistent median absolute deviation."""
    if values.size == 0:
        return 0.0
    median = float(np.median(values))
    return 1.4826 * float(np.median(np.abs(values - median)))
