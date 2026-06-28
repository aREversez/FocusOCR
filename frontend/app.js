// State Management
let sseConnection = null;
let matchedFiles = [];
let scanStats = {
    total: 0,
    processed: 0,
    matches: 0,
    cached: 0
};

// DOM Elements
const elTargetDir = document.getElementById('target-dir');
const elDestDir = document.getElementById('dest-dir');
const elTargetHistory = document.getElementById('target-history-list');
const elDestHistory = document.getElementById('dest-history-list');
const elRecursive = document.getElementById('recursive-search');
const elKeyword1 = document.getElementById('keyword-1');
const elKeyword2 = document.getElementById('keyword-2');
const elKeyword3 = document.getElementById('keyword-3');
const elMatchLogic = document.getElementById('match-logic');
const elUseRegex = document.getElementById('use-regex');
const elExcludeKeyword1 = document.getElementById('exclude-keyword-1');
const elExcludeKeyword2 = document.getElementById('exclude-keyword-2');


const btnBrowseTarget = document.getElementById('btn-browse-target');
const btnBrowseDest = document.getElementById('btn-browse-dest');
const btnStartScan = document.getElementById('btn-start-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const btnClearResults = document.getElementById('btn-clear-results');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnClearThumbCache = document.getElementById('btn-clear-thumb-cache');
const btnExport = document.getElementById('btn-export');
const elExportMenu = document.getElementById('export-menu');

const btnThemeToggle = document.getElementById('btn-theme-toggle');
const elThemeIcon = document.getElementById('theme-icon');

const elSystemStatus = document.getElementById('system-status');
const elStatsTotal = document.getElementById('stat-total');
const elStatsProcessed = document.getElementById('stat-processed');
const elStatsMatches = document.getElementById('stat-matches');
const elStatsCached = document.getElementById('stat-cached');

const elProgressPanel = document.getElementById('progress-panel');
const elProgressStatus = document.getElementById('progress-status-text');
const elProgressPercent = document.getElementById('progress-percent-text');
const elProgressBarFill = document.getElementById('progress-bar-fill');
const elProgressCurrent = document.getElementById('progress-current-file');

const elEmptyState = document.getElementById('empty-state');
const elResultsGrid = document.getElementById('results-grid');
const elGalleryCount = document.getElementById('gallery-count');

// Lightbox Elements
const elLightbox = document.getElementById('lightbox');
const elLightboxImg = document.getElementById('lightbox-img');
const elLightboxClose = document.getElementById('btn-lightbox-close');
const elLightboxFilename = document.getElementById('lightbox-filename');
const elLightboxPath = document.getElementById('lightbox-path');
const elLightboxSnippets = document.getElementById('lightbox-ocr-snippets');

// Theme management
const THEME_KEY = 'focusocr_theme';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    elThemeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Export matched results as CSV or JSON
function exportResults(format) {
    if (matchedFiles.length === 0) return;
    let content, filename, mime;
    if (format === 'csv') {
        content = '\ufeff' + 'filename,path,keywords,snippets\n' +
            matchedFiles.map(m =>
                `"${m.filename}","${m.original_path}","${(m.matched_keywords||[]).join('; ')}","${(m.snippets||[]).join(' | ')}"`
            ).join('\n');
        filename = 'focusocr_results.csv';
        mime = 'text/csv;charset=utf-8';
    } else {
        content = JSON.stringify(matchedFiles, null, 2);
        filename = 'focusocr_results.json';
        mime = 'application/json';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}



// Initialize Events
document.addEventListener('DOMContentLoaded', () => {
    // Restore theme
    const savedTheme = (() => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })();
    applyTheme(savedTheme === 'light' ? 'light' : 'dark');
    btnThemeToggle.addEventListener('click', toggleTheme);

    btnBrowseTarget.addEventListener('click', () => browseFolder(elTargetDir));
    btnBrowseDest.addEventListener('click', () => browseFolder(elDestDir));
    btnStartScan.addEventListener('click', startScan);
    btnStopScan.addEventListener('click', stopScan);
    btnClearResults.addEventListener('click', clearGallery);
    btnClearCache.addEventListener('click', clearOcrCache);
    btnClearThumbCache.addEventListener('click', clearThumbCache);
    
    // Lightbox close events
    elLightboxClose.addEventListener('click', closeLightbox);
    document.querySelector('.lightbox-overlay').addEventListener('click', closeLightbox);
    
    // Close lightbox on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // Export dropdown
    btnExport.addEventListener('click', () => {
        elExportMenu.classList.toggle('hidden');
    });
    elExportMenu.addEventListener('click', (e) => {
        if (e.target.dataset.format) {
            exportResults(e.target.dataset.format);
            elExportMenu.classList.add('hidden');
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.export-dropdown')) {
            elExportMenu.classList.add('hidden');
        }
    });

    // Render initial folder and scan histories
    renderHistory('target');
    renderHistory('dest');
    renderScanRecords();
});


// Browse native folders API
async function browseFolder(inputElement) {
    try {
        updateSystemStatus('Selecting folder...', 'orange');
        const response = await fetch('/api/browse');
        if (!response.ok) throw new Error('Failed to open directory dialog');
        const data = await response.json();
        if (data.path) {
            inputElement.value = data.path;
            const type = inputElement === elTargetDir ? 'target' : 'dest';
            addToHistory(type, data.path);
        }
        updateSystemStatus('Ready', 'green');
    } catch (err) {
        alert('Error picking directory: ' + err.message);
        updateSystemStatus('Ready', 'green');
    }
}


// System status UI helper
function updateSystemStatus(text, dotColor) {
    const dot = elSystemStatus.querySelector('.status-dot');
    const label = elSystemStatus.querySelector('.status-text');
    
    dot.className = `status-dot ${dotColor}`;
    label.textContent = text;
}

// Clear matching results
function updateExportButton() {
    btnExport.disabled = matchedFiles.length === 0;
}

function clearGallery() {
    matchedFiles = [];
    elResultsGrid.innerHTML = '';
    elResultsGrid.classList.add('hidden');
    elEmptyState.classList.remove('hidden');
    elGalleryCount.classList.add('hidden');
    elGalleryCount.textContent = '0';
    
    // Reset stats
    scanStats = { total: 0, processed: 0, matches: 0, cached: 0 };
    updateStatsUI();
    updateExportButton();
}

async function clearOcrCache() {
    if (!confirm('Clear all cached OCR results? Images will be re-scanned on the next run.')) return;
    try {
        const resp = await fetch('/api/clear-ocr-cache');
        const data = await resp.json();
        if (data.status === 'ok') {
            scanStats.cached = 0;
            elStatsCached.textContent = '0';
            updateSystemStatus(`OCR cache cleared (${data.removed} files)`, 'green');
            setTimeout(() => updateSystemStatus('Ready', 'green'), 3000);
        }
    } catch (e) {
        alert('Failed to clear OCR cache: ' + e.message);
    }
}

async function clearThumbCache() {
    if (!confirm('Clear all cached thumbnails? They will be re-created when viewing results.')) return;
    try {
        const resp = await fetch('/api/clear-thumb-cache');
        const data = await resp.json();
        if (data.status === 'ok') {
            updateSystemStatus(`Thumb cache cleared (${data.removed} files)`, 'green');
            setTimeout(() => updateSystemStatus('Ready', 'green'), 3000);
        }
    } catch (e) {
        alert('Failed to clear thumbnail cache: ' + e.message);
    }
}

function updateStatsUI() {
    elStatsTotal.textContent = scanStats.total;
    elStatsProcessed.textContent = scanStats.processed;
    elStatsCached.textContent = scanStats.cached;
    elStatsMatches.textContent = scanStats.matches;
}

// Helper to escape HTML characters
function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Highlight keywords in text
function highlightText(text, keywords) {
    if (!text) return '';
    let escaped = escapeHTML(text);
    
    // Sort keywords by length descending to prevent shorter matches inside longer ones breaking the HTML tags
    const sortedKws = [...keywords]
        .filter(k => k.trim())
        .map(k => k.trim())
        .sort((a, b) => b.length - a.length);

    sortedKws.forEach(kw => {
        if (!kw) return;
        // Escape keyword for regex usage
        const regexEscaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Matches case-insensitive
        const regex = new RegExp(`(${regexEscaped})`, 'gi');
        escaped = escaped.replace(regex, '<mark>$1</mark>');
    });
    
    return escaped;
}

// Add a matched image to the gallery
function addMatchToGallery(match, keywords, fromCache) {
    elEmptyState.classList.add('hidden');
    elResultsGrid.classList.remove('hidden');
    
    const thumbSrc = `/api/thumbnail?path=${encodeURIComponent(match.original_path)}`;
    const encodedPath = encodeURIComponent(match.original_path);
    
    const card = document.createElement('div');
    card.className = 'result-card';
    
    // Build highlights for snippets
    const snippetsHTML = match.snippets.map(snippet => 
        `<div class="snippet-line">${highlightText(snippet, keywords)}</div>`
    ).join('');
    
    card.innerHTML = `
        <div class="card-img-wrapper">
            <img src="${thumbSrc}" alt="${escapeHTML(match.filename)}" loading="lazy">
            <div class="card-overlay">
                <span class="overlay-zoom-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </span>
            </div>
        </div>
        <div class="card-content">
            <div class="card-info">
                <div style="display:flex;align-items:center;gap:0.3rem">
                    <div class="card-title" title="${escapeHTML(match.filename)}">${escapeHTML(match.filename)}</div>
                    ${fromCache ? '<span class="card-cache-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="2"/></svg>Cache</span>' : ''}
                </div>
                <div class="card-path" title="${escapeHTML(match.original_path)}">${escapeHTML(match.original_path)}</div>
            </div>
            ${snippetsHTML ? `<div class="card-snippets">${snippetsHTML}</div>` : ''}
            <div class="card-actions">
                <button class="btn btn-secondary btn-copy-path" title="Copy path">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    <span class="btn-label">Copy</span>
                </button>
                <button class="btn btn-secondary btn-reveal" title="Open in Explorer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span class="btn-label">Open</span>
                </button>
                <button class="btn btn-primary btn-zoom" title="Preview">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    <span class="btn-label">View</span>
                </button>
            </div>
        </div>
    `;
    
    // Event listeners for actions
    const imgWrapper = card.querySelector('.card-img-wrapper');
    imgWrapper.addEventListener('click', () => openLightbox(match, keywords));
    
    card.querySelector('.btn-zoom').addEventListener('click', () => openLightbox(match, keywords));
    
    card.querySelector('.btn-reveal').addEventListener('click', () => {
        fetch(`/api/reveal?path=${encodedPath}`);
    });
    
    const copyBtn = card.querySelector('.btn-copy-path');
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(match.original_path);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.style.color = '#10b981';
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.color = '';
        }, 1500);
    });

    elResultsGrid.appendChild(card);
}

// Start scanning routine
function startScan() {
    const targetDir = elTargetDir.value.trim();
    const destDir = elDestDir.value.trim();
    const recursive = elRecursive.checked;
    const matchLogic = elMatchLogic.value;
    
    const keywords = [
        elKeyword1.value.trim(),
        elKeyword2.value.trim(),
        elKeyword3.value.trim()
    ].filter(kw => kw !== '');

    const excludeKeywords = [
        elExcludeKeyword1.value.trim(),
        elExcludeKeyword2.value.trim()
    ].filter(kw => kw !== '');

    const useRegex = elUseRegex.checked;

    if (!targetDir) {
        alert('Please enter or browse a target directory to scan.');
        return;
    }
    if (!destDir) {
        alert('Please enter or browse a destination directory.');
        return;
    }
    if (keywords.length === 0) {
        alert('Please enter at least one keyword (e.g., in Keyword 1).');
        return;
    }
    // Save current paths to history
    addToHistory('target', targetDir);
    addToHistory('dest', destDir);


    // Initialize gallery and progress bar
    clearGallery();
    elProgressPanel.classList.remove('hidden');
    elProgressBarFill.style.width = '0%';

    elProgressPercent.textContent = '0%';
    elProgressStatus.textContent = 'Connecting...';
    elProgressCurrent.textContent = 'Initializing OCR models...';
    
    // Toggle buttons
    btnStartScan.classList.add('hidden');
    btnStopScan.classList.remove('hidden');
    updateSystemStatus('Scanning...', 'orange');
    
    // Build query URL
    const params = new URLSearchParams();
    params.append('target_dir', targetDir);
    params.append('dest_dir', destDir);
    params.append('match_logic', matchLogic);
    params.append('recursive', recursive);
    params.append('use_regex', useRegex);
    keywords.forEach(kw => params.append('keywords', kw));
    excludeKeywords.forEach(kw => params.append('exclude_keywords', kw));

    const sseUrl = `/api/scan-stream?${params.toString()}`;
    
    // Connect to Server Sent Events
    sseConnection = new EventSource(sseUrl);

    sseConnection.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.status === 'starting') {
            scanStats.total = data.total_files;
            updateStatsUI();
            elProgressStatus.textContent = 'Scanning images...';
        } 
        else if (data.status === 'scanning') {
            scanStats.total = data.total_files;
            scanStats.processed = data.processed_files;
            scanStats.matches = data.matched_files;
            updateStatsUI();
            
            // Update Progress Bar
            const percent = Math.round((data.processed_files / data.total_files) * 100);
            elProgressBarFill.style.width = `${percent}%`;
            elProgressPercent.textContent = `${percent}%`;
            elProgressCurrent.textContent = data.current_file;
            
            // Track cache stats
            scanStats.cached = data.cached_files || 0;
            elStatsCached.textContent = scanStats.cached;
            
            // Add match to UI
            if (data.is_match && data.match_details) {
                matchedFiles.push(data.match_details);
                addMatchToGallery(data.match_details, keywords, data.from_cache);
                updateExportButton();
                
                elGalleryCount.textContent = matchedFiles.length;
                elGalleryCount.classList.remove('hidden');
            }
        } 
        else if (data.status === 'cancelled') {
            elProgressStatus.textContent = 'Cancelled';
            elProgressCurrent.textContent = data.message || 'Scan was cancelled.';
            endScan('Ready', 'orange');
        }
        else if (data.status === 'complete') {
            scanStats.cached = data.cached_files || 0;
            elStatsCached.textContent = scanStats.cached;
            elProgressBarFill.style.width = '100%';
            elProgressPercent.textContent = '100%';
            elProgressStatus.textContent = 'Completed!';
            elProgressCurrent.textContent = data.message;
            endScan('Ready', 'green');
            // Save to scan history (inline to avoid any indirection bugs)
            try {
                const rec = {
                    id: Date.now(),
                    timestamp: Date.now(),
                    target_dir: elTargetDir.value.trim() || '',
                    dest_dir: elDestDir.value.trim() || '',
                    keywords: keywords,
                    match_logic: elMatchLogic.value,
                    recursive: elRecursive.checked,
                    use_regex: elUseRegex.checked,
                    exclude_keywords: excludeKeywords,
                    total_files: scanStats.total,
                    matched_files: scanStats.matches,
                    cached_files: scanStats.cached,
                    matches: matchedFiles.map(m => JSON.parse(JSON.stringify(m)))
                };
                let prev = JSON.parse(localStorage.getItem('focusocr_v1_scan_history') || '[]');
                prev.unshift(rec);
                if (prev.length > 10) prev = prev.slice(0, 10);
                localStorage.setItem('focusocr_v1_scan_history', JSON.stringify(prev));
                renderScanRecords();
            } catch (e) {
                console.error('Failed to save scan history:', e);
            }
        } 
        else if (data.status === 'error') {
            elProgressStatus.textContent = 'Error occurred!';
            elProgressCurrent.textContent = data.message;
            alert('Scan error: ' + data.message);
            endScan('Error', 'red');
        }
    };

    sseConnection.onerror = (err) => {
        console.error('SSE Error:', err);
        elProgressStatus.textContent = 'Disconnected';
        elProgressCurrent.textContent = 'Connection to server lost.';
        alert('Server connection was interrupted. The scan might still be running or has completed.');
        endScan('Disconnected', 'red');
    };
}

// Stop scanning routine
async function stopScan() {
    // Tell the server to cancel the scan
    try {
        await fetch('/api/stop-scan');
    } catch (e) {
        console.error('Failed to notify server of cancellation:', e);
    }
    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }
    elProgressStatus.textContent = 'Stopped';
    elProgressCurrent.textContent = 'Scan was cancelled by the user.';
    endScan('Stopped', 'red');
}

// Clean up scan state
function endScan(statusText, statusColor) {
    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }
    btnStartScan.classList.remove('hidden');
    btnStopScan.classList.add('hidden');
    updateSystemStatus(statusText, statusColor);
}

// Lightbox controllers
function openLightbox(match, keywords) {
    const imgUrl = `/api/image?path=${encodeURIComponent(match.original_path)}`;
    
    elLightboxImg.src = imgUrl;
    elLightboxFilename.textContent = match.filename;
    elLightboxPath.textContent = match.original_path;
    
    // Highlighted snippets
    elLightboxSnippets.innerHTML = match.snippets.map(snippet => 
        `<div class="snippet-line" style="margin-bottom: 0.5rem;">${highlightText(snippet, keywords)}</div>`
    ).join('');
    
    elLightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock background scroll
}

function closeLightbox() {
    elLightbox.classList.add('hidden');
    elLightboxImg.src = '';
    document.body.style.overflow = ''; // Unlock scroll
}

// History Management — localStorage keys are namespaced to avoid collisions
const HISTORY_KEY = 'focusocr_v1_history';

function loadHistory(type) {
    try {
        const stored = localStorage.getItem(`${HISTORY_KEY}_${type}`);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveHistory(type, history) {
    try {
        localStorage.setItem(`${HISTORY_KEY}_${type}`, JSON.stringify(history));
    } catch (e) {}
}

function addToHistory(type, path) {
    if (!path || typeof path !== 'string') return;
    const cleanPath = path.trim();
    if (!cleanPath) return;

    let history = loadHistory(type);
    // Remove if already exists to push it to the top
    history = history.filter(item => item !== cleanPath);
    history.unshift(cleanPath);
    // Limit to 5
    if (history.length > 5) {
        history = history.slice(0, 5);
    }
    saveHistory(type, history);
    renderHistory(type);
}

function deleteFromHistory(type, path, event) {
    if (event) event.stopPropagation(); // Avoid selecting the item when deleting
    let history = loadHistory(type);
    history = history.filter(item => item !== path);
    saveHistory(type, history);
    renderHistory(type);
}

function renderHistory(type) {
    const container = type === 'target' ? elTargetHistory : elDestHistory;
    const input = type === 'target' ? elTargetDir : elDestDir;
    if (!container) return;

    const history = loadHistory(type);
    container.innerHTML = '';

    if (history.length === 0) {
        return;
    }

    history.forEach(path => {
        const chip = document.createElement('div');
        chip.className = 'history-chip';
        chip.title = path;
        
        // Show only the last segment of the path for brevity, or full path if too short
        let displayPath = path;
        try {
            const parts = path.split(/[\\/]/);
            if (parts.length > 2) {
                displayPath = '...\\' + parts[parts.length - 1];
            }
        } catch (e) {}

        chip.innerHTML = `
            <span class="history-chip-text" title="${escapeHTML(path)}">${escapeHTML(displayPath)}</span>
            <span class="history-chip-delete" title="Remove from history">&times;</span>
        `;

        // Click on chip sets the input path
        chip.addEventListener('click', () => {
            input.value = path;
        });

        // Click on delete removes it
        chip.querySelector('.history-chip-delete').addEventListener('click', (e) => {
            deleteFromHistory(type, path, e);
        });

        container.appendChild(chip);
    });
}

// Scan History (localStorage-based, no server dependency)
const elScanHistoryList = document.getElementById('scan-history-list');
const SCAN_HISTORY_KEY = 'focusocr_v1_scan_history';
const MAX_SCAN_RECORDS = 10;

function loadScanRecords() {
    try {
        const stored = localStorage.getItem(SCAN_HISTORY_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveScanRecords(records) {
    try {
        localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(records));
    } catch (e) {}
}

function renderScanRecords() {
    if (!elScanHistoryList) return;
    const records = loadScanRecords();
    elScanHistoryList.innerHTML = '';

    if (records.length === 0) {
        elScanHistoryList.innerHTML = '<span class="history-empty">No past scans yet.</span>';
        return;
    }

    records.forEach(rec => {
        const chip = document.createElement('div');
        chip.className = 'history-chip';

        const date = new Date(rec.timestamp);
        const dateStr = date.toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const kwText = rec.keywords.join(', ') || '(no keywords)';

        chip.innerHTML = `
            <div class="history-chip-content">
                <div class="history-chip-kw" title="${escapeHTML(kwText)}">${escapeHTML(kwText)}</div>
                <div class="history-chip-meta">${escapeHTML(dateStr)} — ${escapeHTML(rec.matched_files)}/${escapeHTML(rec.total_files)}</div>
            </div>
            <span class="history-chip-delete" title="Delete record">&times;</span>
        `;

        chip.addEventListener('click', (e) => {
            if (e.target.classList.contains('history-chip-delete')) return;
            loadScanRecord(rec);
        });
        chip.querySelector('.history-chip-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteScanRecord(rec.id);
        });
        elScanHistoryList.appendChild(chip);
    });
}

function deleteScanRecord(id) {
    let records = loadScanRecords();
    records = records.filter(r => r.id !== id);
    saveScanRecords(records);
    renderScanRecords();
}

function loadScanRecord(record) {
    // Restore form fields
    elTargetDir.value = record.target_dir || '';
    elDestDir.value = record.dest_dir || '';
    elMatchLogic.value = record.match_logic || 'any';
    elRecursive.checked = !!record.recursive;
    elUseRegex.checked = !!record.use_regex;
    elKeyword1.value = record.keywords[0] || '';
    elKeyword2.value = record.keywords[1] || '';
    elKeyword3.value = record.keywords[2] || '';
    elExcludeKeyword1.value = (record.exclude_keywords && record.exclude_keywords[0]) || '';
    elExcludeKeyword2.value = (record.exclude_keywords && record.exclude_keywords[1]) || '';

    // Populate gallery
    clearGallery();
    const keywords = record.keywords || [];
    scanStats.total = record.total_files || 0;
    scanStats.processed = record.total_files || 0;
    scanStats.matches = record.matched_files || 0;
    scanStats.cached = record.cached_files || 0;
    updateStatsUI();

    if (record.matches && record.matches.length > 0) {
        record.matches.forEach(match => {
            matchedFiles.push(match);
            addMatchToGallery(match, keywords);
        });
        elGalleryCount.textContent = matchedFiles.length;
        elGalleryCount.classList.remove('hidden');
    }

    updateExportButton();
    updateSystemStatus('Loaded from history', 'green');
}

