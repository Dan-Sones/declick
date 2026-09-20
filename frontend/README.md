# Frontend development

The local UI uses React, TypeScript, Tailwind CSS, and Effect. It runs through the
existing Python server; no frontend dev server or internet connection is required
to use it. Node is needed only to develop or rebuild the frontend.

Run these commands from the repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
uv run click-detector-ui --no-browser
```

The build writes `app.js` and `style.css` into `src/click_detector/static/`. These
generated bundles are checked in and included in the Python package. Edit their
sources here, then rebuild; do not edit the bundles directly. Keep both bundles
in sync with source changes.

## Layout

```text
frontend/
  app/           Application composition and shared React context
  components/    Home, sidebar, inspector, quick review, repair panel, canvases
  hooks/         Scan/selection state, polling, waveform requests, audio lifecycle
  lib/           Effect API requests, canvas drawing, number formatting
  types/         API and audio domain types
  styles/        Tailwind utilities and component styles
  tests/         Synthetic browser fixtures, behavior and visual comparisons
  main.tsx       React entry point
  build.mjs      Local JS/CSS bundling
  package.json   Frontend dependencies and commands
```

Dependencies, the lockfile, TypeScript/Playwright configuration, and test output
all live inside `frontend/`. `node_modules/` and test artifacts are ignored.

React owns rendering, controls, and repair selections. Effects synchronize the
browser audio and canvas APIs. The Effect request layer provides typed failures
and cancellation; changing candidates or leaving a review cancels obsolete work.
Requests and repaired exports use the existing Python endpoints.

Tailwind's `@apply` utilities retain the existing component selectors, exact
dimensions, and responsive breakpoints. Preflight is deliberately omitted to
preserve the original browser defaults and native audio controls.

## Verification

Install the test browser once, then run the checks:

```bash
cd frontend
npx playwright install chromium
npm test
npm run format:check
cd ..
uv run pytest
node --check src/click_detector/static/app.js
```

If Chrome is already installed, `PLAYWRIGHT_CHANNEL=chrome npm test` can use it
instead. Browser tests start an isolated loopback server on port 8767 and generate
synthetic audio. The real-server test stores its copies under the system temporary
directory. Tests cover imports, scans, filtering, selections, keyboard review,
waveform controls, playback requests, cancellation, errors, and verified exports.

The optional visual suite compares home, detailed analysis, repair preview,
quick review, and completion at desktop, tablet, and mobile widths. To compare a
frontend revision, place its `index.html`, `app.js`, and `style.css` in a directory
and pass its absolute path:

```bash
FRONTEND_BASELINE_DIR=/path/to/previous-assets npm test
```

Without that variable the three comparison tests are skipped. Failed screenshots
are attached to Playwright traces under `frontend/test-results/`; no screenshots
or real recordings belong in Git.
