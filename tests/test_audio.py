from pathlib import Path

import pytest

from click_detector.audio import AudioReadError, discover_audio_files


def test_recursive_discovery_is_filtered_and_sorted(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    (tmp_path / "b.WAV").touch()
    (nested / "a.aif").touch()
    (nested / "ignore.mp3").touch()
    assert [path.name for path in discover_audio_files([tmp_path])] == ["b.WAV", "a.aif"]


def test_unsupported_explicit_file_is_rejected(tmp_path: Path) -> None:
    file = tmp_path / "recording.mp3"
    file.touch()
    with pytest.raises(AudioReadError, match="Unsupported"):
        discover_audio_files([file])
