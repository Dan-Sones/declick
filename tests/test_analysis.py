from pathlib import Path

import numpy as np

from click_detector.analysis import analyse_audio, bit_depth_from_subtype, robust_mad
from click_detector.audio import AudioFile
from click_detector.reporting import format_timestamp


def test_robust_mad_ignores_large_outlier() -> None:
    values = np.array([-2.0, -1.0, 0.0, 1.0, 2.0, 10_000.0])
    assert 1.0 < robust_mad(values) < 3.0


def test_audio_stats_and_bit_depth() -> None:
    data = np.array([[-0.5], [0.0], [0.5]], dtype=np.float32)
    audio = AudioFile(Path("example.aif"), data, 48_000, "AIFF", "PCM_24")
    stats = analyse_audio(audio)
    assert stats.bit_depth == 24
    assert stats.channels == 1
    assert stats.frames == 3
    assert stats.peak == 0.5
    assert bit_depth_from_subtype("FLOAT") is None


def test_timestamp_rounding() -> None:
    assert format_timestamp(83.4816) == "00:01:23.482"
    assert format_timestamp(3600.0) == "01:00:00.000"
