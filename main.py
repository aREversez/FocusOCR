import os
import sys
import webbrowser
import threading
import time
import socket
import uvicorn

# Ensure the project root is on sys.path so the backend package can be imported
# regardless of the current working directory from which main.py is launched.
_project_root = os.path.dirname(os.path.abspath(__file__))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

# PyInstaller one-file mode: the backend package is extracted to sys._MEIPASS.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    sys.path.insert(0, sys._MEIPASS)

from backend.config import load_settings
from backend.app import app

settings = load_settings()

def get_free_port(start_port: int = 9000) -> int:
    """Finds a free port on localhost starting from start_port."""
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
        port += 1

def open_browser(url: str):
    """Waits briefly for the server to start, then opens the web browser."""
    time.sleep(1.5)  # Wait for uvicorn to initialize
    print(f"Opening browser to {url}...")
    webbrowser.open(url)

if __name__ == "__main__":
    port = get_free_port(settings.start_port)
    url = f"http://localhost:{port}"
    
    # Start a background thread to launch the browser once uvicorn starts
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()
    
    # Run FastAPI app with Uvicorn using the direct app object (not a string)
    print(f"Starting server on port {port}... Press Ctrl+C to terminate.")
    uvicorn.run(app, host=settings.host, port=port, log_level="info")
