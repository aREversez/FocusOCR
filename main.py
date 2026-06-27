import webbrowser
import threading
import time
import socket
import uvicorn

# Direct import so PyInstaller can trace the dependency chain
from backend.app import app

def get_free_port(start_port: int = 8000) -> int:
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
    port = get_free_port()
    url = f"http://localhost:{port}"
    
    # Start a background thread to launch the browser once uvicorn starts
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()
    
    # Run FastAPI app with Uvicorn using the direct app object (not a string)
    print(f"Starting server on port {port}... Press Ctrl+C to terminate.")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
