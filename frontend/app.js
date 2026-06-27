// State Management
let sseConnection = null;
let matchedFiles = [];
let scanStats = {
    total: 0,
    processed: 0,
    matches: 0
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


const btnBrowseTarget = document.getElementById('btn-browse-target');
const btnBrowseDest = document.getElementById('btn-browse-dest');
const btnStartScan = document.getElementById('btn-start-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const btnClearResults = document.getElementById('btn-clear-results');

const elSystemStatus = document.getElementById('system-status');
const elStatsTotal = document.getElementById('stat-total');
const elStatsProcessed = document.getElementById('stat-processed');
const elStatsMatches = document.getElementById('stat-matches');

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

// Initialize Events
document.addEventListener('DOMContentLoaded', () => {
    btnBrowseTarget.addEventListener('click', () => browseFolder(elTargetDir));
    btnBrowseDest.addEventListener('click', () => browseFolder(elDestDir));
    btnStartScan.addEventListener('click', startScan);
    btnStopScan.addEventListener('click', stopScan);
    btnClearResults.addEventListener('click', clearGallery);
    
    // Lightbox close events
    elLightboxClose.addEventListener('click', closeLightbox);
    document.querySelector('.lightbox-overlay').addEventListener('click', closeLightbox);
    
    // Close lightbox on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // Render initial folder histories
    renderHistory('target');
    renderHistory('dest');
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
function clearGallery() {
    matchedFiles = [];
    elResultsGrid.innerHTML = '';
    elResultsGrid.classList.add('hidden');
    elEmptyState.classList.remove('hidden');
    elGalleryCount.classList.add('hidden');
    elGalleryCount.textContent = '0';
    
    // Reset stats
    scanStats = { total: 0, processed: 0, matches: 0 };
    updateStatsUI();
}

function updateStatsUI() {
    elStatsTotal.textContent = scanStats.total;
    elStatsProcessed.textContent = scanStats.processed;
    elStatsMatches.textContent = scanStats.matches;
}

// Helper to escape HTML characters
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
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
function addMatchToGallery(match, keywords) {
    elEmptyState.classList.add('hidden');
    elResultsGrid.classList.remove('hidden');
    
    const imageSrc = `/api/image?path=${encodeURIComponent(match.original_path)}`;
    
    const card = document.createElement('div');
    card.className = 'result-card';
    
    // Build highlights for snippets
    const snippetsHTML = match.snippets.map(snippet => 
        `<div class="snippet-line">${highlightText(snippet, keywords)}</div>`
    ).join('');
    
    card.innerHTML = `
        <div class="card-img-wrapper">
            <img src="${imageSrc}" alt="${escapeHTML(match.filename)}" loading="lazy">
            <div class="card-overlay">
                <span class="overlay-zoom-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </span>
            </div>
        </div>
        <div class="card-content">
            <div class="card-info">
                <div class="card-title" title="${escapeHTML(match.filename)}">${escapeHTML(match.filename)}</div>
                <div class="card-path" title="${escapeHTML(match.original_path)}">${escapeHTML(match.original_path)}</div>
            </div>
            ${snippetsHTML ? `<div class="card-snippets">${snippetsHTML}</div>` : ''}
            <div class="card-actions">
                <button class="btn btn-secondary btn-copy-path" data-path="${escapeHTML(match.original_path)}">
                    Copy Path
                </button>
                <button class="btn btn-primary btn-zoom" data-path="${escapeHTML(match.original_path)}">
                    Preview
                </button>
            </div>
        </div>
    `;
    
    // Event listeners for actions
    const imgWrapper = card.querySelector('.card-img-wrapper');
    imgWrapper.addEventListener('click', () => openLightbox(match, keywords));
    
    card.querySelector('.btn-zoom').addEventListener('click', () => openLightbox(match, keywords));
    
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
    keywords.forEach(kw => params.append('keywords', kw));

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
            
            // Add match to UI
            if (data.is_match && data.match_details) {
                matchedFiles.push(data.match_details);
                addMatchToGallery(data.match_details, keywords);
                
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
            elProgressBarFill.style.width = '100%';
            elProgressPercent.textContent = '100%';
            elProgressStatus.textContent = 'Completed!';
            elProgressCurrent.textContent = data.message;
            endScan('Ready', 'green');
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

