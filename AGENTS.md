# Project guidance

- Use Conventional Commits: `type(optional-scope): description` (for example, `feat: initial version`).
- Use `uv` for dependency management and running Python tools; do not use pip directly.
- Run `uv run pytest` and `node --check src/click_detector/static/app.js` before committing code changes.
- Never modify source recordings. Repairs must create new files and preserve bytes outside selected repairs.
- Never commit personal paths, recording or song names, real audio, private analysis reports, or generated waveform images. Tests must generate synthetic audio; documentation must use generic examples.
- Before every commit, inspect staged filenames and contents for private data. Keep local imports, exports, and analysis artifacts ignored. Do not force-add ignored files.
- Do not push unless explicitly requested.
