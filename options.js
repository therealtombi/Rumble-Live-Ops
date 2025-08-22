/*!
 * Rumble Live Ops - options.js
 * Version: 4.0.0
 * Description: Extension options/settings UI controller for RLO.
 * Manages user preferences, API verification, playlists,
 * videos, backgrounds, sounds, and feature toggles.
 *
 * Core responsibilities
 * ─────────────────────
 * • State + storage
 * - Caches: allVideosCache, cachedPlaylists, selectedPlaylistKeys.
 * - Toggles: defaultFunctionStates → persisted in chrome.storage.local.
 * - Helpers: markLocalToggle()/toggledRecently() for debounce on UI toggles.
 *
 * • Background messaging
 * - bgMessage(type,payload,timeout): safe runtime.sendMessage wrapper.
 * - sendToActiveRumble(): routes commands to active Rumble tab (Studio/Live),
 * auto-injecting content.js if needed.
 *
 * • UI feedback
 * - showToast(): lightweight transient notifications.
 * - Playlist progress bar: ensurePlaylistProgressUI(), update/completePlaylistProgress().
 *
 * • Helpers
 * - setSectionVisible(), getRelativePathOnly(), normalizeRumbleUrl().
 * - readFileAsDataURL(): for image/sound file imports.
 * - formatDateSmart(): context-sensitive date formatting.
 *
 * • Accordions
 * - setupAccordions()/recomputeOpenAccordions(): collapsible option panels.
 *
 * • Feature toggles
 * - loadFunctionStates()/saveFunctionStates(): sync checkboxes <→ storage.
 * - syncHideCampaignsToStudio(): propagates "hide campaigns" state to content.js.
 *
 * • Video manager
 * - Toolbar: filter/select/manage/clear playlists.
 * - List rendering: renderVideoManager()/renderVideoList().
 * - Bottom bar actions: manage/clear playlists.
 * - Selection helpers: updateSelectionStatus(), getSelectedVideoUrls().
 *
 * • Playlist manager
 * - renderPlaylists(): shows playlists with counts.
 * - Modal: openPlaylistModal()/closePlaylistModal(), renderPlaylistModalList().
 * - Actions: apply playlists to selected videos (applyPlaylistsToVideos msg),
 * runClearForSelection().
 *
 * • Raid targets
 * - renderRaidTargets(): optional test/demo list of live followed channels.
 * - Test popup handler: fetches raid targets + sends demo popup to content.js.
 *
 * • Background images
 * - applySelectedBackground(): applies chosen background (or default).
 * - renderBgList(): lists uploaded backgrounds with set/delete actions.
 *
 * • Sounds (raid/rant)
 * - renderSoundList(): manage lists of audio files with set/delete actions.
 * - Stored in chrome.storage.local as base64 dataUrls.
 *
 * • API verification
 * - verifyApiKey(): validates stored rumbleApiKey via background fetch.
 * - Updates username, follower count, livestream info, and people lists
 * (followers, subscribers, gifted subs).
 * - updateNextLiveLink(): updates “Next Live Stream” link.
 *
 * • INIT (DOMContentLoaded)
 * - Sets up accordions, toasts, toggles, and event handlers for:
 * • Save API key
 * • Fetch Playlists
 * • Harvest Videos
 * • Get Raid Targets
 * • Add/Delete backgrounds
 * • Add/Delete raid/rant sounds
 * • Test RAID/RANT injections + popups
 * - Loads data from chrome.storage.local:
 * API key, playlists, videos, harvesting state, backgrounds, sounds, toggles.
 * - Applies UI rendering accordingly.
 *
 * • Runtime listeners
 * - chrome.runtime.onMessage:
 * • toast → showToast
 * • videos-harvest-complete → refresh list
 * • playlistsUpdated → refresh playlists
 * • playlist-apply-* → update/complete progress
 * - chrome.storage.onChanged:
 * • Updates videos, playlists, harvesting flag, and feature toggle toast.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

let allVideosCache = [];
let videoFilterValue = '';
let cachedPlaylists = [];
let isPlaylistModalOpen = false;
let selectedPlaylistKeys = new Set();

const recentLocalToggle = {};
const markLocalToggle = (id) => (recentLocalToggle[id] = Date.now());
const toggledRecently = (id, ms = 1500) => Date.now() - (recentLocalToggle[id] || 0) < ms;

const defaultFunctionStates = {
    'enable-streamer-mode': false,
    'enable-raid-button-live': false,
    'enable-raid-button-studio': false,
    'enable-followers-live': false,
    'enable-gamify-dashboard': false,
    'enable-hide-campaigns': false,
    'enable-chat-styling': false,
    'enable-studio-layouts': false,
    'enable-gifted-live': false,
    'enable-followers-studio': false,
    'enable-gifted-studio': false,
    'enable-achievements': false,
    'enable-clips-command': false,
    'enable-chat-enhancements': false,
};

const KEYS = {
    BG_LIST: 'bgImages',
    BG_SELECTED: 'bgSelectedIndex',
    RAID_LIST: 'raidSounds',
    RAID_SELECTED: 'raidSelectedIndex',
    RANT_LIST: 'rantSounds',
    RANT_SELECTED: 'rantSelectedIndex'
};

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function bgMessage(type, payload = {}, timeoutMs = 5000) {
    console.log("✅ [RLO] Options bgMessage →", type, payload);
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            console.warn("✅ [RLO] Options bgMessage timeout:", type);
            resolve(null);
        }, timeoutMs);
        chrome.runtime.sendMessage({
            type,
            ...(payload && {
                payload
            })
        }, (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            console.log("✅ [RLO] Options bgMessage ←", type, res);
            resolve(res);
        });
    });
}

function showToast(message, type = 'info', timeout = 3500) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity .25s';
    }, timeout);
    setTimeout(() => {
        t.remove();
    }, timeout + 300);
}

async function sendToActiveRumble(msg) {
    try {
        const tabs = await chrome.tabs.query({
            url: ['https://studio.rumble.com/*', 'https://rumble.com/*']
        });
        const target = tabs.find(t => /studio\.rumble\.com/.test(t.url) && t.active) || tabs.find(t => /rumble\.com/.test(t.url) && t.active) || tabs.find(t => /studio\.rumble\.com/.test(t.url)) || tabs.find(t => /rumble\.com/.test(t.url));
        if (!target) {
            showToast('Open a Rumble Studio or Live page first.', 'error');
            return false;
        }
        try {
            await chrome.tabs.sendMessage(target.id, msg);
            return true;
        } catch (e1) {
            try {
                await chrome.scripting.executeScript({
                    target: {
                        tabId: target.id
                    },
                    files: ['content.js']
                });
                await chrome.tabs.sendMessage(target.id, msg);
                return true;
            } catch (e2) {
                console.warn('✅ [RLO] Options sendToActiveRumble failed after inject:', e2);
                showToast('Could not reach the Rumble tab.', 'error');
                return false;
            }
        }
    } catch (e) {
        console.warn('✅ [RLO] Options sendToActiveRumble failed:', e);
        showToast('Could not reach the Rumble tab.', 'error');
        return false;
    }
}

async function syncHideCampaignsToStudio(enabled) {
    try {
        await sendToActiveRumble({
            type: 'rlo-hide-campaigns-toggle',
            enabled: !!enabled
        });
    } catch {}
}

function ensurePlaylistProgressStyles() {
    if (document.getElementById('rlo-progress-styles')) return;
    const css = `
  .rlo-progress-wrap{display:none;gap:8px;flex-direction:column;margin:12px 0;padding:10px;border:1px solid #263241;border-radius:10px;background:#0b1016;}
  .rlo-progress-head{display:flex;align-items:center;gap:8px;font-size:14px;}
  .rlo-progress-head .spacer{flex:1;}
  .rlo-progress-bar{position:relative;height:10px;border-radius:999px;background:#1a2230;overflow:hidden}
  .rlo-progress-fill{position:absolute;inset:0 100% 0 0;border-radius:999px;background:linear-gradient(90deg,#33c3ff,#21f3a6);}
  .rlo-chip{font-size:12px;padding:2px 8px;border-radius:999px;background:#13202e;border:1px solid #2a3a4e;}
  .rlo-link{all:unset;cursor:pointer;font-size:12px;color:#9bb4d3;opacity:.9}
  .rlo-link:hover{opacity:1;text-decoration:underline;}
  `;
    const style = document.createElement('style');
    style.id = 'rlo-progress-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

function ensurePlaylistProgressUI() {
    ensurePlaylistProgressStyles();
    if (document.getElementById('rlo-progress')) return;
    const host = document.getElementById('video-manager-section') || document.body;
    const wrap = document.createElement('div');
    wrap.id = 'rlo-progress';
    wrap.className = 'rlo-progress-wrap';
    wrap.innerHTML = `
    <div class="rlo-progress-head">
      <span class="rlo-chip" id="rlo-progress-label">Updating playlists…</span>
      <span id="rlo-progress-count">0 / 0</span>
      <span class="spacer"></span>
      <button class="rlo-link" id="rlo-progress-hide" type="button">hide</button>
    </div>
    <div class="rlo-progress-bar"><div class="rlo-progress-fill" id="rlo-progress-fill"></div></div>
  `;
    host.prepend(wrap);
    const hideBtn = wrap.querySelector('#rlo-progress-hide');
    if (hideBtn) hideBtn.addEventListener('click', () => {
        wrap.style.display = 'none';
    });
}

function getProgressEls() {
    const wrap = document.getElementById('rlo-progress');
    const fill = document.getElementById('rlo-progress-fill');
    const count = document.getElementById('rlo-progress-count');
    const label = document.getElementById('rlo-progress-label');
    return {
        wrap,
        fill,
        count,
        label
    };
}

function showPlaylistProgress(total, labelText) {
    ensurePlaylistProgressUI();
    const {
        wrap,
        fill,
        count,
        label
    } = getProgressEls();
    if (!wrap || !fill || !count) return;
    wrap.style.display = 'flex';
    fill.style.inset = '0 100% 0 0';
    count.textContent = `0 / ${total||0}`;
    if (label) label.textContent = labelText || 'Updating playlists…';
}

function updatePlaylistProgress({
    done,
    total
} = {}) {
    let {
        wrap,
        fill,
        count
    } = getProgressEls();
    if (!wrap) {
        showPlaylistProgress(typeof total === 'number' ? total : 0);
        ({
            wrap,
            fill,
            count
        } = getProgressEls());
    }
    if (!wrap || !fill || !count) return;
    if (typeof done === 'number' && typeof total === 'number') {
        const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
        fill.style.inset = `0 ${100-pct}% 0 0`;
        count.textContent = `${done||0} / ${total||0}`;
    }
}

function completePlaylistProgress({
    successCount,
    total
} = {}) {
    let {
        wrap,
        label
    } = getProgressEls();
    if (!wrap) {
        showPlaylistProgress(typeof total === 'number' ? total : (successCount || 0));
        ({
            wrap,
            label
        } = getProgressEls());
    }
    const finalTotal = (typeof total === 'number' ? total : (typeof successCount === 'number' ? successCount : 0));
    updatePlaylistProgress({
        done: finalTotal,
        total: finalTotal
    });
    if (label) label.textContent = 'Completed';
    if (wrap) setTimeout(() => {
        wrap.style.display = 'none';
    }, 1200);
}

function setSectionVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'block' : 'none';
}

function getRelativePathOnly(url) {
    try {
        const u = new URL(url, 'https://rumble.com');
        return u.pathname + u.search + u.hash;
    } catch {
        return url || '';
    }
}

function normalizeRumbleUrl(rel) {
    if (!rel) return '#';
    try {
        return new URL(rel, 'https://rumble.com').toString();
    } catch {
        return '#';
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
    });
}

function getPlaylistKey(p) {
    return p.id || p.playlistId || p.slug || p.url || p.href || p.name || p.title || '';
}

function getSelectedVideoUrls() {
    const urls = new Set();
    document.querySelectorAll('.video-select:checked').forEach(cb => {
        const u = cb.getAttribute('data-url');
        if (u) urls.add(u);
    });
    return Array.from(urls);
}

function formatDateSmart(value) {
    try {
        let d = null;
        if (value instanceof Date) d = value;
        else if (typeof value === 'number') d = new Date(value);
        else if (typeof value === 'string') {
            const s = value.trim();
            if (/^\d+$/.test(s)) {
                const n = Number(s);
                d = new Date(n > 1e12 ? n : n * 1000);
            } else {
                d = new Date(s);
            }
        }
        if (!d || isNaN(d.getTime())) return String(value);
        const now = new Date();
        const sameYear = d.getFullYear() === now.getFullYear();
        const optsSameYear = {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        };
        const optsWithYear = {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return new Intl.DateTimeFormat(undefined, sameYear ? optsSameYear : optsWithYear).format(d);
    } catch {
        return String(value);
    }
}

function recomputeOpenAccordions() {
    document.querySelectorAll('.accordion-header.active').forEach(btn => {
        const panel = btn.nextElementSibling;
        if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
    });
}

function setupAccordions() {
    document.querySelectorAll('.accordion-header').forEach(button => {
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            const panel = button.nextElementSibling;
            if (!panel) return;
            if (panel.style.maxHeight) {
                panel.style.maxHeight = null;
            } else {
                panel.style.maxHeight = panel.scrollHeight + 'px';
            }
            setTimeout(recomputeOpenAccordions, 10);
        });
    });
}

function loadFunctionStates() {
    chrome.storage.local.get({
        functionStates: defaultFunctionStates
    }, (data) => {
        const states = data.functionStates || defaultFunctionStates;
        Object.keys(defaultFunctionStates).forEach(id => {
            const cb = document.getElementById(id);
            if (cb) cb.checked = !!states[id];
        });
        console.log('✅ [RLO] Options Loaded functionStates:', states);
    });
}

function saveFunctionStates() {
    const states = {};
    document.querySelectorAll('.function-toggle input[type="checkbox"]').forEach(t => {
        states[t.id] = t.checked;
    });
    chrome.storage.local.set({
        functionStates: states
    }, () => {
        console.log('✅ [RLO] Options functionStates saved:', states);
    });
}

function ensureVideoToolbar() {
    const toolbar = document.getElementById('video-toolbar');
    if (!toolbar || toolbar.dataset.bound) return;
    toolbar.innerHTML = `
    <input type="text" id="video-filter-input" placeholder="Filter videos by title..." />
    <button class="secondary" id="video-select-all">Select All</button>
    <button class="ghost" id="video-clear-selection">Clear Selection</button>
    <button id="video-manage-playlists">Manage Playlists</button>
    <button class="danger" id="video-clear-playlists">Clear Playlists</button>
    <span id="video-selection-status" style="margin-left:auto;"></span>
  `;
    toolbar.dataset.bound = "1";
    toolbar.querySelector('#video-filter-input').addEventListener('input', (e) => {
        videoFilterValue = e.target.value || '';
        renderVideoList(allVideosCache);
    });
    toolbar.querySelector('#video-select-all').addEventListener('click', () => {
        document.querySelectorAll('.video-select').forEach(c => c.checked = true);
        updateSelectionStatus();
    });
    toolbar.querySelector('#video-clear-selection').addEventListener('click', () => {
        document.querySelectorAll('.video-select').forEach(c => c.checked = false);
        updateSelectionStatus();
    });
    toolbar.querySelector('#video-manage-playlists').addEventListener('click', openPlaylistModal);
    toolbar.querySelector('#video-clear-playlists').addEventListener('click', runClearForSelection);
}

function ensureVideoBottomBar() {
    if (document.getElementById('video-bottom-bar')) return;
    const container = document.getElementById('video-list-container');
    if (!container) return;
    const bar = document.createElement('div');
    bar.id = 'video-bottom-bar';
    bar.style.cssText = 'display:flex; gap:8px; margin:12px 0 6px;';
    bar.innerHTML = `<button id="video-manage-playlists-bottom">Manage Playlists</button><button class="danger" id="video-clear-playlists-bottom">Clear Playlists</button>`;
    container.after(bar);
    document.getElementById('video-manage-playlists-bottom').addEventListener('click', openPlaylistModal);
    document.getElementById('video-clear-playlists-bottom').addEventListener('click', runClearForSelection);
}

function updateSelectionStatus() {
    const checked = Array.from(document.querySelectorAll('.video-select')).filter(c => c.checked);
    const status = document.getElementById('video-selection-status');
    if (status) status.textContent = `${checked.length} selected`;
    const canAct = checked.length > 0;
    const topClear = document.getElementById('video-clear-playlists');
    const bottomClear = document.getElementById('video-clear-playlists-bottom');
    if (topClear) topClear.disabled = !canAct;
    if (bottomClear) bottomClear.disabled = !canAct;
}

function renderVideoManager(videos) {
    allVideosCache = Array.isArray(videos) ? videos : [];
    ensureVideoToolbar();
    renderVideoList(allVideosCache);
}

function renderVideoList(videos) {
    const container = document.getElementById('video-list-container');
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('list-rows');
    if (!videos || videos.length === 0) {
        container.innerHTML = '<p>No videos found. Click "Fetch All My Videos" to begin.</p>';
        ensureVideoBottomBar();
        updateSelectionStatus();
        return;
    }
    const filter = (videoFilterValue || '').trim().toLowerCase();
    videos.forEach(v => {
        const title = (v.title || v.name || v.url || 'Untitled');
        if (filter && !title.toLowerCase().includes(filter)) return;
        const id = v.id || v.videoId || '';
        const thumb = v.thumbnail || v.thumb || '';
        const rel = getRelativePathOnly(v.url || v.href || v.link || '');
        const url = normalizeRumbleUrl(rel);
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `<div class="thumb">${thumb ? `<img src="${thumb}" alt="${title}" />` : ''}</div><div class="title"><a href="${url}" target="_blank" rel="noopener">${title}</a><div class="meta">${id ? `ID: ${id}` : ''}</div></div><div class="actions"><input class="video-select" type="checkbox" data-id="${id}" data-url="${url}" /></div>`;
        const img = row.querySelector('img');
        if (img) img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        container.appendChild(row);
    });
    container.querySelectorAll('.video-select').forEach(cb => {
        cb.addEventListener('change', updateSelectionStatus);
    });
    ensureVideoBottomBar();
    updateSelectionStatus();
    recomputeOpenAccordions();
}

function renderPlaylists(playlists) {
    cachedPlaylists = Array.isArray(playlists) ? playlists : [];
    const section = document.getElementById('playlists-section');
    const container = document.getElementById('playlists-container');
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('list-rows');
    if (!Array.isArray(playlists) || playlists.length === 0) {
        container.innerHTML = '<p>No playlists found. Click "Fetch Playlists" to get started.</p>';
        if (section) section.style.display = 'block';
        return;
    }
    playlists.forEach(p => {
        const title = p.title || p.name || 'Untitled Playlist';
        const url = p.url || p.href || (p.slug ? `https://rumble.com/${p.slug}` : '#');
        const thumb = p.thumbnail || p.thumb || '';
        const count = p.count ?? p.size ?? (Array.isArray(p.videos) ? p.videos.length : null);
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `<div class="thumb">${thumb ? `<img src="${thumb}" alt="${title}" />` : ''}</div><div class="title"><a href="${url}" target="_blank" rel="noopener">${title}</a><div class="meta">${count != null ? `${count} videos` : ''}</div></div><div class="actions"></div>`;
        const img = row.querySelector('img');
        if (img) img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        container.appendChild(row);
    });
    if (section) section.style.display = 'block';
    recomputeOpenAccordions();
}

function renderRaidTargets(targets) {
    const container = document.getElementById('raid-targets-list');
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('list-rows');
    if (!Array.isArray(targets) || !targets.length) {
        container.innerHTML = '<p class="help">No live followed channels found.</p>';
        return;
    }
    targets.forEach(t => {
        const name = t.username || 'Unknown';
        const href = t.url || '#';
        const pic = t.thumbnail_url || '';
        const viewers = (typeof t.viewers === 'number' && isFinite(t.viewers)) ? t.viewers : null;
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `<div class="thumb">${pic ? `<img src="${pic}" alt="${name}" />` : ''}</div><div class="title"><a href="${href}" target="_blank" rel="noopener">${name}</a><div class="meta">${t.is_live ? 'LIVE' : ''}${viewers != null ? (t.is_live ? ' • ' : '') + `${viewers} watching` : ''}</div></div><div class="actions"></div>`;
        const img = row.querySelector('img');
        if (img) img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        container.appendChild(row);
    });
}

function updatePlaylistModalStatus() {
    const status = document.getElementById('playlist-selection-status');
    const applyBtn = document.getElementById('playlist-apply');
    const selectedVideos = getSelectedVideoUrls().length;
    if (status) status.textContent = `${selectedPlaylistKeys.size} playlists selected • ${selectedVideos} videos selected`;
    if (applyBtn) applyBtn.disabled = !(selectedPlaylistKeys.size > 0 && selectedVideos > 0);
}

function renderPlaylistModalList(playlists, filter = '') {
    const listWrap = document.getElementById('playlist-modal-list');
    const emptyMsg = document.getElementById('playlist-modal-empty');
    if (!listWrap || !emptyMsg) return;
    listWrap.innerHTML = '';
    const arr = Array.isArray(playlists) ? playlists : [];
    const filtered = filter ? arr.filter(p => (p.title || p.name || '').toLowerCase().includes(filter.toLowerCase())) : arr;
    if (filtered.length === 0) {
        emptyMsg.style.display = 'block';
        updatePlaylistModalStatus();
        return;
    }
    emptyMsg.style.display = 'none';
    filtered.forEach(p => {
        const key = getPlaylistKey(p);
        const title = p.title || p.name || key || 'Untitled Playlist';
        const count = p.count ?? p.size ?? (Array.isArray(p.videos) ? p.videos.length : null);
        const row = document.createElement('label');
        row.className = 'checkbox-row';
        row.innerHTML = `<input type="checkbox" class="playlist-checkbox" data-key="${key}"><span>${title}</span><span class="micro" style="margin-left:auto;">${count != null ? `${count} videos` : ''}</span>`;
        const cb = row.querySelector('input');
        cb.checked = selectedPlaylistKeys.has(key);
        cb.addEventListener('change', () => {
            if (cb.checked) selectedPlaylistKeys.add(key);
            else selectedPlaylistKeys.delete(key);
            updatePlaylistModalStatus();
        });
        listWrap.appendChild(row);
    });
    updatePlaylistModalStatus();
}

function openPlaylistModal() {
    selectedPlaylistKeys = new Set();
    const overlay = document.getElementById('playlist-modal-overlay');
    const closeBtn = document.getElementById('playlist-modal-close');
    const filterInput = document.getElementById('playlist-filter-input');
    const selectAllBtn = document.getElementById('playlist-select-all');
    const clearBtn = document.getElementById('playlist-clear');
    const cancelBtn = document.getElementById('playlist-cancel');
    const applyBtn = document.getElementById('playlist-apply');
    if (!overlay || !closeBtn || !filterInput || !selectAllBtn || !clearBtn || !cancelBtn || !applyBtn) return;
    renderPlaylistModalList(cachedPlaylists);
    if (!overlay.dataset.bound) {
        filterInput.addEventListener('input', () => {
            renderPlaylistModalList(cachedPlaylists, filterInput.value || '');
        });
        selectAllBtn.addEventListener('click', () => {
            selectedPlaylistKeys = new Set((cachedPlaylists || []).map(getPlaylistKey).filter(Boolean));
            renderPlaylistModalList(cachedPlaylists, filterInput.value || '');
        });
        clearBtn.addEventListener('click', () => {
            selectedPlaylistKeys.clear();
            renderPlaylistModalList(cachedPlaylists, filterInput.value || '');
        });
        cancelBtn.addEventListener('click', closePlaylistModal);
        closeBtn.addEventListener('click', closePlaylistModal);
        applyBtn.addEventListener('click', () => {
            const videoUrls = getSelectedVideoUrls();
            if (videoUrls.length === 0) {
                showToast('Select at least one video first.', 'error');
                return;
            }
            if (selectedPlaylistKeys.size === 0) {
                showToast('Select at least one playlist.', 'error');
                return;
            }
            const keySet = new Set(selectedPlaylistKeys);
            const playlistNames = (cachedPlaylists || []).filter(p => keySet.has(getPlaylistKey(p))).map(p => p.title || p.name || getPlaylistKey(p)).filter(Boolean);
            const username = (document.getElementById('username')?.textContent || '').trim();
            const startUrl = username ? `https://rumble.com/user/${encodeURIComponent(username)}?page=1` : 'https://rumble.com';
            chrome.runtime.sendMessage({
                type: 'applyPlaylistsToVideos',
                payload: {
                    playlistKeys: Array.from(selectedPlaylistKeys),
                    playlistNames,
                    videoUrls,
                    startUrl
                }
            });
            showToast(`Starting playlist updates for ${videoUrls.length} video(s)…`, 'info', 4000);
            closePlaylistModal();
        });
        const onKey = (e) => {
            if (e.key === 'Escape') closePlaylistModal();
        };
        const onClickOutside = (e) => {
            if (e.target === overlay) closePlaylistModal();
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', onClickOutside);
        overlay._onKey = onKey;
        overlay._onClickOutside = onClickOutside;
        overlay.dataset.bound = '1';
    }
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    isPlaylistModalOpen = true;
    closeBtn.focus();
    updatePlaylistModalStatus();
}

function closePlaylistModal() {
    const overlay = document.getElementById('playlist-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    isPlaylistModalOpen = false;
}

function runClearForSelection() {
    const videoUrls = getSelectedVideoUrls();
    if (videoUrls.length === 0) {
        showToast('Select at least one video first.', 'error');
        return;
    }
    chrome.runtime.sendMessage({
        type: 'clearPlaylistsFromVideos',
        payload: {
            videoUrls
        }
    });
    showToast(`Clearing playlists on ${videoUrls.length} video(s)…`, 'info', 4000);
}

function applySelectedBackground(bgList, selectedIndex) {
    const body = document.body;
    if (Array.isArray(bgList) && bgList.length && selectedIndex != null && bgList[selectedIndex]) {
        const url = bgList[selectedIndex].dataUrl;
        body.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0.35), rgba(0,0,0,0.65)), url('${url}') center/cover fixed no-repeat`;
    } else {
        body.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0.35), rgba(0,0,0,0.65)), url('images/bg.jpg') center/cover fixed no-repeat`;
    }
    body.style.backgroundBlendMode = 'multiply';
}

function renderBgList(bgList = [], selectedIndex = null) {
    const listEl = document.getElementById('bg-list');
    listEl.innerHTML = '';
    if (!bgList.length) {
        listEl.innerHTML = '<p class="help">No background images yet.</p>';
        return;
    }
    bgList.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'simple-row';
        row.innerHTML = `<div class="thumb" style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0c1116;border-radius:8px;">${item.dataUrl ? `<img src="${item.dataUrl}" alt="${item.name}" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;" />` : ''}</div><div class="title"><div>${item.name || 'Background'}</div><div class="meta">${formatDateSmart(item.addedAt || Date.now())}</div>${idx === selectedIndex ? `<span class="chip">Default</span>` : ''}</div><div class="actions"><button class="secondary" data-action="select" data-index="${idx}">Set Default</button><button class="ghost" data-action="delete" data-index="${idx}">Delete</button></div>`;
        const img = row.querySelector('img');
        if (img) img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        listEl.appendChild(row);
    });
    listEl.querySelectorAll('button[data-action="select"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.index);
            chrome.storage.local.set({
                [KEYS.BG_SELECTED]: idx
            }, () => {
                applySelectedBackground(bgList, idx);
                renderBgList(bgList, idx);
                showToast('Background set as default.', 'success');
            });
        });
    });
    listEl.querySelectorAll('button[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.index);
            const newList = bgList.slice(0, idx).concat(bgList.slice(idx + 1));
            let newSelected = (selectedIndex != null ? selectedIndex : null);
            if (newSelected != null) {
                if (idx === selectedIndex) newSelected = newList.length ? 0 : null;
                else if (idx < selectedIndex) newSelected = selectedIndex - 1;
            }
            chrome.storage.local.set({
                [KEYS.BG_LIST]: newList,
                [KEYS.BG_SELECTED]: newSelected
            }, () => {
                applySelectedBackground(newList, newSelected);
                renderBgList(newList, newSelected);
                showToast('Background removed.', 'success');
            });
        });
    });
}

function renderSoundList(listEl, sounds = [], selectedIndex = null, type = 'raid') {
    listEl.innerHTML = '';
    if (!sounds.length) {
        listEl.innerHTML = `<p class="help">No ${type} sounds yet.</p>`;
        return;
    }
    sounds.forEach((s, idx) => {
        const row = document.createElement('div');
        row.className = 'simple-row';
        row.innerHTML = `<div class="thumb"></div><div class="title"><div>${s.name || `${type} sound`}</div><div class="meta">${formatDateSmart(s.addedAt || Date.now())}</div>${idx === selectedIndex ? `<span class="chip">Default</span>` : ''}<audio controls src="${s.dataUrl}" style="margin-top:6px;"></audio></div><div class="actions"><button class="secondary" data-action="select" data-index="${idx}">Set Default</button><button class="ghost" data-action="delete" data-index="${idx}">Delete</button></div>`;
        listEl.appendChild(row);
    });
    listEl.querySelectorAll('button[data-action="select"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.index);
            const selKey = type === 'raid' ? KEYS.RAID_SELECTED : KEYS.RANT_SELECTED;
            chrome.storage.local.set({
                [selKey]: idx
            }, () => {
                chrome.storage.local.get([type === 'raid' ? KEYS.RAID_LIST : KEYS.RANT_LIST], (data) => {
                    const arr = data[type === 'raid' ? KEYS.RAID_LIST : KEYS.RANT_LIST] || [];
                    renderSoundList(listEl, arr, idx, type);
                    showToast(`${type === 'raid' ? 'Raid' : 'Rant'} sound set as default.`, 'success');
                });
            });
        });
    });
    listEl.querySelectorAll('button[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.index);
            const listKey = type === 'raid' ? KEYS.RAID_LIST : KEYS.RANT_LIST;
            const selKey = type === 'raid' ? KEYS.RAID_SELECTED : KEYS.RANT_SELECTED;
            chrome.storage.local.get([listKey, selKey], (data) => {
                const arr = data[listKey] || [];
                const sel = data[selKey] ?? null;
                const newArr = arr.slice(0, idx).concat(arr.slice(idx + 1));
                let newSel = sel;
                if (newSel != null) {
                    if (idx === sel) newSel = newArr.length ? 0 : null;
                    else if (idx < sel) newSel = sel - 1;
                }
                chrome.storage.local.set({
                    [listKey]: newArr,
                    [selKey]: newSel
                }, () => {
                    renderSoundList(listEl, newArr, newSel, type);
                    showToast(`${type === 'raid' ? 'Raid' : 'Rant'} sound removed.`, 'success');
                });
            });
        });
    });
}

function renderSimplePeopleList(containerId, arr) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('list-rows');
    if (!Array.isArray(arr) || arr.length === 0) {
        el.innerHTML = '<p class="help">No recent items.</p>';
        return;
    }
    arr.forEach(p => {
        const name = p.username || p.name || 'Unknown';
        const pic = p.profile_pic_url || p.avatar || '';
        const link = p.url || (p.username ? `https://rumble.com/user/${p.username}` : '#');
        const when = p.followed_on || p.subscribed_on || p.gifted_on || '';
        const niceWhen = when ? formatDateSmart(when) : '';
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `<div class="thumb">${pic ? `<img src="${pic}" alt="${name}" />` : ''}</div><div class="title"><a href="${link}" target="_blank" rel="noopener">${name}</a><div class="meta">${niceWhen}</div></div><div class="actions"></div>`;
        const img = row.querySelector('img');
        if (img) img.addEventListener('error', () => {
            img.style.display = 'none';
        });
        el.appendChild(row);
    });
}

function updateNextLiveLink(live, scheduledOn, url) {
    const a = document.getElementById('next-live-link');
    if (!a) return;
    if (live) {
        a.textContent = 'Next Live Stream: LIVE now';
        a.href = url || 'https://rumble.com';
    } else if (scheduledOn) {
        a.textContent = `Next Live Stream: ${formatDateSmart(scheduledOn)}`;
        a.href = url || 'https://rumble.com';
    } else {
        a.textContent = 'Next Live Stream';
        a.href = '#';
    }
}

function verifyApiKey(key) {
    const sections = ['verification-info', 'lists-section', 'video-manager-section', 'playlists-section'];
    if (!key) {
        sections.forEach(id => setSectionVisible(id, false));
        updateNextLiveLink(false, null, null);
        return;
    }
    showToast('Verifying API key…', 'info', 2000);

    bgMessage('getApiData').then(apiRes => {
            if (!apiRes || !apiRes.success || !apiRes.data) {
                throw new Error(apiRes.error || 'Failed to fetch API data from background.');
            }
            const data = apiRes.data;
            sections.forEach(id => setSectionVisible(id, true));
            document.getElementById('username').textContent = data.username || 'N/A';
            document.getElementById('followers_count').textContent = data.followers?.num_followers_total ?? 'N/A';

            const livestream = data.livestreams?.[0];
            const isLive = !!livestream?.is_live;
            const sched = livestream?.scheduled_on || null;
            const liveUrl = livestream?.streamUrl || livestream?.url || null;
            const liveId = livestream?.streamId || null;

            document.getElementById('livestream-status').textContent = isLive ? 'Live' : 'Offline';
            document.getElementById('livestream-scheduled').textContent = sched ? formatDateSmart(sched) : '—';

            const liveUrlEl = document.getElementById('livestream-url');
            if (liveUrlEl) {
                liveUrlEl.textContent = liveUrl || '—';
            }

            const liveIdEl = document.getElementById('livestream-id');
            if (liveIdEl) {
                liveIdEl.textContent = liveId || '—';
            }

            updateNextLiveLink(isLive, sched, liveUrl);
            if (Array.isArray(data.followers?.recent_followers)) {
                renderSimplePeopleList('followers-list', data.followers.recent_followers);
            }
            if (Array.isArray(data.subscribers?.recent_subscribers)) {
                renderSimplePeopleList('subscribers-list', data.subscribers.recent_subscribers);
            }
            if (Array.isArray(data.gifted_subs?.recent_gifted)) {
                renderSimplePeopleList('gifted-subs-list', data.gifted_subs.recent_gifted);
            }
            showToast('API key verified.', 'success', 2200);
            recomputeOpenAccordions();
            const uname = (data?.username || '').replace(/^@/, '').trim();
            if (uname) {
                chrome.storage.local.set({
                    rumbleUsername: uname
                });
            }
        })
        .catch(err => {
            console.warn('✅ [RLO] Options API verify failed:', err);
            sections.forEach(id => setSectionVisible(id, false));
            updateNextLiveLink(false, null, null);
            showToast('Could not verify API key. Check the key and try again.', 'error');
        });
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
    setupAccordions();
    loadFunctionStates();
    ensurePlaylistProgressStyles();

    const apiKeyInput = document.getElementById('apiKey');
    const saveBtn = document.getElementById('save');
    const fetchPlaylistsBtn = document.getElementById('fetch-playlists-btn');
    const harvestVideosBtn = document.getElementById('harvest-videos-btn');
    const getRaidTargetsBtn = document.getElementById('get-raid-targets-btn');
    const bgInput = document.getElementById('bg-image-input');
    const addBgBtn = document.getElementById('add-bg-btn');
    const resetBgBtn = document.getElementById('reset-bg-default-btn');
    const raidInput = document.getElementById('raid-sound-input');
    const addRaidBtn = document.getElementById('add-raid-sound-btn');
    const raidListEl = document.getElementById('raid-sounds-list');
    const rantInput = document.getElementById('rant-sound-input');
    const addRantBtn = document.getElementById('add-rant-sound-btn');
    const rantListEl = document.getElementById('rant-sounds-list');
    const testRaidBtn = document.getElementById('test-raid-btn');
    const testRantBtn = document.getElementById('test-rant-btn');
    const testStatusBtn = document.getElementById('test-status-popup-btn');
    const testLivePopupBtn = document.getElementById('test-live-popup-btn');
    const achToggle = document.getElementById('enable-achievements');

    if (testRaidBtn) {
        testRaidBtn.addEventListener('click', async () => {
            const ok = await sendToActiveRumble({
                type: 'rlo-test-raid',
                from: 'Awesome Raider'
            });
            if (ok) showToast('Simulated RAID sent.', 'success');
        });
    }
    if (testRantBtn) {
        testRantBtn.addEventListener('click', async () => {
            const ok = await sendToActiveRumble({
                type: 'rlo-test-rant',
                from: 'Awesome Raider',
                amount: 2
            });
            if (ok) showToast('Simulated RANT sent.', 'success');
        });
    }
    if (testLivePopupBtn) {
        testLivePopupBtn.addEventListener('click', async () => {
            const ok = await sendToActiveRumble({
                type: 'rlo-test-live-popup'
            });
            if (ok) showToast('Requested Live Popup.', 'success');
        });
    }
    if (testStatusBtn) {
        testStatusBtn.addEventListener('click', async () => {
            const ok = await sendToActiveRumble({
                type: 'rlo-test-status-popup'
            });
            if (ok) showToast('Requested Status Popup.', 'info');
        });
    }
    if (achToggle) {
        achToggle.addEventListener('change', () => {
            if (achToggle.checked) {
                achToggle.checked = false;
                chrome.storage.local.get({
                    functionStates: defaultFunctionStates
                }, ({
                    functionStates
                }) => {
                    const next = {
                        ...(functionStates || defaultFunctionStates),
                        'enable-achievements': false
                    };
                    chrome.storage.local.set({
                        functionStates: next
                    });
                });
                showToast('Achievements are not available yet.', 'info');
            }
        });
    }

    chrome.storage.local.get(['rumbleApiKey', 'userPlaylists', 'userVideos', 'videos', 'harvestingVideos', KEYS.BG_LIST, KEYS.BG_SELECTED, KEYS.RAID_LIST, KEYS.RAID_SELECTED, KEYS.RANT_LIST, KEYS.RANT_SELECTED, 'functionStates'], (data) => {
        if (data.rumbleApiKey) {
            apiKeyInput.value = data.rumbleApiKey;
            verifyApiKey(data.rumbleApiKey);
        } else {
            verifyApiKey(null);
        }
        if (data.userPlaylists) renderPlaylists(data.userPlaylists);
        renderVideoManager(data.userVideos || data.videos || []);
        if (data.harvestingVideos) {
            harvestVideosBtn.disabled = true;
            showToast('Fetching videos…', 'info', 4000);
        }
        const bgList = data[KEYS.BG_LIST] || [],
            bgSel = (typeof data[KEYS.BG_SELECTED] === 'number') ? data[KEYS.BG_SELECTED] : null;
        applySelectedBackground(bgList, bgSel);
        renderBgList(bgList, bgSel);
        const raidArr = data[KEYS.RAID_LIST] || [],
            raidSel = (typeof data[KEYS.RAID_SELECTED] === 'number') ? data[KEYS.RAID_SELECTED] : null;
        renderSoundList(raidListEl, raidArr, raidSel, 'raid');
        const rantArr = data[KEYS.RANT_LIST] || [],
            rantSel = (typeof data[KEYS.RANT_SELECTED] === 'number') ? data[KEYS.RANT_SELECTED] : null;
        renderSoundList(rantListEl, rantArr, rantSel, 'rant');
        const hideEnabled = !!(data.functionStates?.['enable-hide-campaigns']);
        syncHideCampaignsToStudio(hideEnabled);
    });

    const onSaveClick = () => {
        const key = (apiKeyInput.value || '').trim();
        showToast('Saving API key...', 'info');
        chrome.storage.local.set({
            rumbleApiKey: key
        }, () => {
            verifyApiKey(key);
        });
    };
    if (saveBtn) saveBtn.addEventListener('click', onSaveClick);

    if (fetchPlaylistsBtn) {
        fetchPlaylistsBtn.addEventListener('click', () => {
            fetchPlaylistsBtn.disabled = true;
            showToast('Fetching playlists…', 'info');
            chrome.runtime.sendMessage({
                type: 'fetchPlaylists'
            });
        });
    }
    if (harvestVideosBtn) {
        harvestVideosBtn.addEventListener('click', () => {
            harvestVideosBtn.disabled = true;
            showToast('Starting full video scan…', 'info');
            chrome.runtime.sendMessage({
                type: 'harvestVideos'
            });
        });
    }
    if (getRaidTargetsBtn) {
        getRaidTargetsBtn.addEventListener('click', () => {
            getRaidTargetsBtn.disabled = true;
            showToast('Fetching live raid targets…', 'info');
            chrome.runtime.sendMessage({
                type: 'getRaidTargets'
            }, (res) => {
                getRaidTargetsBtn.disabled = false;
                if (!res || !res.success) {
                    showToast('Could not fetch raid targets.', 'error');
                    return;
                }
                renderRaidTargets(res.targets || []);
                showToast(`Found ${res.targets?.length || 0} live target(s).`, 'success');
            });
        });
    }

    document.querySelectorAll('.function-toggle input[type="checkbox"]').forEach(t => {
        t.addEventListener('change', () => {
            markLocalToggle(t.id);
            if (t.id === 'enable-hide-campaigns') {
                syncHideCampaignsToStudio(!!t.checked);
            }
            saveFunctionStates();
        });
    });

    const testPopupHandler = async () => {
        showToast('Fetching raid targets for demo...', 'info');

        const res = await bgMessage('getRaidTargets', {}, 7000);
        const list = (res && res.success && Array.isArray(res.targets)) ? res.targets : [];

        if (!list.length) {

            await sendToActiveRumble({
                type: 'rlo-show-demo-popup',
                payload: {
                    title: 'No Raid Targets Found',
                    subtitle: 'We could not find live channels you follow.',
                    rows: []
                }
            });
            showToast('Requested demo popup (no targets found).', 'info');
            return;
        }

        const rows = list.map(t => ({
            live: true,
            username: t.username || 'Unknown',
            avatarUrl: t.avatarUrl,
            url: t.url,
            viewers: (typeof t.viewers === 'number') ? t.viewers : undefined
        }));

        const ok = await sendToActiveRumble({
            type: 'rlo-show-demo-popup',
            payload: {
                title: 'Live Raid Targets (Demo)',
                subtitle: 'This is a preview of what you’ll see when you press the Raid button.',
                rows: rows
            }
        });

        if (ok) showToast('Demo popup request sent.', 'success');
    };

    if (testStatusBtn) {
        testStatusBtn.addEventListener('click', testPopupHandler);
    }
    if (testLivePopupBtn) {
        testLivePopupBtn.addEventListener('click', testPopupHandler);
    }

    if (testStatusBtn) {
        testStatusBtn.addEventListener('click', testPopupHandler);
    }
    if (testLivePopupBtn) {
        testLivePopupBtn.addEventListener('click', testPopupHandler);
    }



    let pendingBgFile = null;
    const onBgChange = (e) => {
        pendingBgFile = (e.target.files && e.target.files[0]) || null;
    };
    if (bgInput) bgInput.addEventListener('change', onBgChange);
    if (addBgBtn) addBgBtn.addEventListener('click', async () => {
        if (!pendingBgFile) return showToast('Choose an image first.', 'error');
        const dataUrl = await readFileAsDataURL(pendingBgFile);
        chrome.storage.local.get([KEYS.BG_LIST, KEYS.BG_SELECTED], (data) => {
            const list = data[KEYS.BG_LIST] || [];
            list.push({
                name: pendingBgFile.name,
                dataUrl,
                addedAt: Date.now()
            });
            const sel = (typeof data[KEYS.BG_SELECTED] === 'number') ? data[KEYS.BG_SELECTED] : (list.length - 1);
            chrome.storage.local.set({
                [KEYS.BG_LIST]: list,
                [KEYS.BG_SELECTED]: sel
            }, () => {
                applySelectedBackground(list, sel);
                renderBgList(list, sel);
                pendingBgFile = null;
                if (bgInput) bgInput.value = '';
                showToast('Background added.', 'success');
            });
        });
    });
    if (resetBgBtn) resetBgBtn.addEventListener('click', () => {
        chrome.storage.local.set({
            [KEYS.BG_SELECTED]: null
        }, () => {
            chrome.storage.local.get([KEYS.BG_LIST], (data) => {
                applySelectedBackground(data[KEYS.BG_LIST] || [], null);
                renderBgList(data[KEYS.BG_LIST] || [], null);
                showToast('Using default background.', 'success');
            });
        });
    });

    let pendingRaidFile = null,
        pendingRantFile = null;
    const onRaidChange = (e) => {
        pendingRaidFile = (e.target.files && e.target.files[0]) || null;
    };
    const onRantChange = (e) => {
        pendingRantFile = (e.target.files && e.target.files[0]) || null;
    };
    if (raidInput) raidInput.addEventListener('change', onRaidChange);
    if (rantInput) rantInput.addEventListener('change', onRantChange);
    if (addRaidBtn) addRaidBtn.addEventListener('click', async () => {
        if (!pendingRaidFile) return showToast('Choose a raid sound first.', 'error');
        const dataUrl = await readFileAsDataURL(pendingRaidFile);
        chrome.storage.local.get([KEYS.RAID_LIST, KEYS.RAID_SELECTED], (data) => {
            const list = data[KEYS.RAID_LIST] || [];
            list.push({
                name: pendingRaidFile.name,
                dataUrl,
                addedAt: Date.now()
            });
            const sel = (typeof data[KEYS.RAID_SELECTED] === 'number') ? data[KEYS.RAID_SELECTED] : (list.length - 1);
            chrome.storage.local.set({
                [KEYS.RAID_LIST]: list,
                [KEYS.RAID_SELECTED]: sel
            }, () => {
                renderSoundList(raidListEl, list, sel, 'raid');
                pendingRaidFile = null;
                if (raidInput) raidInput.value = '';
                showToast('Raid sound added.', 'success');
            });
        });
    });
    if (addRantBtn) addRantBtn.addEventListener('click', async () => {
        if (!pendingRantFile) return showToast('Choose a rant sound first.', 'error');
        const dataUrl = await readFileAsDataURL(pendingRantFile);
        chrome.storage.local.get([KEYS.RANT_LIST, KEYS.RANT_SELECTED], (data) => {
            const list = data[KEYS.RANT_LIST] || [];
            list.push({
                name: pendingRantFile.name,
                dataUrl,
                addedAt: Date.now()
            });
            const sel = (typeof data[KEYS.RANT_SELECTED] === 'number') ? data[KEYS.RANT_SELECTED] : (list.length - 1);
            chrome.storage.local.set({
                [KEYS.RANT_LIST]: list,
                [KEYS.RANT_SELECTED]: sel
            }, () => {
                renderSoundList(rantListEl, list, sel, 'rant');
                pendingRantFile = null;
                if (rantInput) rantInput.value = '';
                showToast('Rant sound added.', 'success');
            });
        });
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'toast') {
            showToast(message.message || 'Notice', message.level || 'info');
        }
        if (message.type === 'videos-harvest-complete') {
            renderVideoManager(message.videos || []);
            const btn = document.getElementById('harvest-videos-btn');
            if (btn) btn.disabled = false;
            showToast(`Scan complete! Found ${message.count || 0} videos.`, 'success', 4500);
            recomputeOpenAccordions();
        }
        if (message.type === 'playlistsUpdated') {
            renderPlaylists(message.playlists || []);
            const btn = document.getElementById('fetch-playlists-btn');
            if (btn) btn.disabled = false;
            showToast('Playlists updated!', 'success', 3000);
            if (isPlaylistModalOpen) renderPlaylistModalList(cachedPlaylists, document.getElementById('playlist-filter-input')?.value || '');
            recomputeOpenAccordions();
        }
        if (message.type === 'playlist-apply-started') {
            const label = message.mode === 'clear' ? 'Clearing playlists…' : 'Updating playlists…';
            showPlaylistProgress(message.total || 0, label);
        }
        if (message.type === 'playlist-apply-progress') {
            updatePlaylistProgress(message);
        }
        if (message.type === 'playlist-apply-complete') {
            const {
                successCount = 0, total = 0
            } = message;
            completePlaylistProgress(message);
            showToast(`Playlist operation complete: ${successCount}/${total} processed.`, 'success', 4500);
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.userVideos || changes.videos) {
            const vids = (changes.userVideos?.newValue) || (changes.videos?.newValue) || [];
            renderVideoManager(vids);
        }
        if (changes.userPlaylists) {
            renderPlaylists(changes.userPlaylists.newValue || []);
            if (isPlaylistModalOpen) renderPlaylistModalList(cachedPlaylists, document.getElementById('playlist-filter-input')?.value || '');
        }
        if (changes.harvestingVideos) {
            const harvesting = !!changes.harvestingVideos.newValue;
            const btn = document.getElementById('harvest-videos-btn');
            if (btn) btn.disabled = harvesting;
            if (harvesting) showToast('Fetching videos…', 'info');
        }
        if (changes.functionStates) {
            const prev = changes.functionStates.oldValue || {};
            const curr = changes.functionStates.newValue || {};
            if (prev['enable-streamer-mode'] !== curr['enable-streamer-mode'] && !toggledRecently('enable-streamer-mode')) {
                showToast(`Streamer Mode ${curr['enable-streamer-mode'] ? 'enabled' : 'disabled'}.`, 'info');
            }
            if (prev['enable-gamify-dashboard'] !== curr['enable-gamify-dashboard'] && !toggledRecently('enable-gamify-dashboard')) {
                showToast(`Gamify ${curr['enable-gamify-dashboard'] ? 'enabled' : 'disabled'}.`, 'info');
            }
            if (prev['enable-hide-campaigns'] !== curr['enable-hide-campaigns']) {
                const enabled = !!curr['enable-hide-campaigns'];
                if (!toggledRecently('enable-hide-campaigns')) {
                    showToast(`Campaigns will be ${enabled ? 'hidden' : 'visible'} in Studio.`, enabled ? 'success' : 'info');
                }
                syncHideCampaignsToStudio(enabled);
            }
        }
    });
});