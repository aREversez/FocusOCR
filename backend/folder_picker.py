import threading
import queue
from typing import Optional

DIALOG_TIMEOUT = 120  # seconds before folder picker thread is abandoned


def _open_picker(result_queue: queue.Queue) -> None:
    """Helper running in a separate thread to open the folder picker dialog."""
    import tkinter as tk
    from tkinter import filedialog
    try:
        root = tk.Tk()
        root.withdraw()
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
    Falls back to None if the dialog does not respond within DIALOG_TIMEOUT seconds.
    """
    result_queue: queue.Queue = queue.Queue()
    thread = threading.Thread(target=_open_picker, args=(result_queue,))
    thread.start()
    thread.join(timeout=DIALOG_TIMEOUT)

    if thread.is_alive():
        return None  # timeout — abandon the dialog thread

    if result_queue.empty():
        return None

    val = result_queue.get()
    if isinstance(val, Exception):
        raise val

    return val if val else None
