import json
import sys
import asyncio
import urllib.parse
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Same frozen-path setup as main.py, needed because this module also
# imports sibling modules within the backend package.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    sys.path.insert(0, sys._MEIPASS)

from .folder_picker import choose_directory
from .ocr_engine import OCREngine, IMAGE_EXTENSIONS


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

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

@app.get("/api/stop-scan")
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
    recursive: bool = True
):
    """
    Starts the OCR scan and streams real-time updates as Server-Sent Events (SSE).
    """
    if match_logic not in ("any", "all"):
        raise HTTPException(status_code=400, detail="match_logic must be 'any' or 'all'")

    # Clean and split keywords
    clean_kws = []
    for kw in keywords:
        # If keywords are passed as a single comma-separated string, split them
        if "," in kw:
            clean_kws.extend([k.strip() for k in kw.split(",") if k.strip()])
        elif kw.strip():
            clean_kws.append(kw.strip())

    if not clean_kws:
        raise HTTPException(status_code=400, detail="At least one valid keyword must be specified")

    target_path = Path(target_dir)
    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Target directory does not exist")

    def event_generator():
        try:
            generator = ocr_engine.scan_and_organize(
                target_dir=target_dir,
                dest_dir=dest_dir,
                keywords=clean_kws,
                match_logic=match_logic,
                recursive=recursive
            )
            for event in generator:
                try:
                    yield f"data: {json.dumps(event)}\n\n"
                except (BrokenPipeError, ConnectionResetError):
                    return
                if event.get("status") in ("complete", "cancelled", "error"):
                    break
        except (BrokenPipeError, ConnectionResetError, GeneratorExit):
            return
        except Exception as e:
            error_event = {
                "status": "error",
                "message": f"Scan failed due to an unexpected error: {str(e)}"
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# Serve the frontend files. Make sure frontend folder exists first
def get_frontend_path():
    if hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / "frontend"
    return Path(__file__).parent.parent / "frontend"

frontend_path = get_frontend_path()
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")

