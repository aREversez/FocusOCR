import json
import sys
import os
import io
import asyncio
import hashlib
import subprocess
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

# Same frozen-path setup as main.py, needed because this module also
# imports sibling modules within the backend package.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    sys.path.insert(0, sys._MEIPASS)

from .folder_picker import choose_directory
from .ocr_engine import OCREngine, IMAGE_EXTENSIONS
from .config import load_settings, save_settings, Settings, SettingsUpdate


def _silence_transport_reset(loop, context):
    """Silence the benign ConnectionResetError that appears when a client
    disconnects from an SSE stream on Windows (proactor event loop)."""
    exc = context.get("exception")
    msg = context.get("message", "")
    if isinstance(exc, ConnectionResetError) and "_call_connection_lost" in msg:
        return
    loop.default_exception_handler(context)


app = FastAPI(title="Image Keyword OCR Organizer")


@app.on_event("startup")
async def _setup_loop_handler():
    """Install the exception handler on the active event loop uvicorn created."""
    try:
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(_silence_transport_reset)
    except RuntimeError:
        pass  # No running loop; nothing to do.

# CORS restricted to localhost origins (frontend served from same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://127.0.0.1"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ocr_engine = OCREngine()

@app.get("/api/browse")
def browse_folder():
    """
    Opens a native folder dialog and returns the selected path.
    Runs in the FastAPI thread pool to avoid blocking the main async loop.
    """
    try:
        path = choose_directory()
        return {"path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open folder picker: {str(e)}")

@app.get("/api/image")
def get_image(path: str):
    """
    Serves an image from the local filesystem.
    Required because browsers block direct loading of file:// URLs.
    """
    decoded_path = urllib.parse.unquote(path)
    file_path = Path(decoded_path)
    
    if not file_path.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be absolute")
        
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Requested file is not a supported image format")
        
    return FileResponse(str(file_path))

@app.get("/api/reveal")
def reveal_in_explorer(path: str):
    """Opens the file's parent folder in Windows Explorer with the file selected."""
    decoded = urllib.parse.unquote(path)
    file_path = Path(decoded)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")
    try:
        system = os.name
        if system == 'nt':
            subprocess.Popen(['explorer', '/select,', str(file_path)])
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', '-R', str(file_path)])
        else:
            subprocess.Popen(['xdg-open', str(file_path.parent)])
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

THUMB_CACHE_DIR = Path.home() / ".focusocr" / "thumb_cache"
THUMB_MAX_SIZE = 600

@app.get("/api/thumbnail")
def get_thumbnail(path: str):
    """Serves a cached 300px WebP thumbnail of the requested image."""
    decoded = urllib.parse.unquote(path)
    file_path = Path(decoded)
    if not file_path.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported image format")

    stat = file_path.stat()
    cache_key = hashlib.md5(f"{file_path}_{THUMB_MAX_SIZE}_{stat.st_mtime_ns}_{stat.st_size}".encode()).hexdigest()
    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = THUMB_CACHE_DIR / f"{cache_key}.webp"

    if not cache_file.exists():
        try:
            img = Image.open(file_path)
            img = img.convert('RGB')
            w, h = img.size
            if w > THUMB_MAX_SIZE or h > THUMB_MAX_SIZE:
                if w > h:
                    new_w = THUMB_MAX_SIZE
                    new_h = int(h * THUMB_MAX_SIZE / w)
                else:
                    new_h = THUMB_MAX_SIZE
                    new_w = int(w * THUMB_MAX_SIZE / h)
                img = img.resize((new_w, new_h), Image.LANCZOS)
            img.save(cache_file, 'WEBP', quality=95)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate thumbnail: {str(e)}")

    return FileResponse(str(cache_file), media_type='image/webp')

@app.post("/api/clear-ocr-cache")
def clear_ocr_cache():
    """Deletes all cached OCR results."""
    try:
        removed = ocr_engine.clear_cache()
        return {"status": "ok", "removed": removed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/clear-thumb-cache")
def clear_thumb_cache():
    """Deletes all cached thumbnail images."""
    try:
        removed = 0
        if THUMB_CACHE_DIR.exists():
            for f in THUMB_CACHE_DIR.iterdir():
                if f.is_file():
                    f.unlink()
                    removed += 1
        return {"status": "ok", "removed": removed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cache-stats")
def cache_stats():
    """Returns cache statistics: OCR and thumbnail file counts and total sizes in MB."""
    from backend.config import OCR_CACHE_DIR
    ocr_count = 0
    ocr_size = 0
    if OCR_CACHE_DIR.exists():
        for f in OCR_CACHE_DIR.glob("*.json"):
            ocr_count += 1
            ocr_size += f.stat().st_size
    
    thumb_count = 0
    thumb_size = 0
    if THUMB_CACHE_DIR.exists():
        for f in THUMB_CACHE_DIR.iterdir():
            if f.is_file():
                thumb_count += 1
                thumb_size += f.stat().st_size
    
    return {
        "ocr_cache": {"files": ocr_count, "size_mb": round(ocr_size / (1024 * 1024), 1)},
        "thumb_cache": {"files": thumb_count, "size_mb": round(thumb_size / (1024 * 1024), 1)}
    }

RESULTS_DIR = Path.home() / ".focusocr" / "results"

@app.post("/api/save-results")
def save_results(data: dict):
    """Persists scan results to disk as a JSON file."""
    try:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"scan_{timestamp}.json"
        (RESULTS_DIR / filename).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"status": "ok", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/results")
def list_results():
    """Lists saved scan result files with metadata."""
    try:
        if not RESULTS_DIR.exists():
            return {"results": []}
        files = []
        for f in sorted(RESULTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if f.suffix == ".json":
                try:
                    st = f.stat()
                    data = json.loads(f.read_text(encoding="utf-8"))
                    files.append({
                        "filename": f.name,
                        "size": st.st_size,
                        "modified": st.st_mtime,
                        "total_files": data.get("metadata", {}).get("total_files", 0),
                        "matched_files": data.get("metadata", {}).get("matched_files", 0),
                        "date": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                    })
                except Exception:
                    continue
        return {"results": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/results/{filename}")
def get_result(filename: str):
    """Returns a saved scan result by filename."""
    try:
        file_path = RESULTS_DIR / filename
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="Result file not found")
        data = json.loads(file_path.read_text(encoding="utf-8"))
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
def get_settings():
    """Returns the current application settings."""
    from dataclasses import asdict
    settings = load_settings()
    return asdict(settings)

@app.post("/api/settings")
def update_settings(data: SettingsUpdate):
    """Updates application settings (partial update allowed, validated by Pydantic)."""
    current = load_settings()
    update_data = data.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(current, key, value)
    save_settings(current)
    from dataclasses import asdict
    return {"status": "ok", "settings": asdict(current)}

@app.post("/api/stop-scan")
def stop_scan():
    """Cancels an in-progress OCR scan."""
    ocr_engine.cancel_scan()
    return {"status": "cancelling"}

@app.get("/api/scan-stream")
def scan_stream(
    target_dir: str,
    dest_dir: str,
    keywords: List[str] = Query([]),
    match_logic: str = "any",
    recursive: bool = True,
    use_regex: bool = False,
    exclude_keywords: List[str] = Query([]),
    confidence_threshold: float = 0.0
):
    """
    Starts the OCR scan and streams real-time updates as Server-Sent Events (SSE).
    Returns 409 Conflict if a scan is already in progress.
    """
    if not ocr_engine.try_acquire_scan():
        raise HTTPException(status_code=409, detail="A scan is already in progress. Wait for it to complete or cancel it first.")

    if match_logic not in ("any", "all"):
        raise HTTPException(status_code=400, detail="match_logic must be 'any' or 'all'")

    # Clean keywords (frontend sends each as a separate param, no comma-splitting needed)
    clean_kws = [kw.strip() for kw in keywords if kw.strip()]

    if not clean_kws:
        raise HTTPException(status_code=400, detail="At least one valid keyword must be specified")
    
    # Clean exclusion keywords
    clean_ex_kws = [kw.strip() for kw in exclude_keywords if kw.strip()]

    target_path = Path(target_dir)
    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Target directory does not exist")

    if not dest_dir or not dest_dir.strip():
        dest_dir = ""

    if dest_dir:
        dest_path = Path(dest_dir)
        target_resolved = target_path.resolve()
        dest_resolved = dest_path.resolve()
        if target_resolved == dest_resolved or target_resolved in dest_resolved.parents or dest_resolved in target_resolved.parents:
            raise HTTPException(
                status_code=400,
                detail="Target and destination directories must not overlap or contain one another."
            )

    def event_generator():
        _scan_gen = ocr_engine._scan_generation  # snapshot for cleanup
        try:
            generator = ocr_engine.scan_and_organize(
                target_dir=target_dir,
                dest_dir=dest_dir,
                keywords=clean_kws,
                match_logic=match_logic,
                recursive=recursive,
                use_regex=use_regex,
                exclude_keywords=clean_ex_kws if clean_ex_kws else None,
                confidence_threshold=confidence_threshold
            )
            for event in generator:
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("status") in ("complete", "cancelled", "error"):
                    break
        except GeneratorExit:
            return
        except Exception as e:
            error_event = {
                "status": "error",
                "message": f"Scan failed due to an unexpected error: {str(e)}"
            }
            yield f"data: {json.dumps(error_event)}\n\n"
        finally:
            ocr_engine.release_scan(_scan_gen)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# Serve the frontend files. Make sure frontend folder exists first
def get_frontend_path():
    if hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / "frontend"
    return Path(__file__).parent.parent / "frontend"

frontend_path = get_frontend_path()
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")

