"""Command-line interface."""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import sys

from .analysis import analyse_audio
from .audio import AudioReadError, discover_audio_files, read_audio
from .detector import Detection, Sensitivity, detect_array
from .diagnostics import export_snippet, write_diagnostic_plot
from .reporting import print_file_report, rows_for_csv, write_csv


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="detect-clicks",
        description="Find likely short digital clicks/dropouts without modifying source audio.",
    )
    parser.add_argument("inputs", nargs="+", type=Path, help="WAV/AIFF file or directory (recursive)")
    parser.add_argument("--sensitivity", choices=[item.value for item in Sensitivity], default="conservative")
    parser.add_argument("--min-confidence", type=float, default=None, help="Override the preset confidence floor (0..1)")
    parser.add_argument("--csv", type=Path, default=Path("click-report.csv"), help="CSV report path")
    parser.add_argument("--diagnostics", action="store_true", help="Write waveform plots for strongest candidates")
    parser.add_argument("--diagnostics-dir", type=Path, default=Path("click-diagnostics"), help="Directory for plots")
    parser.add_argument("--max-diagnostics", type=int, default=20, help="Maximum plots/snippets per file")
    parser.add_argument("--export-snippets", type=Path, default=None, metavar="DIR", help="Export 100 ms copy-only WAV snippets")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.min_confidence is not None and not 0.0 <= args.min_confidence <= 1.0:
        print("error: --min-confidence must be between 0 and 1", file=sys.stderr)
        return 2
    if args.max_diagnostics < 0:
        print("error: --max-diagnostics cannot be negative", file=sys.stderr)
        return 2
    try:
        paths = discover_audio_files(args.inputs)
    except AudioReadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if not paths:
        print("error: no supported WAV/AIFF files found", file=sys.stderr)
        return 2

    all_detections: list[Detection] = []
    sample_rates: dict[Path, int] = {}
    failures = 0
    for path in paths:
        try:
            audio = read_audio(path)
            stats = analyse_audio(audio)
            detections = detect_array(
                audio.data,
                audio.sample_rate,
                sensitivity=args.sensitivity,
                file=path,
                min_confidence=args.min_confidence,
            )
        except (AudioReadError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            failures += 1
            continue

        sample_rates[path] = audio.sample_rate
        all_detections.extend(detections)
        print_file_report(path, stats, detections)

        strongest = sorted(detections, key=lambda item: item.confidence, reverse=True)[: args.max_diagnostics]
        if args.diagnostics:
            for rank, detection in enumerate(strongest, 1):
                write_diagnostic_plot(audio, detection, args.diagnostics_dir, rank)
        if args.export_snippets is not None:
            for rank, detection in enumerate(strongest, 1):
                export_snippet(audio, detection, args.export_snippets, rank)

    rows = rows_for_csv(all_detections, sample_rates)
    write_csv(args.csv, rows)
    counts = Counter(detection.confidence_level for detection in all_detections)
    print(
        f"\nWrote {len(rows)} candidate(s) to {args.csv} "
        f"(high {counts['high']}, medium {counts['medium']}, low {counts['low']})."
    )
    if args.diagnostics:
        print(f"Diagnostic plots: {args.diagnostics_dir}")
    if args.export_snippets is not None:
        print(f"Copy-only snippets: {args.export_snippets}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
