"""Audio-file discovery and non-destructive loading."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

SUPPORTED_SUFFIXES = {".wav", ".wave", ".aif", ".aiff"}


class AudioReadError(RuntimeError):
    """Raised when an input cannot be decoded as supported audio."""


@dataclass(frozen=True, slots=True)
class AudioFile:
    path: Path
    data: np.ndarray
    sample_rate: int
    format: str
    subtype: str

    @property
    def frames(self) -> int:
        return int(self.data.shape[0])

    @property
    def channels(self) -> int:
        return int(self.data.shape[1])


def discover_audio_files(targets: list[Path]) -> list[Path]:
    """Resolve files and recursively scan directories in deterministic order."""
    found: set[Path] = set()
    for target in targets:
        expanded = target.expanduser()
        if expanded.is_file():
            if expanded.suffix.lower() not in SUPPORTED_SUFFIXES:
                raise AudioReadError(f"Unsupported audio extension: {expanded}")
            found.add(expanded.resolve())
        elif expanded.is_dir():
            for candidate in expanded.rglob("*"):
                if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_SUFFIXES:
                    found.add(candidate.resolve())
        else:
            raise AudioReadError(f"Input does not exist: {expanded}")
    return sorted(found, key=lambda path: str(path).casefold())


def read_audio(path: Path) -> AudioFile:
    """Read one file as floating-point samples without changing the source."""
    try:
        info = sf.info(path)
        data, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    except (OSError, RuntimeError, sf.LibsndfileError) as exc:
        raise AudioReadError(f"Could not read {path}: {exc}") from exc

    if data.ndim != 2:
        raise AudioReadError(f"Unexpected sample layout in {path}")
    return AudioFile(
        path=path,
        data=data,
        sample_rate=int(sample_rate),
        format=info.format,
        subtype=info.subtype,
    )
