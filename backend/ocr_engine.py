import os
import shutil
import time
import re
import threading
from typing import List, Generator, Dict, Any, Tuple
from pathlib import Path
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from backend.config import load_settings

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
        # Initialize RapidOCR engine
        self._ocr = RapidOCR()
        self._cancel_event = threading.Event()

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
        return sorted(images, key=lambda x: x.stat().st_mtime, reverse=True)

    def extract_text_and_boxes(self, img_path: Path) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Runs OCR on the image.
        Returns:
            - Full text joined by newlines.
            - A list of dicts containing text, confidence, and bounding box coordinates.
        """
        try:
            # RapidOCR handles path strings directly
            result, elapse = self._ocr(str(img_path))
            if not result:
                return "", []
            
            full_text_lines = []
            detailed_results = []
            
            for item in result:
                box, text, confidence = item
                # box is standard: [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
                full_text_lines.append(text)
                
                # Format coordinates for easy use in frontend if needed
                detailed_results.append({
                    "text": text,
                    "confidence": float(confidence),
                    "box": box
                })
                
            return "\n".join(full_text_lines), detailed_results
        except Exception as e:
            # Log error or print, return empty
            print(f"Error performing OCR on {img_path}: {e}")
            return "", []

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


    def copy_file_resolve_conflict(self, src: Path, dest_dir: Path) -> Path:
        """Copies file to dest_dir, resolving naming conflicts by appending _1, _2 etc."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        filename = src.name
        name_part = src.stem
        ext_part = src.suffix
        
        dest_file = dest_dir / filename
        counter = 1
        while dest_file.exists():
            dest_file = dest_dir / f"{name_part}_{counter}{ext_part}"
            counter += 1
            
        shutil.copy2(src, dest_file)
        return dest_file

    def scan_and_organize(
        self,
        target_dir: str,
        dest_dir: str,
        keywords: List[str],
        match_logic: str = "any",
        recursive: bool = True,
        use_regex: bool = False,
        exclude_keywords: List[str] = None
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
        
        yield {
            "status": "starting",
            "total_files": total_files,
            "processed_files": 0,
            "matched_files": 0
        }

        for img_path in images:
            if self._cancel_event.is_set():
                yield {
                    "status": "cancelled",
                    "total_files": total_files,
                    "processed_files": processed_files,
                    "matched_files": matched_files,
                    "message": f"Scan cancelled by user after processing {processed_files} of {total_files} images."
                }
                return

            processed_files += 1
            
            # Perform OCR
            full_text, detailed_results = self.extract_text_and_boxes(img_path)
            
            # Check match
            is_match, snippets, matched_kws = self.match_keywords(
                full_text, keywords, match_logic,
                use_regex=use_regex, exclude_keywords=exclude_keywords
            )
            
            copied_paths = []
            if is_match:
                if match_logic == "all":
                    # AND mode: single folder named "A & B"
                    combined_name = " & ".join(matched_kws)
                    safe_folder = sanitize_folder_name(combined_name)
                    subfolder = dest_path / safe_folder
                    try:
                        copied_file = self.copy_file_resolve_conflict(img_path, subfolder)
                        copied_paths.append(str(copied_file))
                    except Exception as e:
                        print(f"Error copying file {img_path} to {subfolder}: {e}")
                else:
                    # ANY mode: per-keyword folders
                    for kw in matched_kws:
                        safe_kw_folder = sanitize_folder_name(kw)
                        subfolder = dest_path / safe_kw_folder
                        try:
                            copied_file = self.copy_file_resolve_conflict(img_path, subfolder)
                            copied_paths.append(str(copied_file))
                        except Exception as e:
                            print(f"Error copying file {img_path} to {subfolder}: {e}")

                if copied_paths:
                    matched_files += 1
            
            copied_path_str = ", ".join(copied_paths) if copied_paths else None
            
            # Yield progress for this file
            yield {
                "status": "scanning",
                "total_files": total_files,
                "processed_files": processed_files,
                "matched_files": matched_files,
                "current_file": str(img_path.relative_to(target_dir)),
                "current_full_path": str(img_path),
                "is_match": is_match,
                "match_details": {
                    "filename": img_path.name,
                    "original_path": str(img_path),
                    "copied_path": copied_path_str,
                    "snippets": snippets[:_max_snippets],  # Limit snippets for display brevity
                    "matched_keywords": matched_kws
                } if is_match else None
            }


        yield {
            "status": "complete",
            "total_files": total_files,
            "processed_files": processed_files,
            "matched_files": matched_files,
            "message": f"Successfully completed. Processed {processed_files} images, found {matched_files} matches."
        }
