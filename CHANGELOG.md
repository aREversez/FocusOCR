# Changelog

All notable changes to FocusOCR are documented here, newest first. This mirrors the
project's [GitHub Releases](https://github.com/aREversez/FocusOCR/releases), consolidated
into one file for convenience.

---

## [V1.0.6] - 2026-07-11

### Correctness / Robustness
- **Pydantic settings validation** — `POST /api/settings` uses `SettingsUpdate(BaseModel)`
  with typed fields; invalid types are rejected by FastAPI automatically.
- **Content-hash based dedup** — `copy_file_resolve_conflict` uses SHA-256 (first 64KB +
  last 64KB + file size) instead of filename+size comparison. Hash is computed only on
  collision; numbered variants (`_1`, `_2`, ...) are checked against the hash too.
- **Scan concurrency lock** — overlapping scans return `409`; a heartbeat-based lease
  (60s) auto-reclaims locks from disconnected clients; a generation token prevents
  stale `finally` blocks from abandoned generators from releasing a newer scan's lock.

### Performance
- Cache empty OCR results — no-text images no longer re-scanned each run.
- Precompute lowercase forms — `match_keywords` computes `full_text.lower()` /
  `full_text_no_spaces` once at function entry instead of per keyword/line.
- Stop reloading settings per image — `_load_cache` / `_save_cache` receive
  `enable_ocr_cache` as a parameter instead of calling `load_settings()` from disk on
  every file.

### Security
- Dangerous endpoints changed to POST — `/api/stop-scan`, `/api/clear-ocr-cache`,
  `/api/clear-thumb-cache` now require POST.
- CORS restricted to `localhost` / `127.0.0.1` only (was wildcard).

### Observability
- `/api/cache-stats` now returns OCR + thumbnail file counts and total sizes in MB.
- Scan yields `{"status": "counting"}` before file enumeration, for immediate UI
  feedback on large directories.

### Testing & CI
- 10 new tests: content hash, `copy_file_resolve_conflict` (4 scenarios), scan lock
  (acquire/release, double-acquire, stale reclaim + generation guard), Pydantic
  validation.
- GitHub Actions workflow runs `unittest discover` on push/PR to `main` and `dev`.

### Removed
- Dead `except (BrokenPipeError, ConnectionResetError)` in `app.py`'s
  `event_generator`.

---

## [V1.0.5] - 2026-07-09

### Features
- **Preview Mode** — destination directory is now optional. Leave it empty to scan and
  find matches without copying files. A "Preview Only" badge appears in the UI, and the
  stats label changes from "Matched & Copied" to "Matched". Useful for quick searches,
  testing, or read-only exploration.

### Bug Fixes
- History load crash — fixed `match.snippets` being `undefined` when loading history
  records saved before the `snippets` field existed (`app.js`).
- Scan crash on deleted files — fixed a race condition where a file deleted between
  `glob()` and `sorted()` caused `FileNotFoundError` (`ocr_engine.py`).
- Match count divergence — fixed the frontend `matchedFiles` count drifting from the
  server's `matched_files` counter when all copy operations failed (disk full,
  permissions) (`ocr_engine.py`).

### Improvements
- Venv-based build workflow — the project now uses a dedicated virtual environment to
  avoid `onnxruntime` vs `onnxruntime-directml` package conflicts.
- Dynamic spec paths — `FocusOCR.spec` resolves site-packages dynamically instead of
  hardcoded absolute paths, enabling builds from any Python environment.
- Exe icon restored — added the missing `icon=` parameter to `EXE()` in
  `FocusOCR.spec`.
- GPU diagnostic warning — when `DirectML.dll` is present but the DML provider is
  hidden by a CPU-only `onnxruntime` override, the console shows a clear warning with
  the fix command.

### Decisions
- Preview mode: no file copying, no overlap validation, match counter still
  increments — the user sees real results without filesystem side effects.
- Build: always use the venv
  (`.\venv\Scripts\pyinstaller --distpath dist_new FocusOCR.spec`) to guarantee correct
  DLL bundling.

---

## [V1.0.4] - 2026-07-01

### Bug Fixes
- History Loader — fixed a crash occurring when loading older history records that
  lacked the `snippets` field.
- File Scanner — fixed a race condition where files deleted during a scan would crash
  the application.
- Match Counter — fixed a divergence between the frontend match card display and the
  server-side match count that occurred when file copy operations failed.

### Build & Stability Improvements
- Standalone Exe — resolved conflicts between `onnxruntime` and
  `onnxruntime-directml` by moving to a dedicated venv-based build workflow. The exe
  now dynamically bundles the necessary DirectML DLLs at build time, ensuring stable
  GPU acceleration regardless of host environment. Fixed a missing icon in the
  standalone executable.
- GPU Diagnostics — added a console warning to help diagnose when a CPU-only version
  of `onnxruntime` has overridden the DirectML-enabled version, including explicit
  instructions on how to fix the Python environment.

### Technical Note
- Venv build workflow — the build process now requires an activated venv to ensure all
  dependencies (especially `onnxruntime-directml`) are correctly bundled:
  `.\venv\Scripts\pyinstaller --distpath dist_new FocusOCR.spec`.

---

## [V1.0.3] - 2026-06-29

### Features
- **GPU acceleration (DirectML)** — auto-detects `DmlExecutionProvider` on startup;
  enables GPU inference for Det/Cls/Rec models. Falls back to CPU if unavailable.
  Install `onnxruntime-directml` to activate.
- **Duplicate detection** — `copy_file_resolve_conflict` checks same name+size in the
  destination before copying; reuses the existing file and returns an `is_duplicate`
  flag. SSE events carry `is_duplicate` in `match_details`.
- **"Dup" badge** — matched cards from duplicate files show a green ● Dup badge on the
  card title row with a tooltip explaining the file was reused.
- **Toast notifications** — `showToast(message, type)` replaces all 8 `alert()` calls
  with auto-dismissing toast messages (error/warning/success/info), bottom-right
  positioning with slide-in animation.

### Improvements
- Container width — increased `max-width` from 1600px to 1800px for better use of wide
  screens.
- Simplified frontend logic — duplicate badge rendering lives in
  `addMatchToGallery()` rather than in the SSE event handler; the history loader
  reuses the same function.

### Decisions
- GPU: automatic detection via `get_available_providers()` — no UI toggle needed.
  Works with DirectML (any GPU) or CUDA (NVIDIA only).
- Duplicate key: filename + file size only (fast, no hash) — later replaced with
  content-hash comparison in V1.0.6.
- Toast: 3.5s auto-dismiss, no confirmation buttons. `confirm()` dialogs preserved for
  destructive actions (cache clear).

---

## [V1.0.2] - 2026-06-28

### Features
- **Cache hit reporting** — a 4th "From Cache" stat card shows how many images were
  served from cache; a small ● Cache badge appears on each matched card that came from
  cache.
- **Clear OCR Cache** — button in the settings panel with a tooltip explaining what it
  does; calls `/api/clear-ocr-cache`, which deletes all `ocr_cache/*.json` files.
- **Clear Thumbnail Cache** — button alongside, with its own tooltip; calls
  `/api/clear-thumb-cache`, which deletes all `thumb_cache/*.webp` files.
- **`/api/cache-stats`** — JSON endpoint returning the OCR cache file count.
- **`cached_files` in scan history** — persisted in `localStorage` records, restored
  when loading a past scan.
- **Keyboard shortcuts** — `Ctrl+Enter` starts a scan, `Ctrl+Shift+E` toggles the export
  dropdown, `Esc` closes the lightbox or export menu.
- **OCR confidence slider** — range slider (0–1, step 0.05) excludes low-confidence
  text from keyword matching; live value display; persisted per-scan in history
  records.
- **Search within results** — text input in the results header filters gallery cards
  client-side by filename, path, or snippet text; updates the match count badge in
  real time.
- **Config UI** — "Enable OCR cache" toggle in the settings sidebar, loaded from and
  persisted to `~/.focusocr/config.json` via `GET`/`POST /api/settings`.

### Improvements
- Confidence tooltips — both the label and the slider input have `title` attributes
  describing how the threshold works.
- Confidence stored in history — `confidence_threshold` saved per-scan and restored
  when loading a past scan.
- Stats grid — changed from a 3-column to a 4-column layout with responsive
  breakpoints (4 → 2 → 1 columns).
- Button tooltips — both cache buttons have `title` attributes explaining exactly what
  the action does.

---

## [V1.0.1] - 2026-06-28

### New Features
- **Open in Explorer** — each result card has an "Open" button that reveals the file
  in Windows Explorer.
- **Thumbnail previews** — gallery images are now served as cached 600px WebP
  thumbnails (faster loading, retina-ready).
- **Export CSV / JSON** — "Export" button in the results header downloads matched
  results as CSV (UTF-8 BOM for Chinese support) or JSON.
- **Header logo as exe icon** — the document+magnifying-glass logo is now used for
  `FocusOCR.exe`.
- **Regex keyword matching** — a `.*` toggle per scan matches keywords as regular
  expressions.
- **Exclusion keywords** — up to 2 exclude-keywords (red badges) that reject matched
  images.
- **Light theme** — toggle via ☀️/🌙 button; persisted in `localStorage`.
- **Scan history** — the last 10 scans are saved client-side; click to restore
  parameters and gallery.

### Improvements
- Gallery grid — tighter 200px columns for 5–6 images per row.
- Card buttons — compact icon+label layout ("Copy", "Open", "View") that fits the
  smaller card width.
- Thumbnail quality — increased to 600px max dimension, 95% WebP quality.
- CSV encoding — prepended UTF-8 BOM so Chinese characters display correctly in Excel.

### Fixes
- Regex patterns with commas (like `\d{3,5}`) — comma-splitting removed from backend
  keyword parsing.
- Regex backslash in folder names — `\` replaced with `_` instead of being stripped.
- Light theme select arrow — `background` shorthand (which reset repeat/position)
  changed to `background-color`.
- History render crash — `escapeHTML()` now coerces numbers with `String(str)` before
  calling `.replace()`.

### Removed
- Drag-and-drop — removed after browser security restrictions prevented reliable
  full-path extraction.

---

## [V1.0.0] - 2026-06-28

**FocusOCR — Local Image Search & Organizer.** Initial tagged release: a fully
offline, standalone desktop app that OCR-scans directories for keywords and
auto-sorts matched images into keyword-named folders. No internet, no cloud APIs, no
Python setup required.

### Features
- **100% offline OCR** — RapidOCR (PP-OCRv4) for Chinese & English text recognition.
- **Multi-keyword matching** — up to 3 keywords with ANY/ALL logic.
- **Smart folder sorting** — creates per-keyword subdirectories; AND mode combines
  matches into a single "A & B" folder.
- **Real cancellation** — Stop button truly halts processing server-side.
- **Scan history** — last 10 scans saved to `localStorage` with keyword, date, and
  stats; click to restore.
- **Folder history** — recent directories saved in the browser for one-click reuse.
- **Lightbox preview** — click thumbnails for a full-size view with highlighted OCR
  snippets.
- **Native folder picker** — Windows directory dialog via Tkinter.
- **Conflict-safe** — auto-renames duplicates instead of overwriting.

### Technical
- Runs on port 9000 (fallback 9001, 9002, ...), configurable via
  `~/.focusocr/config.json`.
- Standalone `FocusOCR.exe` (~110 MB), no Python or dependencies required.
- First run auto-downloads OCR models (~30 MB) to `~/.rapidocr/`.