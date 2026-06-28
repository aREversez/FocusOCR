# FocusOCR - Local Image Search & Organizer

FocusOCR is a lightweight, high-fidelity local desktop/web application that allows you to scan a directory for images (such as screenshots), perform high-accuracy Optical Character Recognition (OCR) supporting both Chinese and English, filter them using up to three keywords, and automatically organize copies of matching images into folders named after those keywords.

This is ideal for anyone who accumulates a large volume of screenshots, reference documents, or slide grabs and wants to instantly locate and group files mentioning specific terms (e.g., "Invoice", "Meeting Notes", "Receipt").

---

## Key Features

- **Local & Private**: Runs 100% offline. No images are uploaded to external APIs. No external fonts or CDNs required.
- **Accurate Chinese & English OCR**: Powered by **RapidOCR** (using ONNX Runtime and the state-of-the-art PaddleOCR PP-OCRv4 model weights).
- **Keyword Subdirectory Auto-Sorting**: Automatically creates folders inside your destination directory named after the matching keywords (e.g., `dest_folder/Invoice/`, `dest_folder/Report/`) and places matching copies inside.
- **Folder Selection History**: Keeps track of recently selected directories for both Target and Destination fields via `localStorage`. Items can be deleted from history at any time.
- **Scan History**: Automatically saves the last 10 scan results (keywords, match stats, file paths, OCR snippets) to `localStorage`. Click any record to restore the form fields and gallery — even after clearing results or closing the browser.
- **Multi-Keyword Matching**: Supports filtering using up to 3 keywords with logical operator controls (Match **ANY** vs. Match **ALL**).
- **Real Scan Cancellation**: The Stop button actually interrupts the scan server-side — no wasted OCR work after cancellation.
- **Modern User Interface**: A responsive glassmorphic dashboard featuring statistical cards, real-time progress bars, and a clean result card gallery.
- **Integrated Preview & Lightbox**: Review matching screenshots directly within the browser with highlighted keyword matches in detected text snippets.
- **Native Folder Browser**: Integrates directly with native Windows directory dialogs, avoiding sandbox folder selection limits.
- **Conflict Resolution**: Auto-renames files (e.g., `screenshot_1.png`) if duplicates are found in the destination directory to avoid overwriting.

---

## Project Structure

The project code is organized as follows:
- **[main.py](file:///n:/AI/images-keyword/main.py)**: The application entrypoint. Automatically spins up the backend and launches the web interface.
- **[backend/app.py](file:///n:/AI/images-keyword/backend/app.py)**: The FastAPI server that handles HTTP requests, serves static files, and streams scan progress via Server-Sent Events (SSE). Includes a `/api/stop-scan` endpoint for cancellation.
- **[backend/ocr_engine.py](file:///n:/AI/images-keyword/backend/ocr_engine.py)**: The core OCR engine which uses RapidOCR to parse images, match keywords, and copy files. Supports server-side cancellation via `threading.Event`.
- **[backend/config.py](file:///n:/AI/images-keyword/backend/config.py)**: User-configurable settings (port, host, OCR snippet limits, etc.) loaded from `~/.focusocr/config.json`.
- **[backend/folder_picker.py](file:///n:/AI/images-keyword/backend/folder_picker.py)**: Tkinter dialog wrapper providing native Windows folder pickers, running in a separate thread with thread-safe result passing.
- **[frontend/index.html](file:///n:/AI/images-keyword/frontend/index.html)**: The dashboard markup structure.
- **[frontend/style.css](file:///n:/AI/images-keyword/frontend/style.css)**: The CSS styling (dark mode, animations, custom scrollbars) using native system font stacks — no external font downloads.
- **[frontend/app.js](file:///n:/AI/images-keyword/frontend/app.js)**: Orchestrates client UI actions, SSE streams, lightbox triggers, clipboard copies, and history management.

---

## Standalone Executable (Zero Setup)

For machines without Python or any library packages installed, you can run FocusOCR directly:
1. Navigate to the `dist/` directory inside the project folder: **[dist/FocusOCR.exe](file:///n:/AI/images-keyword/dist/FocusOCR.exe)**.
2. Double-click **`FocusOCR.exe`** to launch the application.
3. A terminal window will open to display the server initialization logs, and your default web browser will automatically load the dashboard.
4. Simply close the terminal window or press `Ctrl+C` inside it to stop the server at any time.

*Note: On your first scan, the executable will automatically download the small, optimized PP-OCRv4 detection and recognition models (under 30MB combined) into your Windows user profile folder (`~/.rapidocr/`). All subsequent scans run completely offline.*

---

## Developer Setup (Running from Source)

If you prefer to run from the Python source:

### Prerequisites
Make sure you have **Python 3.8+** installed. Run the following command to install the required packages:

```bash
pip install fastapi uvicorn Pillow rapidocr_onnxruntime
```

### Running the App
```bash
python main.py
```

The server starts on **port 9000** by default (falls back to 9001, 9002, etc. if occupied). You can change the default port and other settings via `~/.focusocr/config.json` (see [Configuration](#configuration)).

### Compiling to Standalone Executable
If you modify the source files and wish to rebuild the `.exe`, install PyInstaller and run:
```bash
pip install pyinstaller
pyinstaller --clean FocusOCR.spec
```
This creates a fresh executable inside the `dist/` directory. The `.spec` file is pre-configured with all necessary hidden imports, data bundling, and unused-package exclusions to keep the binary size small.

---

## Configuration

Settings are stored in `~/.focusocr/config.json` and are created with defaults on first run. You can edit this file to change:

```json
{
  "host": "127.0.0.1",
  "start_port": 9000,
  "ocr_confidence_threshold": 0.0,
  "max_snippets_per_match": 3,
  "max_history_per_dir": 5
}
```

| Setting | Default | Description |
|---|---|---|
| `host` | `"127.0.0.1"` | Bind address for the web server |
| `start_port` | `9000` | First port to try; scans 9000, 9001, ... if busy |
| `ocr_confidence_threshold` | `0.0` | Minimum OCR confidence to include a text result (0.0 = accept all) |
| `max_snippets_per_match` | `3` | Number of text snippets shown per matched image in the gallery |
| `max_history_per_dir` | `5` | Number of recent directories kept in the folder history dropdown |

---

## How to Use

1. **Launch the app**:
   Navigate to the project root and run:
   ```bash
   python main.py
   ```
2. **Configure Folder Directories**:
   - Under **Target Directory**, click **Browse** and select the folder containing your source images/screenshots.
   - Under **Destination Directory**, click **Browse** and select the folder where you want your sorted keyword folders to be created.
3. **Configure Keywords**:
   - Type in your target terms (e.g., keyword 1: `Invoice`, keyword 2: `Report`).
   - Select your search logic:
     - **Match ANY keyword (OR)**: Copies the image if it contains *at least one* of the specified keywords.
     - **Match ALL keywords (AND)**: Copies the image only if it contains *all* of the specified keywords.
   - Toggle **Scan subfolders recursively** if you want to inspect folders within the target directory.
4. **Run the Scan**:
   - Click **Start OCR Scan**.
   - Watch the progress bar stream. Matched files will copy instantly into folders like `dest_folder/Invoice/` and `dest_folder/Report/` (if an image matches multiple keywords, a copy will be sorted into each corresponding folder for easy review).
   - Click **Stop Scan** to cancel a running scan — processing halts immediately server-side.
5. **View Results**:
   - Matches will dynamically load in the gallery card grid.
   - Click **Preview** or tap the thumbnail to open the Lightbox view and check the image in full size along with the matching OCR text snippets.
    - Click **Copy Path** to quickly copy the local absolute path of the original image.
6. **Review Past Scans**:
    - The **Scan History** panel in the sidebar lists your last 10 scans with keywords, date, and match count.
    - Click any entry to restore the form fields and gallery for that scan.
    - Hover and click the **×** button to delete individual records.

---

## Tech Details & Libraries Used

- **Web Server**: [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) (Python)
- **OCR Engine**: [RapidOCR ONNX Runtime](https://github.com/RapidAI/RapidOCR)
- **Image Processing**: [Pillow (PIL)](https://python-pillow.org/)
- **Native GUI Dialogs**: [Tkinter](https://docs.python.org/3/library/tkinter.html)
- **Frontend UI**: Vanilla HTML5, ES6+ Javascript, CSS3 (No heavy external frameworks required)
