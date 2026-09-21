# Declick

Declick finds likely digital clicks, pops, and very short dropouts in WAV and AIFF recordings. It provides:

- a command-line detector that writes a CSV report;
- a local browser UI for listening, reviewing, and selectively repairing candidates.

Source audio is read-only. Repairs are written to a new file.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)

Install dependencies with:

```bash
uv sync
```

## Command line

Scan one recording:

```bash
uv run detect-clicks "/path/to/recording.wav"
```

Scan a directory recursively:

```bash
uv run detect-clicks "/path/to/session" \
  --sensitivity normal \
  --csv reports/clicks.csv
```

Useful options:

- `--sensitivity conservative|normal|aggressive`
- `--min-confidence 0..1`
- `--csv PATH`
- `--diagnostics --diagnostics-dir PATH`
- `--export-snippets PATH`

The CSV includes each candidate's file, timestamp, sample index, channel, confidence, duration, type, and supporting measurements.

## Browser UI

Start the local inspector:

```bash
uv run click-detector-ui
```

Then open the displayed local URL, choose an audio file or enter its path, and click **Scan audio**. Review candidates, listen around each one, select the repairs you want, and click **Export repaired copy**.

The server listens on `127.0.0.1:8765` by default. To use another port or prevent automatic browser launch:

```bash
uv run click-detector-ui --port 8766 --no-browser
```

Exports are placed in a new directory under `repaired-audio/`, or under the directory passed with `--output-dir`. Existing recordings and previous exports are never overwritten.

Repairs are intended for short isolated faults, typically 1–32 samples long. The exporter preserves the original format and verifies that bytes outside the selected repair spans are unchanged. Always listen to the repaired copy before using it in a project.

## Development

Run the Python tests and JavaScript syntax check:

```bash
uv run pytest
node --check src/click_detector/static/app.js
```

The optional frontend workspace has its own instructions in [frontend/README.md](frontend/README.md).

## Privacy

Reports can contain full local file paths and audio metadata. Keep recordings, reports, diagnostics, imports, and repaired exports private. Tests generate synthetic audio and do not require real recordings.
