import json
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Dict, Any, List
from pydantic import BaseModel

DEFAULT_CONFIG_PATH = Path.home() / ".focusocr" / "config.json"
OCR_CACHE_DIR = Path.home() / ".focusocr" / "ocr_cache"


@dataclass
class Settings:
    host: str = "127.0.0.1"
    start_port: int = 9000
    ocr_confidence_threshold: float = 0.0
    max_snippets_per_match: int = 3
    max_history_per_dir: int = 5
    max_saved_results: int = 20
    max_ocr_cache_files: int = 5000
    max_thumb_cache_files: int = 3000
    enable_ocr_cache: bool = True


def _default_config_dir() -> Path:
    """Returns the user-local config directory, creating it if needed."""
    cfg_dir = Path.home() / ".focusocr"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    return cfg_dir


def save_settings(settings: Settings, path: Optional[Path] = None) -> None:
    """Writes the current settings to a JSON config file."""
    if path is None:
        path = _default_config_dir() / "config.json"
    path.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")


def load_settings(path: Optional[Path] = None) -> Settings:
    """Loads settings from the config file, returning defaults if absent."""
    if path is None:
        path = DEFAULT_CONFIG_PATH

    if not path.exists():
        return Settings()

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return Settings(**data)
    except (json.JSONDecodeError, TypeError, ValueError):
        return Settings()


class SettingsUpdate(BaseModel):
    """Pydantic model for partial settings updates with type validation."""
    host: Optional[str] = None
    start_port: Optional[int] = None
    ocr_confidence_threshold: Optional[float] = None
    max_snippets_per_match: Optional[int] = None
    max_history_per_dir: Optional[int] = None
    max_saved_results: Optional[int] = None
    max_ocr_cache_files: Optional[int] = None
    max_thumb_cache_files: Optional[int] = None
    enable_ocr_cache: Optional[bool] = None


class SaveResultsPayload(BaseModel):
    """Pydantic model for saving scan results."""
    matches: List[Dict[str, Any]]
    metadata: Optional[Dict[str, Any]] = None


def prune_cache_dir(cache_dir: Path, max_files: int, pattern: str = "*") -> int:
    """Removes the oldest files in *cache_dir* until at most *max_files* remain.
    Returns the number of files pruned."""
    if not cache_dir.exists() or max_files <= 0:
        return 0
    files = sorted(
        [f for f in cache_dir.glob(pattern) if f.is_file()],
        key=lambda p: p.stat().st_mtime
    )
    pruned = 0
    while len(files) > max_files:
        oldest = files.pop(0)
        oldest.unlink(missing_ok=True)
        pruned += 1
    if pruned:
        print(f"Pruned {pruned} files from {cache_dir.name} (max {max_files})")
    return pruned
