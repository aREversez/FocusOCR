# FocusOCR — Roadmap

> Vision for future releases. Items are grouped by priority tier.
> Tracked by git — update as priorities shift.

---

## Tier 1 — High Value (In Progress)

These provide the most user-facing benefit with reasonable implementation cost.

- **Keyboard shortcuts** — Ctrl+Enter to start scan, Esc to close lightbox, Ctrl+Shift+E to export
- **OCR confidence slider** — expose confidence threshold in UI to filter low-quality text matches (backend config already exists)
- **Search within results** — secondary text input that filters the matched gallery client-side without re-scanning
- **Config UI panel** — in-app form to edit port, confidence threshold, cache toggle instead of editing `~/.focusocr/config.json` manually

---

## Tier 2 — Quality of Life

These improve the day-to-day experience.

- **Toast notifications** — replace all `alert()` calls with non-blocking in-app toast messages
- **Duplicate detection** — flag images already present in the destination folder before copying
- **Resume on re-scan** — preserve existing gallery cards and append new matches instead of clearing the grid
- **Log / Terminal viewer** — collapsible in-app panel showing backend log output for debugging

---

## Tier 3 — Maintenance & Packaging

These harden the project for broader distribution.

- **Unit tests** — pytest suite for core backend logic: `match_keywords`, `sanitize_folder_name`, cache read/write
- **Windows installer** — Inno Setup script producing a proper `FocusOCR-Setup.exe` with Start Menu shortcut, uninstaller, and optional PATH registration
