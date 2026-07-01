import os
import json
import hashlib
import shutil
import time
import re
import threading
import logging
from typing import List, Generator, Dict, Any, Tuple, Optional
from pathlib import Path
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from onnxruntime import get_available_providers
from backend.config import load_settings, OCR_CACHE_DIR

OCR_ENGINE_VERSION = 1  # Bump this if RapidOCR version changes or extraction logic changes

# Supported image file extensions
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff'}

def sanitize_folder_name(name: str) -> str:
    """Removes invalid characters for folder names and returns a safe name.
    Backslash (common in regex patterns like \\d) is replaced with underscore
    instead of being stripped, so the folder name stays recognizable."""
    safe = name.replace('\\', '_')
    clean = re.sub(r'[/*?:"<>|]', "", safe).strip()
    return clean if clean else "unnamed_keyword"


class OCREngine:
    def __init__(self):
        self._cancel_event = threading.Event()
        self._init_ocr_engine()

    def _init_ocr_engine(self):
        """Initialize RapidOCR with GPU acceleration if available."""
        # Suppress RapidOCR's verbose per-module INFO logs by patching
        # the get_logger reference in infer_engine (where OrtInferSession lives)
        import rapidocr_onnxruntime.utils.infer_engine as _ie
        _orig_get_logger = _ie.get_logger
        def _silent_logger(name):
            logger = _orig_get_logger(name)
            logger.setLevel(logging.WARNING)
            return logger
        _ie.get_logger = _silent_logger

        providers = get_available_providers()
        use_dml = "DmlExecutionProvider" in providers
        if use_dml:
            print("DirectML GPU acceleration detected — enabling GPU inference")
            self._ocr = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
        else:
            # Check if DirectML.dll exists but provider is hidden by CPU-only onnxruntime
            import onnxruntime as _ort
            _capi_dir = os.path.dirname(_ort.__file__)
            _dml_dll = os.path.join(_capi_dir, "capi", "DirectML.dll")
            if os.path.exists(_dml_dll):
                print("WARNING: DirectML.dll found but DmlExecutionProvider unavailable.")
                print("  The CPU-only 'onnxruntime' package is overriding the DirectML build.")
                print("  Fix: run 'pip uninstall onnxruntime' to let onnxruntime-directml take over.")
            print("No GPU acceleration available — using CPU inference")
            self._ocr = RapidOCR()

    def cancel_scan(self):
        """Signals the current scan to stop at the next opportunity."""
        self._cancel_event.set()

    def reset_cancel(self):
        """Clears the cancellation signal for a new scan."""
        self._cancel_event.clear()

    def get_all_images(self, target_dir: str, recursive: bool = True) -> List[Path]:
        """Finds all supported images in the target directory."""
        target_path = Path(target_dir)
        if not target_path.exists() or not target_path.is_dir():
            raise ValueError(f"Target directory '{target_dir}' does not exist or is not a directory.")
        
        images = []
        pattern = "**/*" if recursive else "*"
        for p in target_path.glob(pattern):
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
                images.append(p)
        # Safe sort — skip files deleted between glob and sort
        def _mtime_or_zero(p):
            try:
                return p.stat().st_mtime
            except OSError:
                return 0
        return sorted(images, key=_mtime_or_zero, reverse=True)

    def _cache_key(self, img_path: Path) -> str:
        st = img_path.stat()
        raw = f"{img_path.resolve()}_{st.st_mtime_ns}_{st.st_size}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def _cache_path(self, cache_key: str) -> Path:
        return OCR_CACHE_DIR / f"{cache_key}.json"

    def _load_cache(self, img_path: Path) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
        settings = load_settings()
        if not settings.enable_ocr_cache:
            return None
        key = self._cache_key(img_path)
        cache_file = self._cache_path(key)
        if not cache_file.exists():
            return None
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            if data.get("engine_version") != OCR_ENGINE_VERSION:
                return None
            return data["text"], data["detailed_results"]
        except Exception:
            return None

    def _save_cache(self, img_path: Path, text: str, detailed_results: List[Dict[str, Any]]) -> None:
        settings = load_settings()
        if not settings.enable_ocr_cache:
            return
        key = self._cache_key(img_path)
        OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file = self._cache_path(key)
        try:
            cache_file.write_text(
                json.dumps({
                    "engine_version": OCR_ENGINE_VERSION,
                    "path": str(img_path.resolve()),
                    "text": text,
                    "detailed_results": detailed_results
                }, ensure_ascii=False),
                encoding="utf-8"
            )
        except Exception as e:
            print(f"Failed to write OCR cache for {img_path}: {e}")

    def clear_cache(self) -> int:
        """Deletes all cached OCR results. Returns the number of files removed."""
        if not OCR_CACHE_DIR.exists():
            return 0
        count = 0
        for f in OCR_CACHE_DIR.iterdir():
            if f.suffix == ".json":
                f.unlink()
                count += 1
        return count

    def extract_text_and_boxes(self, img_path: Path, confidence_threshold: float = 0.0) -> Tuple[str, List[Dict[str, Any]], bool]:
        """
        Runs OCR on the image (or returns cached result if available).
        Cache always stores the full unfiltered result; filtering is applied
        on the returned data so re-scanning with a different threshold reuses cache.
        Returns:
            - Full text joined by newlines (filtered by threshold).
            - A list of dicts containing text, confidence, and bounding box coordinates.
            - Boolean: True if result came from cache, False if OCR was run fresh.
        """
        # Check cache first
        cached = self._load_cache(img_path)
        if cached is not None:
            all_text, all_details = cached
        else:
            try:
                result, elapse = self._ocr(str(img_path))
                if not result:
                    return "", [], False
                all_text_lines = []
                all_details = []
                for item in result:
                    box, text, confidence = item
                    conf = float(confidence)
                    all_text_lines.append(text)
                    all_details.append({
                        "text": text,
                        "confidence": conf,
                        "box": box
                    })
                all_text = "\n".join(all_text_lines)
                # Save full unfiltered result to cache
                self._save_cache(img_path, all_text, all_details)
            except Exception as e:
                print(f"Error performing OCR on {img_path}: {e}")
                return "", [], False

        # Apply confidence filter on top of full results (works for both cache and fresh)
        if confidence_threshold > 0.0:
            filtered = [d for d in all_details if d["confidence"] >= confidence_threshold]
            filtered_text = "\n".join(d["text"] for d in filtered)
            return filtered_text, filtered, cached is not None
        return all_text, all_details, cached is not None

    def match_keywords(
        self,
        full_text: str,
        keywords: List[str],
        match_logic: str = "any",
        use_regex: bool = False,
        exclude_keywords: List[str] = None
    ) -> Tuple[bool, List[str], List[str]]:
        """
        Checks if OCR text matches keywords based on 'any' or 'all' logical operators.
        Supports plain substring matching (spaces/without-spaces for CJK robustness)
        and regex matching. Also supports exclusion keywords — if any exclusion
        keyword matches, the result is False regardless of include matches.
        
        Returns:
            - boolean: True if it matches (and no exclusion keyword matched)
            - list of strings: the specific lines/snippets where the keywords were found
            - list of strings: the original keywords that actually matched
        """
        if not keywords:
            return False, [], []
        
        valid_kws = [kw.strip() for kw in keywords if kw.strip()]
        if not valid_kws:
            return False, [], []
        
        # Validate regex patterns upfront
        if use_regex:
            try:
                for kw in valid_kws + (exclude_keywords or []):
                    re.compile(kw)
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {e}")
        
        matched_kws = []
        for kw in valid_kws:
            if use_regex:
                if re.search(kw, full_text, re.IGNORECASE):
                    matched_kws.append(kw)
            else:
                kw_lower = kw.lower()
                full_text_lower = full_text.lower()
                full_text_no_spaces = "".join(full_text_lower.split())
                if kw_lower in full_text_lower or kw_lower in full_text_no_spaces:
                    matched_kws.append(kw)
        
        if match_logic == "all":
            is_match = len(matched_kws) == len(valid_kws)
        else:
            is_match = len(matched_kws) > 0
        
        # Exclusion keyword check
        if is_match and exclude_keywords:
            for ex_kw in exclude_keywords:
                ex_kw = ex_kw.strip()
                if not ex_kw:
                    continue
                if use_regex:
                    if re.search(ex_kw, full_text, re.IGNORECASE):
                        return False, [], []
                else:
                    ex_lower = ex_kw.lower()
                    full_text_lower = full_text.lower()
                    full_text_no_spaces = "".join(full_text_lower.split())
                    if ex_lower in full_text_lower or ex_lower in full_text_no_spaces:
                        return False, [], []
        
        snippets = []
        if is_match:
            lines = full_text.split('\n')
            matched_kws_lower = {k.lower() for k in matched_kws}
            for line in lines:
                line_stripped = line.strip()
                if not line_stripped:
                    continue
                for kw_orig in matched_kws:
                    if use_regex:
                        if re.search(kw_orig, line_stripped, re.IGNORECASE):
                            snippets.append(line_stripped)
                            break
                    else:
                        ll = line_stripped.lower()
                        lns = "".join(ll.split())
                        kwl = kw_orig.lower()
                        if kwl in ll or kwl in lns:
                            snippets.append(line_stripped)
                            break
                        
        return is_match, snippets, matched_kws


    def copy_file_resolve_conflict(self, src: Path, dest_dir: Path) -> Tuple[Path, bool]:
        """Copies file to dest_dir, resolving naming conflicts by appending _1, _2 etc.
        Returns (destination_path, is_duplicate) — is_duplicate is True when an identical
        file (same name + size) already existed and was reused instead of re-copied."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        filename = src.name
        name_part = src.stem
        ext_part = src.suffix
        
        dest_file = dest_dir / filename
        src_size = src.stat().st_size
        # Duplicate check: same name + same size -> reuse existing file
        if dest_file.exists() and dest_file.stat().st_size == src_size:
            return dest_file, True
        
        counter = 1
        while dest_file.exists():
            dest_file = dest_dir / f"{name_part}_{counter}{ext_part}"
            counter += 1
            
        shutil.copy2(src, dest_file)
        return dest_file, False

    def scan_and_organize(
        self,
        target_dir: str,
        dest_dir: str,
        keywords: List[str],
        match_logic: str = "any",
        recursive: bool = True,
        use_regex: bool = False,
        exclude_keywords: List[str] = None,
        confidence_threshold: float = 0.0
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Generator yielding real-time scanning progress updates.
        """
        self.reset_cancel()
        _settings = load_settings()
        _max_snippets = _settings.max_snippets_per_match
        try:
            images = self.get_all_images(target_dir, recursive)
        except Exception as e:
            yield {
                "status": "error",
                "message": f"Failed to access target directory: {str(e)}"
            }
            return

        total_files = len(images)
        if total_files == 0:
            yield {
                "status": "complete",
                "total_files": 0,
                "processed_files": 0,
                "matched_files": 0,
                "message": "No images found in the target directory."
            }
            return

        dest_path = Path(dest_dir)
        try:
            dest_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            yield {
                "status": "error",
                "message": f"Failed to create or access destination directory: {str(e)}"
            }
            return

        processed_files = 0
        matched_files = 0
        cached_files = 0
        
        yield {
            "status": "starting",
            "total_files": total_files,
            "processed_files": 0,
            "matched_files": 0,
            "cached_files": 0
        }

        for img_path in images:
            if self._cancel_event.is_set():
                yield {
                    "status": "cancelled",
                    "total_files": total_files,
                    "processed_files": processed_files,
                    "matched_files": matched_files,
                    "cached_files": cached_files,
                    "message": f"Scan cancelled by user after processing {processed_files} of {total_files} images."
                }
                return

            processed_files += 1
            
            # Perform OCR (or load from cache)
            full_text, detailed_results, from_cache = self.extract_text_and_boxes(img_path, confidence_threshold=confidence_threshold)
            if from_cache:
                cached_files += 1
            
            # Check match
            is_match, snippets, matched_kws = self.match_keywords(
                full_text, keywords, match_logic,
                use_regex=use_regex, exclude_keywords=exclude_keywords
            )
            
            copied_paths = []
            is_duplicate = False
            if is_match:
                if match_logic == "all":
                    # AND mode: single folder named "A & B"
                    combined_name = " & ".join(matched_kws)
                    safe_folder = sanitize_folder_name(combined_name)
                    subfolder = dest_path / safe_folder
                    try:
                        copied_file, dup = self.copy_file_resolve_conflict(img_path, subfolder)
                        copied_paths.append(str(copied_file))
                        if dup: is_duplicate = True
                    except Exception as e:
                        print(f"ERROR: Error copying file {img_path} to {subfolder}: {e}")
                else:
                    # ANY mode: per-keyword folders
                    for kw in matched_kws:
                        safe_kw_folder = sanitize_folder_name(kw)
                        subfolder = dest_path / safe_kw_folder
                        try:
                            copied_file, dup = self.copy_file_resolve_conflict(img_path, subfolder)
                            copied_paths.append(str(copied_file))
                            if dup: is_duplicate = True
                        except Exception as e:
                            print(f"ERROR: Error copying file {img_path} to {subfolder}: {e}")

                if copied_paths:
                    matched_files += 1
            
            had_copy = bool(copied_paths)
            copied_path_str = ", ".join(copied_paths) if copied_paths else None
            
            # Yield progress for this file
            yield {
                "status": "scanning",
                "total_files": total_files,
                "processed_files": processed_files,
                "matched_files": matched_files,
                "cached_files": cached_files,
                "from_cache": from_cache,
                "current_file": str(img_path.relative_to(target_dir)),
                "current_full_path": str(img_path),
                "is_match": had_copy,
                "match_details": {
                    "filename": img_path.name,
                    "original_path": str(img_path),
                    "copied_path": copied_path_str,
                    "is_duplicate": is_duplicate,
                    "snippets": snippets[:_max_snippets],  # Limit snippets for display brevity
                    "matched_keywords": matched_kws
                } if had_copy else None
            }



        yield {
            "status": "complete",
            "total_files": total_files,
            "processed_files": processed_files,
            "matched_files": matched_files,
            "cached_files": cached_files,
            "message": f"Successfully completed. Processed {processed_files} images ({cached_files} from cache), found {matched_files} matches."
        }
