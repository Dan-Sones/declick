# Declick

A conservative Python CLI and local UI for locating likely digital clicks, pops, and very short dropouts in WAV and AIFF music recordings. The CLI reports candidates; the UI can repair explicitly selected candidates into a **new copy**. Source audio is never modified.

Detection uses signal-processing heuristics, not machine learning. It identifies isolated discontinuities and short digital dropouts, with listening review before any repair.

## Prerequisites and setup

- Python 3.12 or newer (uv selects and manages it)
- [uv](https://docs.astral.sh/uv/)
- `libsndfile` if your platform's `soundfile` wheel does not bundle it

Install uv if needed by following the official uv installation instructions. Then, from this project directory:

```bash
uv sync
uv run detect-clicks "/path/to/audio.wav"
```

Do not create or activate a virtual environment manually. `uv sync` creates the project environment from `pyproject.toml` and `uv.lock`.

Runtime dependencies are NumPy, SciPy, SoundFile, and Matplotlib. Pytest is in the development dependency group. Add future dependencies with `uv add NAME` or `uv add --dev NAME`, rather than using pip directly.

## Interactive waveform inspector

Open the local UI in your browser:

```bash
uv run click-detector-ui
```

Paste the full path to an audio file or session folder into the source field, choose a sensitivity, and select **Scan audio**. You can also provide the path on launch:

```bash
uv run click-detector-ui "/path/to/recording.aif"
```

The inspector provides:

- Recording and candidate lists, with confidence filtering and time/score sorting.
- A waveform context graph with 20, 50, or 100 ms windows.
- A sample-level graph with adjustable zoom, sample markers, and exact values on hover.
- A marked detection position and approximate event span, plus the measurements behind the score.
- Timestamp copying and previous/next controls (left/right arrow keys when not editing a control).
- Playback of up to two seconds around each candidate, at its original level.
- Checkboxes to choose which candidates to repair, an original/repaired waveform comparison, and **Export repaired copy**.

Scans run in the background and process one recording at a time. The UI keeps metadata and reads only short audio windows when you select candidates. Audio previews are generated in memory as browser-compatible 16-bit WAV copies; source audio is never rewritten. All application assets and audio processing are local, with no external web services or additional dependencies.

The server binds to `127.0.0.1:8765`. Leave the terminal running while you use it, and press Ctrl+C to stop. Results are kept for the current server session. To choose another port or open the URL yourself:

```bash
uv run click-detector-ui --port 8766 --no-browser
```

Quick review uses Web Audio playback. If native audio controls in an embedded browser are unreliable, open the same local URL in your regular browser. WAV generation and source preservation are covered by automated tests. Listening previews have 10 ms edge fades; source audio and repaired exports do not.

### Selective repair

1. Scan a recording. All repair checkboxes start **unchecked**.
2. Click a candidate to inspect it. Toggle **Preview proposed repair** to compare the estimated waveform (colour) with the original (grey). The audio preview follows this toggle and previews only the current candidate.
3. Check the box beside each candidate you want repaired. Unchecked candidates remain unchanged. **Select all** selects only repairable candidates matching the current confidence filter, keeping existing selections; **Clear selections** clears this recording's selections. Filtering, sorting, and switching recordings retain selections during the page session. A rescan or page reload clears them.
   The home page's **Choose an audio file** opens the OS file picker. It copies the chosen AIFF/WAV (up to 2 GiB) byte-for-byte into a unique folder under `repaired-audio/imports/` and scans that local working copy. Imports remain there until you remove them; nothing is uploaded to a cloud service. **Open by path / folder** keeps the original path-based workflow available.
   **Quick review** is the primary review page, with a whole-recording waveform above the original and proposed-repair comparison graphs. Candidate markers follow the confidence filter; the current candidate is highlighted and diamonds identify staged repairs. Click a marker to jump to it and play its original audio without changing repair selections. Use Left/Right in Quick review to move between candidates without changing decisions. On a focused marker, Left/Right (or Home/End) selects and plays markers chronologically. Compact text beneath the overview shows the current candidate details. Use **Graph scale** to view both comparison graphs at ±24, ±48, ±96, or ±192 samples around the detection. The scale stays in sync with Detailed analysis and is retained when moving between candidates. The review queue follows the current confidence filter and sort order. Loading the page or importing a recording stays silent. Start playback with Replay, a candidate marker, or a review control; subsequent candidates play their original audio with surrounding context. Press **Y** to stage it or **N** to ignore it (removing any previous selection); either advances immediately. **M / Replay** plays it again. Switching to **Detailed analysis** stops playback and keeps decisions; unreviewed candidates keep their previous selection. Reaching the end of the queue does not imply that skipped candidates were reviewed, and does not export or modify files. If the browser blocks playback, press Replay. Quick mode uses Web Audio playback instead of native audio controls.
4. Review the selected count and click **Export repaired copy**. This applies exactly the checked candidates in the current recording, including selections hidden by a filter.
5. The UI shows the saved path and download links for the audio and JSON verification report.

Each export creates a fresh, uniquely named directory under `repaired-audio/` in the launch directory. An AIFF input produces a `*-repaired.aif`/`*.aiff`; a WAV input produces a repaired WAV. Repeated exports never overwrite earlier exports or the source. Choose another destination when starting the UI with `--output-dir /path/to/repairs`.

The repair is a shape-preserving cubic interpolation (PCHIP) using four valid samples on each side. It replaces only the detected short span in each affected channel, then quantizes those replacements to the original PCM bit depth. Supported repairs are 1–32 samples long with enough clean context. Longer events, overlapping/too-close candidates, unsupported encodings, and changed sources are refused rather than silently converted. This suits very short dropouts and impulses; it is not a general cure for sustained DC offsets, clipping, or long gaps. Missing audio is estimated, so audition the result.

Export supports integer PCM AIFF and RIFF WAV (8/16/24/32-bit), plus PCM WAVEX with full-width samples and AIFF-C `NONE`/`sowt` encodings. Floating-point, compressed, RF64, and other AIFF-C encodings remain detection-only. The original **container bytes are copied**, and only the selected PCM sample bytes are patched; the file is not re-encoded. This preserves the sample rate, channels, bit depth, frame count, timing, AIFF markers, WAV metadata, padding, and all other embedded chunks. Filesystem timestamps/permissions are properties of the new file and are not promised to match.

Before publishing the output, the exporter verifies every byte outside the selected repairs is identical to the source, checks the repaired bytes against the plan, validates frame/channel/rate characteristics, and verifies the source's SHA-256 still matches the scan. The JSON report records both hashes and exact per-channel repair spans. Incomplete exports are removed if verification fails.

To use the result in Logic, import the repaired copy on a separate track and align it with the original source/region. Keep the original muted for comparison. The repaired file has exactly the same length and sample positions; account for the region's start offset and any existing trims when placing it. Logic also supports manual waveform drawing with the [Audio File Editor Pencil tool](https://support.apple.com/en-au/guide/logicpro/lgcp2158572a/10.7/mac/11.0); work on a duplicate file if using that approach.

## Usage

Analyse one file with the conservative default:

```bash
uv run detect-clicks "/path/to/recording.aif"
```

Recursively scan a session directory (supported extensions: WAV, WAVE, AIFF, AIF):

```bash
uv run detect-clicks "/path/to/session/"
```

Choose the CSV location and sensitivity:

```bash
uv run detect-clicks "/path/to/session/" \
  --sensitivity normal \
  --csv reports/session-clicks.csv
```

Generate waveform plots for the strongest candidates:

```bash
uv run detect-clicks "/path/to/session/" \
  --diagnostics \
  --diagnostics-dir reports/plots \
  --max-diagnostics 20
```

Export short, copy-only 24-bit WAV snippets in addition to plots:

```bash
uv run detect-clicks "/path/to/recording.aif" \
  --diagnostics \
  --export-snippets reports/snippets
```

The source files are opened for reading only. Diagnostic snippets are newly written copies around candidate positions.

Useful options:

- `--sensitivity conservative|normal|aggressive`: feature thresholds and default confidence floor.
- `--min-confidence 0..1`: explicit confidence cutoff.
- `--csv PATH`: report location; default `click-report.csv`.
- `--diagnostics`: produce a 50 ms context plot plus a sample-level view.
- `--max-diagnostics N`: cap plots and snippets per file.
- `--export-snippets DIR`: write 100 ms copies around the strongest events.

## Output and Logic Pro workflow

The terminal gives file metadata and a chronological candidate list. The CSV contains:

```text
file,timestamp,seconds,sample_index,channel,confidence,confidence_level,duration_ms,type,evidence
```

Use the `HH:MM:SS.mmm` timestamp to navigate to the same position in Logic Pro. Because Logic projects can use an SMPTE/project offset, confirm that the audio region starts at the same zero point as the source file. The exact zero-based `sample_index` is included when sample-accurate verification is needed. Channel numbers are one-based.

Confidence estimates how strongly the signal matches a very short digital anomaly. It is not a probability and it does not estimate how audible an event is:

- **high**: `>= 0.85`
- **medium**: `>= 0.65` and `< 0.85`
- **low**: `< 0.65`

## How detection works

The generic path combines several independent measurements rather than thresholding sample amplitude:

1. A sample's disagreement with linear interpolation from its two neighbours.
2. The nearest sample-to-sample edge.
3. Robust local scaling with median absolute deviation (MAD), calculated in short frames.
4. Isolation from curvature energy in the surrounding 4 ms.
5. Concentration of that energy in a sub-millisecond core.
6. Edge size relative to the local 20 ms signal RMS.
7. A diagnostic high-frequency burst ratio, comparing a short FFT window with adjacent windows.

Candidates must satisfy multiple preset-dependent conditions. Related anomalous samples within 1 ms are grouped into one event, and simultaneous channel events are merged while retaining the affected channel list.

There is also a targeted exact-zero-run path. A short run of 2–32 digital zeros is considered only when it is bounded by non-zero audio and creates a meaningful edge. Long digital silence and isolated quantized zero crossings are ignored.

Legitimate pick attacks, drums, and consonants can be steep and broadband. They usually distribute curvature over more samples and remain continuous, whereas a digital click tends to create an isolated interpolation failure, one or two extreme edges, or an impossible short zero plateau. This distinction reduces false positives but cannot make them impossible.

## Sensitivity and limitations

Start with `conservative`. `normal` is useful when the conservative list misses a known audible event. `aggressive` deliberately surfaces many ambiguous musical transients and is best combined with a higher `--min-confidence` or labelled examples.

Important limitations:

- Every result is a candidate until validated by listening or a known timestamp.
- Smooth but incorrect edits, longer dropouts, analogue crackle, clipping, and glitches masked by dense material may need other detectors.
- Percussive or heavily distorted sources are intrinsically harder than a close guitar microphone.
- Confidence describes signal morphology, not audibility; a structurally clear fault at a very low level may not be heard.
- Files are processed sequentially, so a whole session is never loaded at once. The current implementation loads one complete file and analyses one channel at a time; unusually large individual files may need a future overlapping chunked implementation.

If you can provide timestamps labelled “definitely a pop” or “definitely not a pop,” those are far more valuable for tuning than increasing sensitivity blindly.

## Tests

The synthetic suite covers a clean sine, silence, a one-sample spike, a permanent discontinuity, several incorrect samples, an 8-sample dropout, a band-limited sharp musical transient, grouping, short input, invalid samples, and a stereo fault affecting only one channel.

```bash
uv run pytest
```

The React frontend has a separate TypeScript and browser test suite. See
[frontend/README.md](frontend/README.md) for setup, builds, and visual comparisons.

## Privacy and generated files

Keep recordings, imported working copies, repaired exports, reports, and diagnostic plots private. Reports can contain full source paths and audio metadata. Generated output directories and common audio formats are excluded from Git; do not force-add them. Tests create synthetic audio at runtime, so no real recordings are required to run the suite.
