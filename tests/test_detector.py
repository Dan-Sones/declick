import numpy as np
import pytest

from click_detector.detector import Sensitivity, detect_array


SR = 48_000
DURATION = 1.0


def sine(frequency: float = 440.0, amplitude: float = 0.25) -> np.ndarray:
    t = np.arange(round(SR * DURATION)) / SR
    return (amplitude * np.sin(2.0 * np.pi * frequency * t)).astype(np.float32)


def near(events, sample: int, tolerance: int = 48):
    return [event for event in events if abs(event.sample_index - sample) <= tolerance]


def test_clean_sine_has_no_candidates() -> None:
    assert detect_array(sine(), SR) == []


def test_silence_has_no_candidates() -> None:
    assert detect_array(np.zeros(SR, dtype=np.float32), SR) == []


def test_one_sample_spike_is_detected_once() -> None:
    data = sine()
    fault = 20_000
    data[fault] += 0.7
    events = detect_array(data, SR)
    matches = near(events, fault)
    assert len(matches) == 1
    assert matches[0].confidence >= 0.85


def test_step_discontinuity_is_detected() -> None:
    data = sine(amplitude=0.08)
    fault = 24_000
    data[fault:] += 0.30
    assert near(detect_array(data, SR), fault)


def test_dropped_samples_are_one_grouped_event() -> None:
    data = sine()
    fault = 19_000
    data[fault : fault + 8] = 0.0
    events = detect_array(data, SR)
    matches = near(events, fault)
    assert len(matches) == 1
    assert matches[0].kind == "exact-zero dropout"
    assert matches[0].duration_samples == 8
    assert matches[0].evidence["zero_run_samples"] == 8


def test_incorrect_sample_burst_is_grouped() -> None:
    data = sine()
    fault = 21_000
    data[fault : fault + 4] = np.array([0.8, -0.7, 0.6, -0.6])
    matches = near(detect_array(data, SR), fault)
    assert len(matches) == 1
    assert matches[0].duration_samples >= 4


def test_bandlimited_sharp_transient_is_not_automatically_a_click() -> None:
    data = sine(amplitude=0.04)
    onset = 20_000
    length = round(0.025 * SR)
    t = np.arange(length) / SR
    attack = np.minimum(1.0, np.arange(length) / (0.001 * SR))
    transient = 0.5 * attack * np.exp(-t / 0.008) * np.sin(2.0 * np.pi * 2200.0 * t)
    data[onset : onset + length] += transient.astype(np.float32)
    assert not near(detect_array(data, SR), onset, tolerance=round(0.003 * SR))


def test_stereo_fault_reports_only_affected_channel() -> None:
    clean = sine()
    stereo = np.column_stack([clean.copy(), clean.copy()])
    fault = 23_000
    stereo[fault, 1] += 0.8
    matches = near(detect_array(stereo, SR), fault)
    assert len(matches) == 1
    assert matches[0].channels == (2,)


def test_empty_and_tiny_audio_are_safe() -> None:
    assert detect_array(np.empty((0, 1), dtype=np.float32), SR) == []
    assert detect_array(np.zeros((3, 2), dtype=np.float32), SR) == []


def test_bad_input_is_rejected() -> None:
    with pytest.raises(ValueError, match="sample_rate"):
        detect_array(sine(), 0)
    damaged = sine()
    damaged[100] = np.nan
    with pytest.raises(ValueError, match="NaN"):
        detect_array(damaged, SR)


@pytest.mark.parametrize("sensitivity", list(Sensitivity))
def test_all_sensitivity_presets_run(sensitivity: Sensitivity) -> None:
    assert detect_array(sine(), SR, sensitivity=sensitivity) == []
