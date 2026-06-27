import tkinter as tk
from tkinter import filedialog
import threading
from typing import Optional

def _open_picker(result_container: list) -> None:
    """Helper running in a separate thread to open the folder picker dialog."""
    try:
        root = tk.Tk()
        root.withdraw()
        # Keep window topmost so it doesn't get hidden behind the browser
        root.attributes('-topmost', True)
        root.focus_force()
        
        folder = filedialog.askdirectory(
            parent=root,
            title="Select Folder",
            mustexist=True
        )
        result_container.append(folder)
        root.destroy()
    except Exception as e:
        result_container.append(e)

def choose_directory() -> Optional[str]:
    """
    Opens a native directory selection dialog and returns the selected path.
    Runs the tkinter dialog in a separate thread to avoid freezing the main process.
    """
    result = []
    # Run tkinter on a separate thread to ensure thread-safety and prevent GUI freeze
    thread = threading.Thread(target=_open_picker, args=(result,))
    thread.start()
    thread.join()
    
    if not result:
        return None
    
    val = result[0]
    if isinstance(val, Exception):
        raise val
        
    return val if val else None
