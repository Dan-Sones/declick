"""Multi-feature click and short-dropout detector."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy.ndimage import median_filter

from .analysis import robust_mad


class Sensitivity(str, Enum):
    CONSERVATIVE = "conservative"
    NORMAL = "normal"
    AGGRESSIVE = "aggressive"


@dataclass(frozen=True, slots=True)
class Thresholds:
    residual_mad: float
    edge_mad: float
    isolation: float
    concentration: float
    edge_relative_rms: float
    min_confidence: float


THRESHOLDS = {
    Sensitivity.CONSERVATIVE: Thresholds(12.0, 5.5, 5.0, 0.35, 0.15, 0.68),
    Sensitivity.NORMAL: Thresholds(8.0, 4.0, 3.8, 0.25, 0.08, 0.55),
    Sensitivity.AGGRESSIVE: Thresholds(5.0, 2.8, 2.8, 0.16, 0.04, 0.40),
}


@dataclass(slots=True)
class Detection:
    file: Path | None
    sample_index: int
    channels: tuple[int, ...]
    confidence: float
    duration_samples: int
    kind: str
    evidence: dict[str, float | int | str] = field(default_factory=dict)
    # One (one-based channel, first sample, last sample inclusive) per component.
    # Keep channel-specific bounds: simultaneous faults can start at different samples.
    spans: tuple[tuple[int, int, int], ...] = ()

    def seconds(self, sample_rate: int) -> float:
        return self.sample_index / sample_rate

    def duration_ms(self, sample_rate: int) -> float:
        return 1000.0 * self.duration_samples / sample_rate

    @property
    def confidence_level(self) -> str:
        if self.confidence >= 0.85:
            return "high"
        if self.confidence >= 0.65:
            return "medium"
        return "low"


@dataclass(slots=True)
class _RawEvent:
    sample_index: int
    start: int
    end: int
    channel: int
    confidence: float
    kind: str
    evidence: dict[str, float | int | str]


def _scaled_score(value: float, low: float, high: float) -> float:
    if high <= low:
        return float(value >= high)
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


def _log_score(value: float, low: float, high: float) -> float:
    if value <= low:
        return 0.0
    if value >= high:
        return 1.0
    return math.log(value / low) / math.log(high / low)


def _frame_scales(values: np.ndarray, frame_size: int) -> tuple[np.ndarray, float]:
    count = max(1, math.ceil(values.size / frame_size))
    scales = np.empty(count, dtype=np.float32)
    for frame in range(count):
        start = frame * frame_size
        scales[frame] = robust_mad(values[start : start + frame_size])
    if scales.size >= 3:
        scales = median_filter(scales, size=5, mode="nearest")
    positive = scales[scales > 0.0]
    floor = float(np.median(positive) * 0.1) if positive.size else 1e-12
    return scales, max(floor, 1e-12)


def _gather_residual_candidates(
    residual: np.ndarray,
    scales: np.ndarray,
    scale_floor: float,
    frame_size: int,
    threshold: float,
) -> list[int]:
    points: list[int] = []
    for frame, scale in enumerate(scales):
        start = frame * frame_size
        stop = min(start + frame_size, residual.size)
        local = np.abs(residual[start:stop])
        indices = np.flatnonzero(local >= threshold * (float(scale) + scale_floor))
        points.extend((indices + start).tolist())
    if not points:
        return []

    # Collapse adjacent/highly related samples before calculating expensive features.
    groups: list[list[int]] = [[points[0]]]
    for point in points[1:]:
        if point - groups[-1][-1] <= 16:
            groups[-1].append(point)
        else:
            groups.append([point])
    return [max(group, key=lambda index: abs(float(residual[index]))) for group in groups]


def _context_features(
    signal: np.ndarray,
    residual: np.ndarray,
    derivative: np.ndarray,
    index: int,
    sample_rate: int,
    residual_scale: float,
    derivative_scale: float,
) -> dict[str, float]:
    n = signal.size
    core_radius = max(4, round(sample_rate * 0.00025))
    context_radius = max(core_radius + 8, round(sample_rate * 0.002))
    rms_radius = max(context_radius, round(sample_rate * 0.010))

    core_lo, core_hi = max(0, index - core_radius), min(n, index + core_radius + 1)
    ctx_lo, ctx_hi = max(0, index - context_radius), min(n, index + context_radius + 1)
    rms_lo, rms_hi = max(0, index - rms_radius), min(n, index + rms_radius + 1)

    context_sq = np.square(residual[ctx_lo:ctx_hi].astype(np.float64, copy=False))
    core_sq = np.square(residual[core_lo:core_hi].astype(np.float64, copy=False))
    outside_energy = max(0.0, float(np.sum(context_sq) - np.sum(core_sq)))
    outside_count = max(1, context_sq.size - core_sq.size)
    outside_rms = math.sqrt(outside_energy / outside_count)
    concentration = float(np.sum(core_sq) / max(float(np.sum(context_sq)), 1e-30))

    edge = max(
        abs(float(derivative[index])),
        abs(float(derivative[min(index + 1, n - 1)])),
    )
    local = signal[rms_lo:rms_hi].astype(np.float64, copy=False)
    local_rms = math.sqrt(float(np.mean(np.square(local)))) if local.size else 0.0
    interpolation = abs(float(residual[index]))

    return {
        "interpolation_residual": interpolation,
        "interpolation_residual_mad": interpolation / max(residual_scale, 1e-12),
        "neighbour_discontinuity": edge,
        "neighbour_discontinuity_mad": edge / max(derivative_scale, 1e-12),
        "isolation_score": interpolation / max(outside_rms, residual_scale * 0.1, 1e-12),
        "curvature_concentration": concentration,
        "edge_relative_to_local_rms": edge / max(local_rms, 1e-8),
        "local_rms": local_rms,
    }


def _candidate_confidence(features: dict[str, float], thresholds: Thresholds) -> float:
    residual = _log_score(features["interpolation_residual_mad"], thresholds.residual_mad, 120.0)
    edge = _log_score(features["neighbour_discontinuity_mad"], thresholds.edge_mad, 35.0)
    isolation = _log_score(features["isolation_score"], thresholds.isolation, 60.0)
    concentration = _scaled_score(features["curvature_concentration"], thresholds.concentration, 0.98)
    relative = _log_score(features["edge_relative_to_local_rms"], thresholds.edge_relative_rms, 1.5)
    return float(np.clip(0.35 + 0.22 * residual + 0.13 * edge + 0.14 * isolation + 0.10 * concentration + 0.06 * relative, 0.0, 0.99))


def _generic_events(
    signal: np.ndarray,
    sample_rate: int,
    channel: int,
    thresholds: Thresholds,
) -> list[_RawEvent]:
    n = signal.size
    if n < 5:
        return []
    residual = np.zeros(n, dtype=np.float32)
    residual[1:-1] = signal[1:-1] - (signal[:-2] + signal[2:]) * 0.5
    derivative = np.zeros(n, dtype=np.float32)
    derivative[1:] = np.diff(signal)

    frame_size = max(512, round(sample_rate * 0.043))
    residual_scales, residual_floor = _frame_scales(residual, frame_size)
    derivative_scales, derivative_floor = _frame_scales(derivative, frame_size)
    candidates = _gather_residual_candidates(
        residual, residual_scales, residual_floor, frame_size, thresholds.residual_mad
    )

    events: list[_RawEvent] = []
    for index in candidates:
        frame = min(index // frame_size, residual_scales.size - 1)
        features = _context_features(
            signal,
            residual,
            derivative,
            index,
            sample_rate,
            float(residual_scales[frame]) + residual_floor,
            float(derivative_scales[frame]) + derivative_floor,
        )
        if (
            features["neighbour_discontinuity_mad"] < thresholds.edge_mad
            or features["isolation_score"] < thresholds.isolation
            or features["curvature_concentration"] < thresholds.concentration
            or features["edge_relative_to_local_rms"] < thresholds.edge_relative_rms
        ):
            continue
        confidence = _candidate_confidence(features, thresholds)
        if confidence < thresholds.min_confidence:
            continue

        peak = abs(float(residual[index]))
        start = index
        end = index
        while start > 0 and index - start < 24 and abs(float(residual[start - 1])) >= peak * 0.25:
            start -= 1
        while end + 1 < n and end - index < 24 and abs(float(residual[end + 1])) >= peak * 0.25:
            end += 1
        events.append(
            _RawEvent(
                sample_index=index,
                start=start,
                end=end,
                channel=channel,
                confidence=confidence,
                kind="short discontinuity",
                evidence={key: round(value, 6) for key, value in features.items()},
            )
        )
    return events


def _zero_run_events(
    signal: np.ndarray,
    sample_rate: int,
    channel: int,
) -> list[_RawEvent]:
    if signal.size < 3:
        return []
    zeros = np.flatnonzero(signal == 0.0)
    if zeros.size == 0:
        return []
    starts = zeros[np.r_[True, np.diff(zeros) > 1]]
    ends = zeros[np.r_[np.diff(zeros) > 1, True]]
    derivative = np.zeros(signal.size, dtype=np.float32)
    derivative[1:] = np.diff(signal)
    frame_size = max(512, round(sample_rate * 0.043))
    derivative_scales, derivative_floor = _frame_scales(derivative, frame_size)

    events: list[_RawEvent] = []
    for start, end in zip(starts.tolist(), ends.tolist(), strict=True):
        length = end - start + 1
        if length < 2 or length > 32 or start == 0 or end + 1 >= signal.size:
            continue
        before = float(signal[start - 1])
        after = float(signal[end + 1])
        edge = max(abs(before), abs(after))
        if edge < 2e-5:
            continue
        frame = min(start // frame_size, derivative_scales.size - 1)
        edge_mad = edge / max(float(derivative_scales[frame]) + derivative_floor, 1e-12)
        length_score = _scaled_score(float(length), 2.0, 8.0)
        edge_score = _log_score(edge_mad, 1.0, 25.0)
        level_dbfs = 20.0 * math.log10(max(edge, 1e-12))
        level_score = _scaled_score(level_dbfs, -80.0, -24.0)
        confidence = float(np.clip(0.45 + 0.27 * length_score + 0.13 * edge_score + 0.15 * level_score, 0.0, 0.99))
        events.append(
            _RawEvent(
                sample_index=start,
                start=start,
                end=end,
                channel=channel,
                confidence=confidence,
                kind="exact-zero dropout",
                evidence={
                    "zero_run_samples": length,
                    "entry_edge": round(abs(before), 8),
                    "exit_edge": round(abs(after), 8),
                    "neighbour_discontinuity_mad": round(edge_mad, 6),
                    "edge_level_dbfs": round(level_dbfs, 3),
                },
            )
        )
    return events


def _merge_channel_events(events: list[_RawEvent], sample_rate: int) -> list[_RawEvent]:
    if not events:
        return []
    gap = max(1, round(sample_rate * 0.001))
    ordered = sorted(events, key=lambda event: (event.start, event.end))
    groups: list[list[_RawEvent]] = [[ordered[0]]]
    for event in ordered[1:]:
        if event.start <= max(item.end for item in groups[-1]) + gap:
            groups[-1].append(event)
        else:
            groups.append([event])

    merged: list[_RawEvent] = []
    for group in groups:
        zero_events = [event for event in group if event.kind == "exact-zero dropout"]
        anchor = max(zero_events or group, key=lambda event: event.confidence)
        confidence = min(0.99, max(event.confidence for event in group) + (0.03 if len(group) > 1 else 0.0))
        evidence: dict[str, float | int | str] = {}
        for event in sorted(group, key=lambda item: item.confidence):
            evidence.update(event.evidence)
        if zero_events:
            start = min(event.start for event in zero_events)
            end = max(event.end for event in zero_events)
        else:
            start = min(event.start for event in group)
            end = max(event.end for event in group)
        merged.append(
            _RawEvent(
                sample_index=anchor.sample_index,
                start=start,
                end=end,
                channel=anchor.channel,
                confidence=confidence,
                kind=anchor.kind,
                evidence=evidence,
            )
        )
    return merged


def _hf_burst_db(signal: np.ndarray, index: int, sample_rate: int) -> float:
    size = 256
    if signal.size < size * 3 or index < size * 2 or index + size * 2 >= signal.size:
        return 0.0
    window = np.hanning(size)

    def hf_energy(center: int) -> float:
        segment = signal[center - size // 2 : center + size // 2].astype(np.float64, copy=False)
        spectrum = np.fft.rfft((segment - np.mean(segment)) * window)
        frequencies = np.fft.rfftfreq(size, 1.0 / sample_rate)
        cutoff = min(7000.0, sample_rate * 0.30)
        return float(np.sum(np.square(np.abs(spectrum[frequencies >= cutoff]))))

    event_energy = hf_energy(index)
    surrounding = 0.5 * (hf_energy(index - size) + hf_energy(index + size))
    return 10.0 * math.log10((event_energy + 1e-30) / (surrounding + 1e-30))


def detect_array(
    data: np.ndarray,
    sample_rate: int,
    *,
    sensitivity: Sensitivity | str = Sensitivity.CONSERVATIVE,
    file: Path | None = None,
    min_confidence: float | None = None,
) -> list[Detection]:
    """Detect candidates in a frames-by-channels float array.

    The input is read-only. Channel numbers in results are one-based to match DAW UI.
    """
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    values = np.asarray(data, dtype=np.float32)
    if values.ndim == 1:
        values = values[:, np.newaxis]
    if values.ndim != 2:
        raise ValueError("data must have shape (frames,) or (frames, channels)")
    if not np.all(np.isfinite(values)):
        raise ValueError("audio contains NaN or infinite samples")
    selected = Sensitivity(sensitivity)
    thresholds = THRESHOLDS[selected]
    confidence_floor = thresholds.min_confidence if min_confidence is None else min_confidence
    if not 0.0 <= confidence_floor <= 1.0:
        raise ValueError("min_confidence must be between 0 and 1")

    per_channel: list[_RawEvent] = []
    for channel_index in range(values.shape[1]):
        signal = values[:, channel_index]
        raw = _zero_run_events(signal, sample_rate, channel_index + 1)
        raw.extend(_generic_events(signal, sample_rate, channel_index + 1, thresholds))
        per_channel.extend(_merge_channel_events(raw, sample_rate))

    # Merge simultaneous detections across channels, preserving channel specificity.
    channel_gap = max(1, round(sample_rate * 0.0005))
    ordered = sorted(per_channel, key=lambda event: event.sample_index)
    groups: list[list[_RawEvent]] = []
    for event in ordered:
        if groups and event.sample_index - groups[-1][0].sample_index <= channel_gap:
            groups[-1].append(event)
        else:
            groups.append([event])

    detections: list[Detection] = []
    for group in groups:
        strongest = max(group, key=lambda event: event.confidence)
        confidence = max(event.confidence for event in group)
        if confidence < confidence_floor:
            continue
        channels = tuple(sorted({event.channel for event in group}))
        evidence: dict[str, Any] = dict(strongest.evidence)
        evidence["hf_burst_db"] = round(
            max(_hf_burst_db(values[:, event.channel - 1], event.sample_index, sample_rate) for event in group),
            3,
        )
        detections.append(
            Detection(
                file=file,
                sample_index=strongest.sample_index,
                channels=channels,
                confidence=confidence,
                duration_samples=max(event.end for event in group) - min(event.start for event in group) + 1,
                kind=strongest.kind,
                evidence=evidence,
                spans=tuple((event.channel, event.start, event.end) for event in group),
            )
        )
    return sorted(detections, key=lambda detection: detection.sample_index)
