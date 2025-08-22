/*!
 * Rumble Live Ops - playlist-automator.js
 * Version: 4.0.0
 * Description: Automates the “Save to Playlist” workflow for both listing pages and video pages.
 *
 * Core responsibilities
 * ─────────────────────
 * • General utilities
 * - Normalizes playlist IDs/names, deduplicates arrays, resolves IDs from storage.
 * - Provides DOM helpers for checkboxes, overlays, lazy loading, etc.
 * - Logs progress back to the background script via chrome.runtime.sendMessage.
 *
 * • Listing Page Worker (legacy) → playlistWorkerRun
 * - Triggered when iterating through multiple video tiles on listing pages.
 * - Locates the target video tile (by absolute URL, ID, or path).
 * - Opens the "Save to Playlist" overlay from the tile’s context menu.
 * - Ensures the requested playlists are checked.
 * - Confirms via the overlay’s save button, then reports results upstream.
 *
 * • Video Page Worker (new) → videoWorkerRun
 * - Triggered directly on a single video’s watch page.
 * - Opens the "Save to Playlist" overlay from the page’s Save button.
 * - Supports two modes:
 * 1. Set → Check specific playlists (by ID first, then name fallback).
 * 2. Clear → Uncheck all playlists (remove video from all).
 * - Confirms save, reopens overlay if needed for verification, then reports success.
 *
 * • DOM targets & resilience
 * - Handles multiple generations of Rumble markup (.playlist-overlay, .save-to-playlist-modal, etc.).
 * - Includes fallbacks for buttons, checkboxes, lazy-loaded playlist spans.
 * - Retries with delays to handle async rendering or slow network.
 *
 * • Outputs
 * - Reports structured results back to background:
 * { processed, lastProcessed, processedThisPage, details }
 * - Includes info on checked/skipped/missing playlists and overlay confirmation.
 *
 * Safety
 * ──────
 * - All async DOM operations wrapped with retries and timeouts.
 * - Errors never break the page; failures logged and returned gracefully.
 * - Isolates automation to known overlays, avoids interfering with unrelated UI.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */


(() => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const toAbs = (u) => {
        try {
            return new URL(u, location.origin).toString();
        } catch {
            return u;
        }
    };
    const getVideoIdFromUrl = (u) => {
        try {
            const url = new URL(u, location.origin);
            return url.pathname.replace(/^\/v/, '').replace(/\.html$/, '') || null;
        } catch {
            return null;
        }
    };
    const bgLog = (where, data = {}) => {
        try {
            chrome.runtime.sendMessage({
                type: 'playlistWorkerLog',
                where,
                data
            });
        } catch {}
    };
    const uniq = (arr) => Array.from(new Set(arr));
    const getCheckboxFromNode = (el) => (el?.matches?.('input[type="checkbox"]') ? el : el?.querySelector?.('input[type="checkbox"]')) || null;

    function dispatchCheckboxChange(cb) {
        try {
            cb?.dispatchEvent?.(new Event('input', {
                bubbles: true
            }));
            cb?.dispatchEvent?.(new Event('change', {
                bubbles: true
            }));
        } catch {}
    }

    function isChecked(el) {
        if (!el) return false;
        const i = getCheckboxFromNode(el);
        if (i) return !!i.checked;
        const a = el.getAttribute?.('aria-checked');
        if (a != null) return a === 'true';
        return el.classList?.contains('is-checked') || el.classList?.contains('checked');
    }
    async function ensureChecked(targetEl, should = true, {
        attempts = 20,
        delay = 150
    } = {}) {
        for (let i = 0; i < attempts; i++) {
            if (isChecked(targetEl) === should) return true;
            targetEl.click();
            dispatchCheckboxChange(getCheckboxFromNode(targetEl) || targetEl);
            await sleep(delay);
            if (isChecked(targetEl) === should) return true;
        }
        return false;
    }
    async function waitForOverlayCloseOrToast({
        timeout = 12000
    } = {}) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            const open = document.querySelector('.overlay-bg .overlay, .playlist-overlay, .modal-playlist, .save-to-playlist-modal');
            const toast = document.querySelector('.toast, .snackbar, .notification-success, .alerts .alert-success');
            if (!open || toast) return true;
            await sleep(120);
        }
        return false;
    }

    function extractIdFromEl(el) {
        if (!el) return '';

        for (const a of ['data-playlist-id', 'data-playlistid', 'data-id', 'data-pl-id', 'data-id-playlist']) {
            const v = el.getAttribute?.(a);
            if (v) return String(v).trim();
        }

        const ds = el.dataset || {};
        for (const k of ['playlistId', 'playlistid', 'plId', 'id', 'playlist']) {
            if (ds[k]) return String(ds[k]).trim();
        }

        if (el.matches?.('input[type="checkbox"]')) {
            if (el.value) return String(el.value).trim();
            const m = (el.id || '').match(/(\d+|[a-z0-9_-]{6,})$/i);
            if (m) return m[1];
        }

        const forId = el.getAttribute?.('for');
        if (forId) {
            const inp = document.getElementById(forId);
            if (inp) {
                const via = extractIdFromEl(inp);
                if (via) return via;
            }
        }

        const a = el.querySelector?.('a[href*="/playlist/"]');
        if (a) {
            const m = (a.getAttribute('href') || '').match(/\/playlist\/([a-zA-Z0-9_-]+)/);
            if (m) return m[1];
        }

        let n = el.parentElement;
        for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
            const via = extractIdFromEl(n);
            if (via) return via;
        }
        return '';
    }

    function extractPlaylistMeta(itemEl) {
        const cb = getCheckboxFromNode(itemEl) || itemEl;
        const id = extractIdFromEl(cb) || extractIdFromEl(itemEl) || '';
        const nameEl = itemEl.querySelector?.('.playlist-item__name, .playlist-modal__item-name, .name, .title, span, div');
        const nameRaw = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
        const nameKey = nameRaw.toLowerCase();
        return {
            cb,
            id,
            nameRaw,
            nameKey
        };
    }

    async function openSaveOverlayFromMenu(tile) {
        const root = tile.closest('.listing__body, .listing__item, .videostream, .video-item, li, article') || tile.parentElement;
        if (!root) return {
            ok: false,
            reason: 'tile root not found'
        };
        let btn = root.querySelector('button[data-js="playlist_menu_button"]') || root.querySelector('button.playlist-menu__button') || root.querySelector('button[aria-expanded][class*="playlist-menu"]');
        if (!btn) {
            root.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: true
            }));
            await sleep(60);
            btn = root.querySelector('button[data-js="playlist_menu_button"]') || root.querySelector('button.playlist-menu__button');
            if (!btn) return {
                ok: false,
                reason: 'menu button not found'
            };
        }
        btn.click();
        let opt = null;
        for (let i = 0; i < 80; i++) {
            opt = document.querySelector('button.playlist-menu__option[data-playlist-option="save-to-playlist"]') || Array.from(document.querySelectorAll('button,li,[role="menuitem"]')).find(n => /save\s*to\s*playlist/i.test(n.textContent || ''));
            if (opt) break;
            await sleep(60);
        }
        if (!opt) return {
            ok: false,
            reason: 'menu option not found'
        };
        opt.click();
        for (let i = 0; i < 100; i++) {
            const overlay = document.querySelector('.overlay-bg .overlay, .playlist-overlay, .modal-playlist, .save-to-playlist-modal');
            if (overlay) return {
                ok: true,
                overlay
            };
            await sleep(60);
        }
        return {
            ok: false,
            reason: 'overlay not found'
        };
    }

    async function openSaveOverlayFromVideoPage() {
        let direct = document.querySelector('button[data-js="media_video-action_save_to_playlist"]') || document.querySelector('[data-action="save-to-playlist"]');
        if (direct) direct.click();
        else {
            const saveBtn = document.querySelector('button[aria-label*="Save"][aria-label*="playlist" i]') || Array.from(document.querySelectorAll('button.media-by-actions-button, button')).find(b => /save/i.test(b.textContent || ''));
            if (!saveBtn) return {
                ok: false,
                reason: 'save button not found'
            };
            saveBtn.click();
            for (let i = 0; i < 30; i++) {
                const menuItem = Array.from(document.querySelectorAll('button,li,[role="menuitem"]')).find(n => /save\s*to\s*playlist/i.test(n.textContent || ''));
                const overlayNow = document.querySelector('.overlay-bg .overlay, .playlist-overlay, .modal-playlist, .save-to-playlist-modal');
                if (overlayNow) break;
                if (menuItem) {
                    menuItem.click();
                    break;
                }
                await sleep(60);
            }
        }
        let overlay = null;
        for (let i = 0; i < 100; i++) {
            overlay = document.querySelector('.overlay-bg .overlay, .playlist-overlay, .modal-playlist, .save-to-playlist-modal');
            if (overlay) break;
            await sleep(60);
        }
        if (!overlay) return {
            ok: false,
            reason: 'overlay not found'
        };
        await ensureSaveListPanel(overlay);
        return {
            ok: true,
            overlay
        };
    }

    async function ensureSaveListPanel(overlay) {
        let list = overlay.querySelector('[data-js="playlist_modal_list_container"], .playlist-modal__list, .playlist-modal__content');
        if (list) return;
        const tabs = Array.from(overlay.querySelectorAll('button,[role="tab"],a'));
        const saveTab = tabs.find(t => /save\s*to\s*playlist|my\s*playlists|existing|saved/i.test((t.textContent || '').trim())) || tabs.find(t => /save_to_playlist|playlist_list/i.test(t.getAttribute?.('data-js') || ''));
        if (saveTab) {
            saveTab.click();
            for (let i = 0; i < 20; i++) {
                list = overlay.querySelector('[data-js="playlist_modal_list_container"], .playlist-modal__list, .playlist-modal__content');
                if (list) break;
                await sleep(80);
            }
        }
    }

    async function forceLoadAllPlaylists(overlay) {
        const container = overlay.querySelector('[data-js="playlist_modal_list_container"], .playlist-modal__list, .playlist-modal__content');
        if (!container) return;
        const getMore = async (span) => {
            const url = span.getAttribute('hx-get') || span.getAttribute('data-hx-get');
            let vals = span.getAttribute('hx-vals') || span.getAttribute('data-hx-vals') || '{}';
            try {
                vals = JSON.parse(vals);
            } catch {
                vals = {};
            }
            const qs = new URLSearchParams();
            Object.entries(vals).forEach(([k, v]) => qs.append(k, v));
            const resp = await fetch(toAbs(url) + '?' + qs.toString(), {
                credentials: 'include'
            });
            if (!resp.ok) return false;
            const html = await resp.text();
            span.insertAdjacentHTML('afterend', html);
            span.remove();
            return true;
        };
        for (let guard = 0; guard < 24; guard++) {
            const span = container.querySelector('span[hx-get*="get-save-to-playlist-list-items"], span[data-hx-get*="get-save-to-playlist-list-items"]');
            if (!span) break;
            try {
                const ok = await getMore(span);
                if (!ok) break;
            } catch {
                break;
            }
            await sleep(40);
        }
    }

    async function resolveIdsFromNames(nameList) {
        const names = uniq((nameList || []).map(s => (s || '').trim().toLowerCase()).filter(Boolean));
        if (!names.length) return [];
        const {
            userPlaylists = []
        } = await chrome.storage.local.get('userPlaylists').catch(() => ({
            userPlaylists: []
        }));
        const map = new Map((userPlaylists || []).map(p => [String((p.title || '').trim().toLowerCase()), String(p.id ?? p.playlist_id ?? p.slug ?? '').trim()]));
        const resolved = names.map(n => map.get(n)).filter(Boolean);
        bgLog('idResolveFromStorage', {
            names,
            resolved,
            totalStored: (userPlaylists || []).length
        });
        return uniq(resolved);
    }

    function findListContainer(overlay) {
        return overlay.querySelector('[data-js="playlist_modal_list_container"], .playlist-modal__list, .playlist-modal__content');
    }

    function snapshotOverlayPlaylists(overlay) {
        const c = findListContainer(overlay);
        if (!c) return {
            byId: new Map(),
            byName: new Map(),
            all: []
        };
        const items = Array.from(c.querySelectorAll('.playlist-modal__playist-item, .playlist-modal__playlist-item, .playlist-item, label, li'));
        const byId = new Map();
        const byName = new Map();
        const all = [];
        for (const el of items) {
            const meta = extractPlaylistMeta(el);
            all.push({
                id: meta.id,
                name: meta.nameRaw
            });
            if (meta.id) byId.set(meta.id, meta);
            if (meta.nameKey && !byName.has(meta.nameKey)) byName.set(meta.nameKey, meta);
        }
        return {
            byId,
            byName,
            all
        };
    }

    async function ensurePlaylistsChecked(overlay, {
        playlistIds,
        playlistNames
    }) {
        const container = findListContainer(overlay);
        if (!container) return {
            checked: [],
            skipped: [],
            missing: []
        };

        let ids = uniq((playlistIds || []).map(String).map(s => s.trim()).filter(Boolean));
        const names = uniq((playlistNames || []).map(s => (s || '').trim().toLowerCase()).filter(Boolean));

        const {
            byId,
            byName,
            all
        } = snapshotOverlayPlaylists(overlay);
        bgLog('overlayPlaylistsSnapshot', {
            count: all.length,
            sample: all.slice(0, 10)
        });

        if (!ids.length && names.length) {
            ids = await resolveIdsFromNames(names);
            bgLog('idResolveOutcome', {
                fromNames: names,
                resolvedIds: ids
            });
        }

        const checked = [],
            skipped = [],
            missing = [];
        if (ids.length) {

            for (const id of ids) {
                const meta = byId.get(id);
                if (!meta) {
                    missing.push({
                        id,
                        name: null
                    });
                    continue;
                }
                if (isChecked(meta.cb)) {
                    skipped.push({
                        id,
                        name: meta.nameRaw
                    });
                    continue;
                }
                const ok = await ensureChecked(meta.cb, true, {
                    attempts: 20,
                    delay: 160
                });
                if (ok) checked.push({
                    id,
                    name: meta.nameRaw
                });
                else bgLog('playlistCheckFailed', {
                    id,
                    name: meta.nameRaw
                });
            }
        } else {

            for (const nameKey of names) {
                const meta = byName.get(nameKey);
                if (!meta) {
                    missing.push({
                        id: null,
                        name: nameKey
                    });
                    continue;
                }
                if (isChecked(meta.cb)) {
                    skipped.push({
                        id: meta.id || null,
                        name: meta.nameRaw
                    });
                    continue;
                }
                const ok = await ensureChecked(meta.cb, true, {
                    attempts: 20,
                    delay: 160
                });
                if (ok) checked.push({
                    id: meta.id || null,
                    name: meta.nameRaw
                });
                else bgLog('playlistCheckFailed', {
                    id: meta.id || null,
                    name: meta.nameRaw
                });
            }
        }

        return {
            checked,
            skipped,
            missing
        };
    }

    async function ensureAllPlaylistsUnchecked(overlay) {
        const c = findListContainer(overlay);
        if (!c) return {
            unchecked: 0,
            hadNone: 0
        };
        const checks = Array.from(c.querySelectorAll('input.input-checkbox[data-js="playlist_checkbox"], input[type="checkbox"]'));
        let unchecked = 0,
            hadNone = 0;
        for (const cb of checks) {
            if (isChecked(cb)) {
                const ok = await ensureChecked(cb, false, {
                    attempts: 20,
                    delay: 140
                });
                if (ok) unchecked++;
            } else hadNone++;
        }
        return {
            unchecked,
            hadNone
        };
    }

    function pickSaveButtonForList(overlay) {
        const list = findListContainer(overlay);
        if (!list) return null;

        let scope = list;
        for (let i = 0; i < 6 && scope; i++, scope = scope.parentElement) {
            const btn = scope.querySelector?.('button,[role="button"],input[type="submit"]');
            if (btn) {
                const c = scope.querySelectorAll?.('button,[role="button"],input[type="submit"]');
                if (c?.length) break;
            }
        }
        scope = scope || overlay;
        const btns = Array.from(scope.querySelectorAll('button,[role="button"],input[type="submit"]'));
        const scored = btns.map(b => {
            const text = (b.textContent || b.value || '').trim().toLowerCase();
            const ds = b.getAttribute?.('data-js') || '';
            let score = 0;
            if (/save_to_playlist/.test(ds)) score += 10;
            if (/playlist.*save/.test(ds)) score += 5;
            if (/^(save|apply|done|ok)$/.test(text)) score += 4;
            if (/\bsave\b/.test(text)) score += 2;
            if (/create/.test(text)) score -= 8;
            if (b.disabled || b.getAttribute('aria-disabled') === 'true') score -= 2;
            return {
                b,
                score,
                text,
                ds
            };
        }).filter(x => x.score > 0);
        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.b || null;
    }

    async function clickSubmitInOverlay(overlay) {
        let candidate = overlay.querySelector('button[data-js*="save_to_playlist"], button[data-js="save_to_playlist_submit"]') || pickSaveButtonForList(overlay);
        if (!candidate) return false;
        for (let i = 0; i < 40; i++) {
            const dis = candidate.disabled || candidate.getAttribute?.('aria-disabled') === 'true' || candidate.classList?.contains('is-disabled');
            if (!dis) break;
            await sleep(100);
        }
        bgLog('overlaySubmitButton', {
            text: (candidate.textContent || candidate.value || '').trim()
        });
        candidate.click();
        await sleep(300);
        return true;
    }

    function countWantedCheckedInOverlay(overlay, {
        playlistIds = [],
        playlistNames = []
    } = {}) {
        const c = findListContainer(overlay);
        if (!c) return {
            on: 0,
            expected: 0
        };
        const items = Array.from(c.querySelectorAll('.playlist-modal__playist-item, .playlist-modal__playlist-item, .playlist-item, label, li'));
        const ids = uniq((playlistIds || []).map(String).map(s => s.trim()).filter(Boolean));
        const names = uniq((playlistNames || []).map(s => (s || '').trim().toLowerCase()).filter(Boolean));
        if (ids.length) {
            const want = new Set(ids);
            let on = 0;
            for (const el of items) {
                const meta = extractPlaylistMeta(el);
                if (meta.id && want.has(meta.id) && isChecked(meta.cb)) on++;
            }
            return {
                on,
                expected: ids.length
            };
        } else {
            const want = new Set(names);
            let on = 0;
            for (const el of items) {
                const meta = extractPlaylistMeta(el);
                if (meta.nameKey && want.has(meta.nameKey) && isChecked(meta.cb)) on++;
            }
            return {
                on,
                expected: names.length
            };
        }
    }

    async function verifyVideoOverlayState(mode, playlists) {
        const ov2 = await openSaveOverlayFromVideoPage();
        if (!ov2.ok) return false;
        await ensureSaveListPanel(ov2.overlay);
        await forceLoadAllPlaylists(ov2.overlay);
        let ok;
        if (mode === 'set') {
            const {
                on,
                expected
            } = countWantedCheckedInOverlay(ov2.overlay, playlists || {});
            ok = on >= expected && expected > 0;
        } else if (mode === 'clear') {
            const anyOn = !!ov2.overlay.querySelector('input[type="checkbox"]:checked, [aria-checked="true"]');
            ok = !anyOn;
        } else ok = true;
        ov2.overlay.querySelector('.overlay-close,button[aria-label="Close"]')?.click();
        return ok;
    }

    async function confirmAndCloseOverlay(overlay, context) {
        const usedSubmit = await clickSubmitInOverlay(overlay);
        if (!usedSubmit) overlay.querySelector('.overlay-close,button[aria-label="Close"]')?.click();
        const closed = await waitForOverlayCloseOrToast({
            timeout: 15000
        });
        if (context && (context.mode === 'set' || context.mode === 'clear')) {
            try {
                const verified = await verifyVideoOverlayState(context.mode, context.playlists || {});
                return closed && verified;
            } catch {
                return closed;
            }
        }
        return closed;
    }

    function collectPageVideos() {
        const urls = [];
        document.querySelectorAll('a[href*="/v"]').forEach(a => {
            const href = a.getAttribute('href');
            if (!href) return;
            const abs = toAbs(href);
            const p = new URL(abs, location.origin).pathname;
            if (/^\/v[0-9a-z-]+/i.test(p)) urls.push(abs);
        });
        return Array.from(new Set(urls));
    }

    function resolveTargetTile({
        wantedAbs,
        wantedIds,
        wantedPaths
    }) {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const absIndex = new Map(),
            idIndex = new Map(),
            pathIndex = new Map();
        for (const a of anchors) {
            const abs = toAbs(a.href);
            absIndex.set(abs, a);
            const id = getVideoIdFromUrl(abs);
            if (id) idIndex.set(id, a);
            try {
                pathIndex.set(new URL(abs).pathname, a);
            } catch {}
        }
        for (const u of wantedAbs)
            if (absIndex.has(u)) return {
                anchor: absIndex.get(u),
                strategy: 'abs',
                match: u
            };
        for (const id of wantedIds)
            if (idIndex.has(id)) return {
                anchor: idIndex.get(id),
                strategy: 'id',
                match: id
            };
        for (const p of wantedPaths)
            if (pathIndex.has(p)) return {
                anchor: pathIndex.get(p),
                strategy: 'path',
                match: p
            };
        return null;
    }

    chrome.runtime.onMessage.addListener((msg) => {

        if (msg?.type === 'playlistWorkerRun') {
            (async () => {
                const pageUrl = location.href;
                const payload = msg.payload || {};
                let {
                    playlistIds = [], playlistNames = [], videoUrls = []
                } = payload;

                playlistIds = uniq((playlistIds || []).map(String).map(s => s.trim()).filter(Boolean));
                playlistNames = uniq((playlistNames || []).map(s => (s || '').trim()).filter(Boolean));
                bgLog('targets(payload)', {
                    pageUrl,
                    playlistIds,
                    playlistNames,
                    videoUrlsLen: videoUrls.length
                });

                const allAbs = collectPageVideos();
                const targetAbs = videoUrls.map(toAbs);
                const targetIds = targetAbs.map(getVideoIdFromUrl).filter(Boolean);
                const targetPaths = targetAbs.map(u => {
                    try {
                        return new URL(u).pathname;
                    } catch {
                        return u;
                    }
                });

                const match = resolveTargetTile({
                    wantedAbs: targetAbs,
                    wantedIds: targetIds,
                    wantedPaths: targetPaths
                });
                if (!match) {
                    chrome.runtime.sendMessage({
                        type: 'playlistWorkerResult',
                        processed: [],
                        lastProcessed: null,
                        processedThisPage: 0,
                        foundOnPage: false
                    });
                    return;
                }

                const tile = match.anchor;
                const resolvedAbs = toAbs(tile.href);
                bgLog('targetResolve', {
                    strategy: match.strategy,
                    targetUrl: resolvedAbs
                });

                const ov = await openSaveOverlayFromMenu(tile);
                bgLog('openOverlay', ov);
                if (!ov.ok) {
                    chrome.runtime.sendMessage({
                        type: 'playlistWorkerResult',
                        processed: [],
                        lastProcessed: null,
                        processedThisPage: 0,
                        foundOnPage: true,
                        error: ov.reason
                    });
                    return;
                }

                await forceLoadAllPlaylists(ov.overlay);

                if (!playlistIds.length && playlistNames.length) {
                    const resolved = await resolveIdsFromNames(playlistNames);
                    if (resolved.length) {
                        playlistIds = resolved;
                    }
                    bgLog('idResolve(listing)', {
                        fromNames: playlistNames,
                        resolvedIds: playlistIds
                    });
                }

                const ensured = await ensurePlaylistsChecked(ov.overlay, {
                    playlistIds,
                    playlistNames
                });
                bgLog('checkedPlaylists', {
                    ensured
                });

                const confirmed = await confirmAndCloseOverlay(ov.overlay);
                bgLog('overlayConfirmedClosed', {
                    confirmed
                });

                const handled = (ensured.checked.length + ensured.skipped.length) > 0;
                chrome.runtime.sendMessage({
                    type: 'playlistWorkerResult',
                    processed: handled ? [resolvedAbs] : [],
                    lastProcessed: handled ? resolvedAbs : null,
                    processedThisPage: ensured.checked.length,
                    foundOnPage: true,
                    stopNow: true,
                    details: {
                        ...ensured,
                        overlayConfirmed: confirmed
                    }
                });
            })();
        }

        if (msg?.type === 'videoWorkerRun') {
            (async () => {
                const payload = msg.payload || {};
                let {
                    playlistIds = [], playlistNames = [], clearAll = false
                } = payload;

                const namesRaw = uniq((playlistNames || []).map(s => (s || '').trim()).filter(Boolean));
                let ids = uniq((playlistIds || []).map(String).map(s => s.trim()).filter(Boolean));

                if (!ids.length && namesRaw.length) {
                    ids = await resolveIdsFromNames(namesRaw);
                }
                bgLog('playlistTargets(video)', {
                    payloadIds: playlistIds,
                    payloadNames: playlistNames,
                    effectiveIds: ids,
                    namesRaw
                });

                const ov = await openSaveOverlayFromVideoPage();
                bgLog('openOverlay(video)', ov);
                if (!ov.ok) {
                    chrome.runtime.sendMessage({
                        type: 'videoWorkerResult',
                        ok: false,
                        reason: ov.reason
                    });
                    return;
                }

                await ensureSaveListPanel(ov.overlay);
                await forceLoadAllPlaylists(ov.overlay);

                let result, ok;
                if (clearAll) {
                    result = await ensureAllPlaylistsUnchecked(ov.overlay);
                    bgLog('clearedPlaylists(video)', {
                        result
                    });
                    ok = true;
                } else {

                    const ensured = await ensurePlaylistsChecked(ov.overlay, {
                        playlistIds: ids,
                        playlistNames: ids.length ? [] : namesRaw
                    });
                    bgLog('checkedPlaylists(video)', {
                        ensured
                    });
                    result = ensured;
                    ok = (ensured.checked.length + ensured.skipped.length > 0) || (ids.length === 0 && namesRaw.length === 0);
                }

                const confirmed = await confirmAndCloseOverlay(ov.overlay, {
                    mode: clearAll ? 'clear' : 'set',
                    playlists: {
                        playlistIds: ids,
                        playlistNames: ids.length ? [] : namesRaw
                    }
                });
                bgLog('overlayConfirmedClosed(video)', {
                    confirmed
                });

                chrome.runtime.sendMessage({
                    type: 'videoWorkerResult',
                    ok: ok && confirmed,
                    reason: ok ? (confirmed ? null : 'overlay did not confirm/close in time or post-verify failed') : 'no matching playlists found',
                    details: {
                        ...result,
                        overlayConfirmed: confirmed
                    }
                });
            })();
        }
    });

    console.log('playlist-automator worker ready');
})();