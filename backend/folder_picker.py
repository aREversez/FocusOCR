import tkinter as tk
from tkinter import filedialog
import threading
import queue
from typing import Optional

def _open_picker(result_queue: queue.Queue) -> None:
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
        result_queue.put(folder)
        root.destroy()
    except Exception as e:
        result_queue.put(e)

def choose_directory() -> Optional[str]:
    """
    Opens a native directory selection dialog and returns the selected path.
    Runs the tkinter dialog in a separate thread to avoid freezing the main process.
    """
    result_queue: queue.Queue = queue.Queue()
    thread = threading.Thread(target=_open_picker, args=(result_queue,))
    thread.start()
    thread.join()

    if result_queue.empty():
        return None

    val = result_queue.get()
    if isinstance(val, Exception):
        raise val

    return val if val else None
