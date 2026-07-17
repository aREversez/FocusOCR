// State Management
let sseConnection = null;
let matchedFiles = [];
let maxHistoryPerDir = 5;
let currentLightboxIndex = -1;
let lightboxKeywords = [];
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
const elConfidenceThreshold = document.getElementById('confidence-threshold');
const elConfidenceValue = document.getElementById('confidence-value');
const elCacheEnabled = document.getElementById('cache-enabled');
const elPreviewBadge = document.getElementById('preview-badge');
const elStatsMatchLabel = document.getElementById('stat-match-label');


const btnBrowseTarget = document.getElementById('btn-browse-target');
const btnBrowseDest = document.getElementById('btn-browse-dest');
const btnStartScan = document.getElementById('btn-start-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const btnClearResults = document.getElementById('btn-clear-results');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnClearThumbCache = document.getElementById('btn-clear-thumb-cache');
const btnSaveResults = document.getElementById('btn-save-results');
const btnLoadResults = document.getElementById('btn-load-results');
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
const elFilterInput = document.getElementById('filter-input');
const elResultsFilter = document.getElementById('results-filter');

// Lightbox Elements
const elLightbox = document.getElementById('lightbox');
const elLightboxImg = document.getElementById('lightbox-img');
const elLightboxClose = document.getElementById('btn-lightbox-close');
const elLightboxFilename = document.getElementById('lightbox-filename');
const elLightboxPath = document.getElementById('lightbox-path');
const elLightboxSnippets = document.getElementById('lightbox-ocr-snippets');
const elLightboxPrev = document.getElementById('btn-lightbox-prev');
const elLightboxNext = document.getElementById('btn-lightbox-next');
const elLightboxCounter = document.getElementById('lightbox-counter');
const elLightboxInfo = document.getElementById('lightbox-image-info');

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

function escapeCSV(value) {
    const s = String(value == null ? '' : value);
    return '"' + s.replace(/"/g, '""') + '"';
}

// Export matched results as CSV or JSON
function exportResults(format) {
    if (matchedFiles.length === 0) return;
    if (format === 'csv') {
        const header = '\ufeff' + ['filename','path','keywords','snippets','boxes'].join(',') + '\n';
        const CHUNK = 500;
        const parts = [header];
        for (let i = 0; i < matchedFiles.length; i += CHUNK) {
            const chunk = matchedFiles.slice(i, i + CHUNK).map(m =>
                [
                    escapeCSV(m.filename),
                    escapeCSV(m.original_path),
                    escapeCSV((m.matched_keywords||[]).join('; ')),
                    escapeCSV((m.snippets||[]).join(' | ')),
                    escapeCSV(JSON.stringify(m.boxes||[]))
                ].join(',')
            ).join('\n');
            parts.push(chunk);
            parts.push('\n');
        }
        const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'focusocr_results.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else {
        const CHUNK = 500;
        const parts = ['[\n'];
        for (let i = 0; i < matchedFiles.length; i += CHUNK) {
            const chunk = matchedFiles.slice(i, i + CHUNK)
                .map(m => JSON.stringify(m, null, 2))
                .join(',\n');
            parts.push(chunk);
            if (i + CHUNK < matchedFiles.length) parts.push(',\n');
        }
        parts.push('\n]');
        const blob = new Blob(parts, { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'focusocr_results.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
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
    btnSaveResults.addEventListener('click', saveResults);
    btnLoadResults.addEventListener('click', loadResultsList);
    
    // Lightbox close events
    elLightboxClose.addEventListener('click', closeLightbox);
    document.querySelector('.lightbox-overlay').addEventListener('click', closeLightbox);
    
    // Lightbox navigation
    elLightboxPrev.addEventListener('click', () => navigateLightbox(-1));
    elLightboxNext.addEventListener('click', () => navigateLightbox(1));
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (!elLightbox.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                closeLightbox();
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateLightbox(-1);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateLightbox(1);
                return;
            }
        }
        if (e.key === 'Escape') {
            elExportMenu.classList.add('hidden');
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!btnStartScan.classList.contains('hidden')) {
                startScan();
            }
        }
        if (e.key === 'e' && e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            if (!btnExport.disabled) {
                elExportMenu.classList.toggle('hidden');
            }
        }
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

    // Confidence slider live value display
    elConfidenceThreshold.addEventListener('input', () => {
        elConfidenceValue.textContent = parseFloat(elConfidenceThreshold.value).toFixed(2);
    });

    // Results filter
    elFilterInput.addEventListener('input', filterResults);

    // Load settings from backend
    fetch('/api/settings').then(r => r.json()).then(s => {
        elCacheEnabled.checked = s.enable_ocr_cache !== false;
        maxHistoryPerDir = s.max_history_per_dir || maxHistoryPerDir;
    }).catch(() => {});
    elCacheEnabled.addEventListener('change', () => {
        fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enable_ocr_cache: elCacheEnabled.checked})
        }).catch(() => {});
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
        showToast('Error picking directory: ' + err.message, 'error');
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
    elResultsFilter.classList.add('hidden');
    elFilterInput.value = '';
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
        const resp = await fetch('/api/clear-ocr-cache', { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'ok') {
            scanStats.cached = 0;
            elStatsCached.textContent = '0';
            updateSystemStatus(`OCR cache cleared (${data.removed} files)`, 'green');
            setTimeout(() => updateSystemStatus('Ready', 'green'), 3000);
        }
    } catch (e) {
        showToast('Failed to clear OCR cache: ' + e.message, 'error');
    }
}

function filterResults() {
    const query = elFilterInput.value.trim().toLowerCase();
    const cards = elResultsGrid.querySelectorAll('.result-card');
    let visible = 0;
    cards.forEach(card => {
        const match = !query || (card.dataset.search || '').includes(query);
        card.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    elGalleryCount.textContent = visible;
}

async function clearThumbCache() {
    if (!confirm('Clear all cached thumbnails? They will be re-created when viewing results.')) return;
    try {
        const resp = await fetch('/api/clear-thumb-cache', { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'ok') {
            updateSystemStatus(`Thumb cache cleared (${data.removed} files)`, 'green');
            setTimeout(() => updateSystemStatus('Ready', 'green'), 3000);
        }
    } catch (e) {
        showToast('Failed to clear thumbnail cache: ' + e.message, 'error');
    }
}

async function saveResults() {
    if (matchedFiles.length === 0) {
        showToast('No results to save. Run a scan first.', 'warning');
        return;
    }
    const keywords = [];
    document.querySelectorAll('.keyword-input').forEach(el => {
        const v = el.value.trim();
        if (v) keywords.push(v);
    });
    const payload = {
        matches: matchedFiles.map(m => JSON.parse(JSON.stringify(m))),
        metadata: {
            total_files: scanStats.total,
            processed_files: scanStats.processed,
            matched_files: scanStats.matches,
            cached_files: scanStats.cached,
            keywords: keywords,
            match_logic: elMatchLogic.value,
            timestamp: Date.now()
        }
    };
    try {
        const resp = await fetch('/api/save-results', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (resp.ok && data.status === 'ok') {
            showToast(`Results saved as ${data.filename}`, 'success');
        } else {
            showToast('Failed to save results: ' + (data.detail || 'unknown error'), 'error');
        }
    } catch (e) {
        showToast('Failed to save results: ' + e.message, 'error');
    }
}

async function loadResultsList() {
    try {
        const resp = await fetch('/api/results');
        if (!resp.ok) {
            showToast('Failed to load results list', 'error');
            return;
        }
        const data = await resp.json();
        if (!data.results || data.results.length === 0) {
            showToast('No saved results found.', 'info');
            return;
        }
        showLoadResultsModal(data.results);
    } catch (e) {
        showToast('Failed to load results list: ' + e.message, 'error');
    }
}

function showLoadResultsModal(results) {
    const modal = document.getElementById('load-results-modal');
    const list = document.getElementById('load-results-list');
    list.innerHTML = '';
    results.slice(0, 50).forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'result-item-row';
        row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0';

        const item = document.createElement('button');
        item.className = 'btn btn-text result-item';
        item.style.cssText = 'padding:0.6rem;text-align:left;flex:1;border-bottom:1px solid var(--border-color)';
        item.textContent = `${i+1}. ${r.date} — ${r.matched_files} matches / ${r.total_files} files`;
        item.addEventListener('click', () => {
            modal.classList.add('hidden');
            loadResultFile(r.filename);
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-text';
        delBtn.style.cssText = 'padding:0.4rem;flex-shrink:0;color:var(--text-dim);border:none';
        delBtn.title = 'Delete this saved result';
        delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteResultFile(r.filename, row);
        });

        row.appendChild(item);
        row.appendChild(delBtn);
        list.appendChild(row);
    });
    modal.classList.remove('hidden');
}

async function deleteResultFile(filename, rowElement) {
    try {
        const resp = await fetch(`/api/results/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showToast('Failed to delete: ' + (data.detail || resp.statusText), 'error');
            return;
        }
        rowElement.remove();
        showToast(`Deleted ${filename}`, 'info');
    } catch (e) {
        showToast('Failed to delete result: ' + e.message, 'error');
    }
}

async function loadResultFile(filename) {
    try {
        const resp = await fetch(`/api/results/${encodeURIComponent(filename)}`);
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showToast('Failed to load result: ' + (data.detail || resp.statusText), 'error');
            return;
        }
        const data = await resp.json();
        if (!data.matches || !data.matches.length) {
            showToast('No matches found in saved result.', 'warning');
            return;
        }
        // Restore matches and stats
        matchedFiles = data.matches;
        scanStats = {
            total: data.metadata?.total_files || 0,
            processed: data.metadata?.processed_files || 0,
            matches: data.metadata?.matched_files || 0,
            cached: data.metadata?.cached_files || 0
        };
        updateStatsUI();
        elResultsGrid.innerHTML = '';
        elResultsGrid.classList.remove('hidden');
        elEmptyState.classList.add('hidden');
        elResultsFilter.classList.remove('hidden');
        // Rebuild gallery
        const kws = data.metadata?.keywords || [];
        for (const match of matchedFiles) {
            addMatchToGallery(match, kws, false);
        }
        elGalleryCount.textContent = matchedFiles.length;
        elGalleryCount.classList.remove('hidden');
        updateExportButton();
        updateSystemStatus(`Loaded ${filename}`, 'green');
        setTimeout(() => updateSystemStatus('Ready', 'green'), 3000);
    } catch (e) {
        showToast('Failed to load result: ' + e.message, 'error');
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

// Toast notification system
function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Add a matched image to the gallery
function addMatchToGallery(match, keywords, fromCache) {
    elEmptyState.classList.add('hidden');
    elResultsGrid.classList.remove('hidden');
    elResultsFilter.classList.remove('hidden');
    
    const thumbSrc = `/api/thumbnail?path=${encodeURIComponent(match.original_path)}`;
    const encodedPath = encodeURIComponent(match.original_path);
    
    const searchText = [match.filename, match.original_path, ...(match.snippets || [])].join(' ').toLowerCase();
    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.search = searchText;
    card.dataset.originalPath = match.original_path;
    
    // Build highlights for snippets
    const snippetsHTML = (match.snippets || []).map(snippet => 
        `<div class="snippet-line">${highlightText(snippet, keywords)}</div>`
    ).join('');
    
    const dupBadge = match.is_duplicate
        ? '<span class="card-cache-badge" data-dup style="color:var(--accent-emerald);background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.2)" title="Already existed in destination — reused without re-copying"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>Dup</span>'
        : '';

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
                    ${dupBadge}
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

    if (useRegex) {
        try {
            [...keywords, ...excludeKeywords].forEach(pattern => {
                if (pattern) new RegExp(pattern);
            });
        } catch (err) {
            showToast('Invalid regular expression: ' + err.message, 'error');
            return;
        }
    }

    if (!targetDir) {
        showToast('Please enter or browse a target directory to scan.', 'warning');
        return;
    }
    if (keywords.length === 0) {
        showToast('Please enter at least one keyword.', 'warning');
        return;
    }
    // Save current paths to history
    addToHistory('target', targetDir);
    if (destDir) {
        addToHistory('dest', destDir);
    }

    // Preview mode indicator
    const isPreview = !destDir;
    elPreviewBadge.classList.toggle('hidden', !isPreview);
    elStatsMatchLabel.textContent = isPreview ? 'Matched' : 'Matched & Copied';


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
    params.append('confidence_threshold', parseFloat(elConfidenceThreshold.value) || 0);
    keywords.forEach(kw => params.append('keywords', kw));
    excludeKeywords.forEach(kw => params.append('exclude_keywords', kw));

    const sseUrl = `/api/scan-stream?${params.toString()}`;
    
    // Connect to Server Sent Events
    sseConnection = new EventSource(sseUrl);

    sseConnection.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.status === 'counting') {
            elProgressStatus.textContent = data.message || 'Scanning directory...';
        }
        else if (data.status === 'starting') {
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
                    confidence_threshold: parseFloat(elConfidenceThreshold.value) || 0,
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
            showToast('Scan error: ' + data.message, 'error');
            endScan('Error', 'red');
        }
    };

    sseConnection.onerror = (err) => {
        console.error('SSE Error:', err);
        elProgressStatus.textContent = 'Disconnected';
        elProgressCurrent.textContent = 'Connection to server lost.';
        showToast('Server connection was interrupted. The scan might still be running or has completed.', 'error');
        endScan('Disconnected', 'red');
    };
}

// Stop scanning routine
async function stopScan() {
    // Tell the server to cancel the scan
    try {
        await fetch('/api/stop-scan', { method: 'POST' });
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
function _visibleMatches() {
    const cards = elResultsGrid.querySelectorAll('.result-card');
    const visible = [];
    cards.forEach(card => {
        if (card.style.display !== 'none') {
            const path = card.dataset.originalPath;
            const match = matchedFiles.find(m => m.original_path === path);
            if (match) visible.push(match);
        }
    });
    return visible;
}

function openLightbox(match, keywords) {
    const visible = _visibleMatches();
    currentLightboxIndex = visible.findIndex(m => m.original_path === match.original_path);
    if (currentLightboxIndex === -1) {
        currentLightboxIndex = matchedFiles.findIndex(m => m.original_path === match.original_path);
    }
    lightboxKeywords = keywords;
    
    const imgUrl = `/api/image?path=${encodeURIComponent(match.original_path)}`;
    
    elLightboxImg.src = imgUrl;
    elLightboxFilename.textContent = match.filename;
    elLightboxPath.textContent = match.original_path;
    
    // Highlighted snippets
    elLightboxSnippets.innerHTML = match.snippets.map(snippet => 
        `<div class="snippet-line" style="margin-bottom: 0.5rem;">${highlightText(snippet, keywords)}</div>`
    ).join('');
    
    // Update position counter and nav buttons
    updateLightboxNav();
    
    // Fetch and display image info
    fetchImageInfo(match.original_path);
    
    // Render bounding box overlay when image loads
    const boxesSvg = document.getElementById('lightbox-boxes');
    boxesSvg.innerHTML = '';
    if (match.boxes && match.boxes.length > 0) {
        elLightboxImg.onload = function() {
            const img = elLightboxImg;
            const natW = img.naturalWidth;
            const natH = img.naturalHeight;
            const dispW = img.clientWidth || img.width;
            const dispH = img.clientHeight || img.height;
            const sx = dispW / natW;
            const sy = dispH / natH;
            let polygons = '';
            for (const box of match.boxes) {
                if (!box || box.length < 4) continue;
                const pts = box.map(p => `${(p[0] * sx).toFixed(1)},${(p[1] * sy).toFixed(1)}`).join(' ');
                polygons += `<polygon class="hl-box" points="${pts}"/>`;
            }
            boxesSvg.setAttribute('viewBox', `0 0 ${dispW} ${dispH}`);
            boxesSvg.innerHTML = polygons;
        };
    }
    
    elLightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock background scroll
}

function navigateLightbox(delta) {
    const visible = _visibleMatches();
    const newIndex = currentLightboxIndex + delta;
    if (newIndex < 0 || newIndex >= visible.length) return;
    openLightbox(visible[newIndex], lightboxKeywords);
}

function updateLightboxNav() {
    const visible = _visibleMatches();
    const total = visible.length;
    const idx = currentLightboxIndex;
    elLightboxPrev.style.display = total > 0 && idx > 0 ? '' : 'none';
    elLightboxNext.style.display = total > 0 && idx < total - 1 ? '' : 'none';
    elLightboxCounter.textContent = total > 0 ? `${Math.min(idx + 1, total)} / ${total}` : '';
}

async function fetchImageInfo(path) {
    try {
        const resp = await fetch(`/api/image-info?path=${encodeURIComponent(path)}`);
        if (!resp.ok) {
            elLightboxInfo.innerHTML = '';
            return;
        }
        const info = await resp.json();
        elLightboxInfo.innerHTML = `
            <span><svg class="info-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> ${info.width} &times; ${info.height}</span>
            <span><svg class="info-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> ${info.size_formatted}</span>
        `;
    } catch (e) {
        elLightboxInfo.innerHTML = '';
    }
}

function closeLightbox() {
    elLightbox.classList.add('hidden');
    elLightboxImg.src = '';
    elLightboxImg.onload = null;
    document.getElementById('lightbox-boxes').innerHTML = '';
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
    // Limit history size by configured setting
    if (history.length > maxHistoryPerDir) {
        history = history.slice(0, maxHistoryPerDir);
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
                displayPath = '\u2026' + (path.includes('\\') ? '\\' : '/') + parts[parts.length - 1];
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
    elConfidenceThreshold.value = record.confidence_threshold || 0;
    elConfidenceValue.textContent = parseFloat(elConfidenceThreshold.value).toFixed(2);
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

