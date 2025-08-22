/*!
 * Rumble Live Ops - background.js
 * Version: 4.0.0
 * Description: MV3 service worker that coordinates all background operations for RLO.
 *
 * Core responsibilities
 * ─────────────────────
 * • Offscreen parsing
 * - Creates/closes a single offscreen document (offscreen.html).
 * - Proxies HTML parsing via runtime messages (parse-html → parse-result).
 *
 * • Fetch helpers
 * - fetchPage(): unauthenticated, no-cache text fetch.
 * - fetchPageWithCookies(): authenticated CORS text fetch.
 *
 * • Video harvest
 * - Crawls https://rumble.com/user/{username}?page=N (up to HARVEST_MAX_PAGES).
 * - Parses via offscreen document, de-dupes, persists to storage (userVideos/videos).
 * - Emits: videos-harvest-complete, videosUpdated; sets harvestingVideos flag.
 *
 * • Playlist harvest
 * - Parses /user/{username}/playlists via offscreen; falls back to hidden tab scrape.
 * - Persists to storage (userPlaylists), emits playlistsUpdated; sets harvestingPlaylists flag.
 *
 * • Streamer Mode injection
 * - Detects eligible account pages (profile/verification/recurring-subs/dashboard).
 * - Debounced per-tab enable/disable; re-runs if already present.
 * - Cleans up styles/classes on disable.
 *
 * • Gamify (Dashboard 30-day) injection
 * - Detects /account/dashboard?interval=30.
 * - MAIN world script-tag injector (dashboard-gamify.js) with re-run support.
 * - Cleans up DOM/styling on disable.
 *
 * • Raid targets + ownership guards
 * - Hidden-tab scraping for user page and /following.
 * - Resolves own username from storage or API key.
 * - Detects stream owner in active tab; gates raid commands to owner only.
 * - Shows in-page popup + toast when not owner.
 *
 * • Navigation + tab lifecycle
 * - webNavigation.onCompleted / onHistoryStateUpdated: ensures Streamer/Gamify.
 * - tabs.onUpdated: orchestrates one-shot injections (scrapers, raid, playlist workers).
 * - tabs.onRemoved: cleans pending job registries and last-applied state.
 *
 * • Message bus (chrome.runtime.onMessage)
 * Handles:
 * - getOwnUsername
 * - verifyStreamOwnership (oEmbed ID ↔ API livestream.id)
 * - getHiddenCampaignNames / addHiddenCampaignName / removeHiddenCampaignName / resetHiddenCampaignNames
 * - getApiData (augments livestream with streamUrl/streamId)
 * - getRaidTargets (user page → fallback /following)
 * - harvestVideos / fetchPlaylists (kick off harvesters)
 * - raidButtonPressed (owner-guarded; injects /raid into chat)
 * - playAlertSound (proxy to offscreen)
 * - clearPlaylistsFromVideos (per-video workers with timeout)
 * - broadcastFunctionStates (echo to all *rumble.com* tabs + hide-campaigns toggle)
 * - liveStreamersFromScrape / playlistWorkerLog (telemetry)
 *
 * • Playlist workers
 * - runWorkerInNewTab(url, {playlistIds, playlistNames, clearAll}, timeoutMs)
 * Opens hidden tab, injects playlist-automator.js, returns success/error/timeout.
 * - DirectVideoApplyJob
 * Bulk apply/clear playlists across many video URLs with progress + timeout per video.
 * Emits: playlist-apply-started / playlist-apply-progress / playlist-apply-complete / playlist-apply-error.
 * - processPlaylistQueue()  (legacy single-video updater path)
 *
 * • State & utilities
 * - Per-tab debounce (__rloDebouncePerTab) and last-applied trackers (Streamer/Gamify).
 * - Bulk tab orchestration (playlist automation), hidden-tab lifecycle safety.
 *
 * Emits (selected)
 * - toast, play-sound
 * - videos-harvest-complete, videosUpdated, playlistsUpdated
 * - playlist-apply-started, playlist-apply-progress, playlist-apply-complete, playlist-apply-error
 * - function-states-updated, rlo-hidden-campaigns-updated
 *
 * Key constants/flags
 * - HARVEST_MAX_PAGES, __RLO_DEBUG, __RLO_DEBOUNCE_MS
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/user/TheRealTombi
 * License: MIT
 */


console.log("✅ [RLO] Background Service Worker Loaded:", location.href);

let pendingScrapes = {};
let pendingRaidCommands = {};
let pendingPlaylistScrapes = {};
let playlistScrapeResolvers = {};
let raidTargetResolvers = {};
let playlistUpdateQueue = [];
let isPlaylistUpdaterRunning = false;
let pendingPlaylistUpdates = {};
let isScraping = false;
let isPlaylistScraping = false;
let creatingOffscreenPromise;
const HARVEST_MAX_PAGES = 100;
let currentBulkTabId = null;
let pendingBulkJobs = [];
let bulkScriptInjected = false;
const DEBUG_KEEP_BULK_TAB_OPEN = false;
const __RLO_DEBUG = false;
const __RLO_DEBOUNCE_MS = 450;
const __RLO_LAST_APPLIED = {
    streamer: new Map(),
    gamify: new Map()
};
const __RLO_DEBOUNCE = new Map();

function __rloDebouncePerTab(key, fn, ms = __RLO_DEBOUNCE_MS) {
    const t = __RLO_DEBOUNCE.get(key);
    if (t) clearTimeout(t);
    const id = setTimeout(() => {
        __RLO_DEBOUNCE.delete(key);
        try {
            fn();
        } catch (e) {
            console.warn('❌ [RLO] debounced fn error:', e);
        }
    }, ms);
    __RLO_DEBOUNCE.set(key, id);
}

function __rloSetApplied(tabId, kind, enabled) {
    __RLO_LAST_APPLIED[kind].set(tabId, !!enabled);
}

function __rloGetApplied(tabId, kind) {
    return __RLO_LAST_APPLIED[kind].get(tabId);
}

/* =========================
   OFFSCREEN HELPERS
========================= */
async function hasOffscreenDocument() {
    if ('getOffscreenDocuments' in chrome.runtime) {
        const docs = await chrome.runtime.getOffscreenDocuments();
        return (docs && docs.length > 0);
    }
    return false;
}
async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) return;
    if (creatingOffscreenPromise) {
        await creatingOffscreenPromise;
        return;
    }
    creatingOffscreenPromise = new Promise((resolve) => {
        const listener = (message) => {
            if (message && message.type === 'offscreen-ready') {
                chrome.runtime.onMessage.removeListener(listener);
                creatingOffscreenPromise = null;
                resolve();
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        (async () => {
            try {
                if (await hasOffscreenDocument()) {
                    chrome.runtime.onMessage.removeListener(listener);
                    creatingOffscreenPromise = null;
                    resolve();
                    return;
                }
                await chrome.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.AUDIO_PLAYBACK],
                    justification: 'Parse HTML strings from fetch requests',
                });
            } catch (err) {
                const msg = String(err && err.message ? err.message : err);
                if (!msg.includes('Only a single offscreen document')) {
                    console.error('[Offscreen] createDocument error:', err);
                }
                chrome.runtime.onMessage.removeListener(listener);
                creatingOffscreenPromise = null;
                resolve();
            }
        })();
    });
    await creatingOffscreenPromise;
}
async function closeOffscreenDocument() {
    if (await hasOffscreenDocument() && !isScraping && !isPlaylistScraping) {
        await chrome.offscreen.closeDocument();
    }
}
async function parseHtmlWithOffscreen(html, parseType, page) {
    return new Promise((resolve) => {
        const listener = (message) => {
            if (message && message.type === 'parse-result') {
                chrome.runtime.onMessage.removeListener(listener);
                resolve(message.data);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime.sendMessage({
            type: 'parse-html',
            html,
            parseType,
            page
        });
    });
}

/* =========================
   FETCH HELPERS
========================= */
async function fetchPage(url) {
    try {
        const res = await fetch(url, {
            credentials: 'omit',
            cache: 'no-cache'
        });
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        return await res.text();
    } catch (e) {
        console.error(`❌ [RLO] Error fetching ${url}:`, e);
        return null;
    }
}
async function fetchPageWithCookies(url) {
    try {
        const res = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            mode: 'cors'
        });
        if (!res.ok) throw new Error(`❌ [RLO] Failed to fetch: ${res.status} ${res.statusText}`);
        return await res.text();
    } catch (e) {
        console.error(`❌ [RLO] Error fetching (auth) ${url}:`, e);
        return null;
    }
}

/* =========================
   VIDEO HARVEST
========================= */
async function fetchVideoPage(username, page) {
    const url = `https://rumble.com/user/${encodeURIComponent(username)}?page=${page}`;
    const html = await fetchPage(url);
    if (!html) return [];
    const videos = await parseHtmlWithOffscreen(html, 'videos', page);
    return Array.isArray(videos) ? videos : [];
}

async function runVideoHarvest() {
    if (isScraping) {
        console.warn("A scrape is already in progress. Please wait.");
        return;
    }
    isScraping = true;
    await chrome.storage.local.set({
        harvestingVideos: true
    });

    const all = [];
    try {
        console.log("Step 1: Setting up offscreen document...");
        await setupOffscreenDocument();
        console.log("Step 2: Offscreen document is ready.");

        let {
            rumbleUsername
        } = await chrome.storage.local.get(['rumbleUsername']);
        if (!rumbleUsername) {
            const {
                rumbleApiKey
            } = await chrome.storage.local.get(['rumbleApiKey']);
            if (rumbleApiKey) {
                try {
                    const res = await fetch(rumbleApiKey);
                    if (res.ok) {
                        const j = await res.json();
                        const derived = (j.username || '').replace(/^@/, '').trim();
                        if (derived) {
                            rumbleUsername = derived;
                            await chrome.storage.local.set({
                                rumbleUsername
                            });
                            console.log(`[Videos] Derived username from API: ${rumbleUsername}`);
                        }
                    }
                } catch (e) {
                    console.warn('[Videos] Failed deriving username from API:', e);
                }
            }
        }
        if (!rumbleUsername) {
            console.warn("No username found, stopping harvest.");
            chrome.runtime.sendMessage({
                type: 'toast',
                level: 'error',
                message: 'Add your Rumble username: Options → API & User (save API key).'
            });
            return;
        }
        console.log(`Step 3: Found username: ${rumbleUsername}. Starting fetch loop.`);

        for (let page = 1; page <= HARVEST_MAX_PAGES; page++) {
            console.log(`Fetching page ${page}...`);
            let pageItems = [];
            try {
                pageItems = await fetchVideoPage(rumbleUsername, page);
            } catch (err) {
                console.error(`- Error fetching/parsing page ${page}:`, err);
                break;
            }
            if (!pageItems.length) {
                console.log("- No more videos on this page. Ending harvest.");
                break;
            }
            const seen = new Set(all.map(v => v.url ?? v.id));
            for (const v of pageItems) {
                const key = v.url ?? v.id;
                if (!seen.has(key)) all.push(v);
            }
        }

        console.log(`Step 4: Video harvest loop finished. Total videos: ${all.length}`);
        await chrome.storage.local.set({
            userVideos: all,
            videos: all,
            userVideosLastHarvest: Date.now()
        });
        chrome.runtime.sendMessage({
            type: 'videos-harvest-complete',
            count: all.length,
            videos: all
        });
        chrome.runtime.sendMessage({
            type: 'videosUpdated',
            videos: all
        });
    } catch (err) {
        console.error("An error occurred during video harvest:", err);
    } finally {
        isScraping = false;
        await chrome.storage.local.set({
            harvestingVideos: false
        });
        await closeOffscreenDocument();
        console.log("Harvest process complete.");
    }
}

/* =========================
   PLAYLIST HARVEST
========================= */
async function fetchPlaylistPage(username) {
    const url = `https://rumble.com/user/${encodeURIComponent(username)}/playlists`;
    const html = await fetchPage(url);
    if (!html) return [];
    const items = await parseHtmlWithOffscreen(html, 'playlists', 1);
    return Array.isArray(items) ? items : [];
}

async function scrapePlaylistsViaTab(username) {
    return new Promise((resolve) => {
        chrome.tabs.create({
                url: `https://rumble.com/user/${encodeURIComponent(username)}/playlists`,
                active: false
            },
            (tab) => {
                const id = `pl-${tab.id}`;
                pendingPlaylistScrapes[id] = {
                    tabId: tab.id,
                    scriptInjected: false
                };
                playlistScrapeResolvers[tab.id] = (list) => {
                    try {
                        chrome.tabs.remove(tab.id);
                    } catch {}
                    delete pendingPlaylistScrapes[id];
                    delete playlistScrapeResolvers[tab.id];
                    resolve(Array.isArray(list) ? list : []);
                };
            }
        );
    });
}

async function runPlaylistHarvest() {
    if (isPlaylistScraping) {
        console.warn("A playlist scrape is already in progress. Please wait.");
        return;
    }
    isPlaylistScraping = true;
    await chrome.storage.local.set({
        harvestingPlaylists: true
    });

    try {
        await setupOffscreenDocument();
        let {
            rumbleUsername
        } = await chrome.storage.local.get(['rumbleUsername']);
        if (!rumbleUsername) {
            const {
                rumbleApiKey
            } = await chrome.storage.local.get(['rumbleApiKey']);
            if (rumbleApiKey) {
                try {
                    const res = await fetch(rumbleApiKey);
                    if (res.ok) {
                        const j = await res.json();
                        const derived = (j.username || '').replace(/^@/, '').trim();
                        if (derived) {
                            rumbleUsername = derived;
                            await chrome.storage.local.set({
                                rumbleUsername
                            });
                            console.log(`[Playlists] Derived username from API: ${rumbleUsername}`);
                        }
                    }
                } catch (e) {
                    console.warn('[Playlists] Failed deriving username from API:', e);
                }
            }
        }
        if (!rumbleUsername) {
            console.warn("No username found, stopping playlist harvest.");
            chrome.runtime.sendMessage({
                type: 'toast',
                level: 'error',
                message: 'Add your Rumble username: Options → API & User (save API key).'
            });
            return;
        }

        console.log(`[Playlists] Fetching all playlists for ${rumbleUsername} (offscreen)…`);
        let list = await fetchPlaylistPage(rumbleUsername);

        if (!list || list.length === 0) {
            console.log('[Playlists] Offscreen parser returned 0. Falling back to tab-scrape…');
            list = await scrapePlaylistsViaTab(rumbleUsername);
        }

        console.log(`[Playlists] Done. Total: ${list.length}`);
        await chrome.storage.local.set({
            userPlaylists: list,
            userPlaylistsLastHarvest: Date.now()
        });
        chrome.runtime.sendMessage({
            type: 'playlistsUpdated',
            playlists: list
        });
    } catch (err) {
        console.error("Playlist harvest failed:", err);
    } finally {
        isPlaylistScraping = false;
        await chrome.storage.local.set({
            harvestingPlaylists: false
        });
        await closeOffscreenDocument();
    }
}

/* =========================
   STREAMER MODE HELPERS
========================= */
function isStreamerPage(url) {
    try {
        const u = new URL(url);
        if (u.hostname !== 'rumble.com') return false;
        const p = u.pathname;
        return p === '/account/profile' ||
            p === '/account/verification' ||
            p === '/account/recurring-subs' ||
            p === '/account/dashboard';
    } catch {
        return false;
    }
}

async function pageHasStreamer(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: () => !!window.__RLO_STREAMER_ACTIVE__,
        });
        return !!res?.result;
    } catch {
        return false;
    }
}

async function runStreamer(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: () => {
                try {
                    window.__RLOStreamerRun && window.__RLOStreamerRun();
                } catch (e) {
                    console.warn('[BG→CS] __RLOStreamerRun error:', e);
                }
            }
        });
    } catch {}
}

async function injectStreamerContent(tabId) {
    if (await pageHasStreamer(tabId)) {
        await runStreamer(tabId);
        console.log('[BG] Streamer Mode present; re-ran without reinject.');
        __rloSetApplied(tabId, 'streamer', true);
        return;
    }
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            files: ['streamer-mode.js']
        });
        console.log('[BG] Streamer Mode injected as content script.');
        __rloSetApplied(tabId, 'streamer', true);
    } catch (e) {
        console.warn('[BG] Streamer inject failed:', e?.message || e);
    }
}

async function disableStreamerOnPage(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: () => {
                try {
                    window.RLO_STREAMER_DISABLE && window.RLO_STREAMER_DISABLE();
                } catch {}
                document.getElementById('rlo-streamer-styles')?.remove();
                document.querySelectorAll('.rlo-sm-blur,.rlo-sm-select,.rlo-sm-secure,.rlo-sm-hidden').forEach(n => {
                    n.classList.remove('rlo-sm-blur', 'rlo-sm-select', 'rlo-sm-secure', 'rlo-sm-hidden');
                });
            }
        });
        console.log('[BG] Streamer Mode disabled (content).');
        __rloSetApplied(tabId, 'streamer', false);
    } catch (e) {
        console.warn('[BG] Streamer Mode disable failed:', e?.message || e);
    }
}

async function ensureStreamerForTab(tab) {
    if (!tab?.id || !tab?.url || !isStreamerPage(tab.url)) return;
    const {
        functionStates
    } = await chrome.storage.local.get('functionStates');
    const wantEnabled = !!functionStates?.['enable-streamer-mode'];
    const key = `streamer:${tab.id}`;

    __rloDebouncePerTab(key, async () => {
        const last = __rloGetApplied(tab.id, 'streamer');
        if (last === wantEnabled) {
            if (__RLO_DEBUG) console.log('[BG] Streamer no-op (state unchanged):', tab.id, wantEnabled);
            return;
        }
        if (wantEnabled) {
            await injectStreamerContent(tab.id);
            console.log('[BG] Streamer Mode enabled on:', tab.url);
        } else {
            await disableStreamerOnPage(tab.id);
            console.log('[BG] Streamer Mode disabled on:', tab.url);
        }
    });
}

/* =========================
   TAB-INJECTED HELPERS
========================= */
function injectedPlaylistScraperScript() {
    const playlists = [];
    document.querySelectorAll('div.playlist, .thumbnail--playlist, .listing__item').forEach(el => {
        const titleElement = el.querySelector('h3.thumbnail__title, .listing__title, .thumbnail__title');
        const thumbnailElement = el.querySelector('img.thumbnail__image, img');
        const linkElement = el.querySelector('a[href*="/playlist/"], a.videostream__link, a.thumbnail__link');
        if (titleElement && thumbnailElement && linkElement) {
            const url = linkElement.getAttribute('href') || '';
            const idMatch = url.match(/\/playlist\/([a-zA-Z0-9_-]+)/);
            playlists.push({
                id: idMatch ? idMatch[1] : '',
                title: titleElement.getAttribute('title') || titleElement.textContent.trim(),
                thumbnail: thumbnailElement.src || '',
                url: url.startsWith('http') ? url : `https://rumble.com${url}`
            });
        }
    });
    chrome.runtime.sendMessage({
        type: 'playlistsFromScrape',
        playlists
    });
}

function injectedRaidScript(targetUrl) {

    function waitForElement(selector, maxRetries = 20, delay = 100) {
        return new Promise((resolve, reject) => {
            let retries = 0;
            const check = () => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                } else if (retries < maxRetries) {
                    retries++;
                    setTimeout(check, delay);
                } else {
                    reject(new Error(`Timeout: Could not find element with selector: '${selector}'`));
                }
            };
            check();
        });
    }

    waitForElement('#chat-message-text-input')
        .then(chatInput => {
            const chatForm = chatInput.closest('form');
            if (!chatForm) throw new Error("Could not find chat form.");

            chatInput.focus();
            chatInput.value = `/raid ${targetUrl}`;
            chatInput.dispatchEvent(new Event('input', {
                bubbles: true
            }));

            const submitEvent = new Event('submit', {
                bubbles: true,
                cancelable: true
            });
            chatForm.dispatchEvent(submitEvent);

            return waitForElement('.chat-pinned-ui__raid-container', 50, 100);
        })
        .then(popupContainer => {
            chrome.runtime.sendMessage({
                type: 'raidPopupContent',
                html: popupContainer.innerHTML
            });
        })
        .catch(error => {
            console.error("Raid process failed in hidden tab:", error);
            chrome.runtime.sendMessage({
                type: 'raidProcessFailed'
            });
        });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'clickConfirm') {
            const confirmButton = document.querySelector('[data-js="raid_confirm_confirm_button"]');
            if (confirmButton) {
                confirmButton.click();
                sendResponse({
                    ok: true
                });
            } else {
                sendResponse({
                    ok: false,
                    error: 'confirm-button-not-found'
                });
            }
            return true;
        }
    });
}

function injectedConfirmScript() {
    const confirmButton = document.querySelector('button.btn.btn-xs.btn-green');
    if (confirmButton) confirmButton.click();
    setTimeout(() => chrome.runtime.sendMessage({
        type: 'hiddenTabRaidConfirmed'
    }), 1000);
}

function injectedScrapeScript() {
    const liveStreamers = [];
    const processedUsernames = new Set();

    document.querySelectorAll('.main-menu-item-channel-container').forEach(element => {
        const linkElement = element.querySelector('a.main-menu-item-channel-is-live');
        if (!linkElement) return;

        const username = linkElement.getAttribute('title');
        if (!username || processedUsernames.has(username)) return;

        const avatarEl = element.querySelector('i.user-image');
        const viewersSpan = element.querySelector('[data-live-viewers]');
        const viewers = viewersSpan ? parseInt(viewersSpan.getAttribute('data-live-viewers'), 10) : null;

        if (avatarEl) {
            const style = window.getComputedStyle(avatarEl);
            const bgImage = style.getPropertyValue('background-image');
            const urlMatch = bgImage.match(/url\("?(.+?)"?\)/);
            const avatarUrl = urlMatch ? urlMatch[1] : '';

            liveStreamers.push({
                username: username,
                url: linkElement.getAttribute('href'),
                is_live: true,
                avatarUrl: avatarUrl,
                viewers: Number.isFinite(viewers) ? viewers : undefined
            });
            processedUsernames.add(username);
        }
    });

    document.querySelectorAll('li.followed-channel').forEach(element => {
        if (element.querySelector('.live__tag')) {
            const linkElement = element.querySelector('a.hover\\:no-underline');
            const avatarEl = element.querySelector('i.user-image');
            const nameSpan = element.querySelector('span.line-clamp-2');
            const viewersSpan = element.querySelector('.followed-channel--viewers');

            if (linkElement && avatarEl && nameSpan) {
                const username = nameSpan.textContent.trim();
                if (processedUsernames.has(username)) return;

                const style = window.getComputedStyle(avatarEl);
                const bgImage = style.getPropertyValue('background-image');
                const urlMatch = bgImage.match(/url\("?(.+?)"?\)/);
                const avatarUrl = urlMatch ? urlMatch[1] : '';

                const viewersText = viewersSpan ? viewersSpan.textContent.trim() : '';
                const viewersMatch = viewersText.match(/(\d+)/);
                const viewers = viewersMatch ? parseInt(viewersMatch[1], 10) : null;

                liveStreamers.push({
                    username: username,
                    url: linkElement.getAttribute('href'),
                    is_live: true,
                    avatarUrl: avatarUrl,
                    viewers: viewers
                });
                processedUsernames.add(username);
            }
        }
    });

    chrome.runtime.sendMessage({
        type: 'liveStreamersFromScrape',
        liveStreamers
    });
}

/* =========================
   GAMIFY INJECTORS
========================= */
function isDashboard30(url) {
    try {
        const u = new URL(url);
        return u.hostname === 'rumble.com' &&
            u.pathname === '/account/dashboard' &&
            u.searchParams.get('interval') === '30';
    } catch {
        return false;
    }
}

async function pageHasGamify(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {
                tabId
            },
            world: 'MAIN',
            func: () => !!window.__RLO_GAMIFY_PRESENT__
        });
        return !!(res && res.result);
    } catch {
        return false;
    }
}

async function runGamify(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            world: 'MAIN',
            func: () => {
                try {
                    window.__RLOGamifyRun && window.__RLOGamifyRun();
                } catch (e) {
                    console.warn('[BG→PAGE] __RLOGamifyRun error:', e);
                }
            }
        });
    } catch {}
}

async function injectGamifyByScriptTag(tabId) {
    const src = chrome.runtime.getURL('dashboard-gamify.js');

    if (await pageHasGamify(tabId)) {
        await runGamify(tabId);
        console.log('[BG] Gamify present; re-ran mapping without reinject.');
        __rloSetApplied(tabId, 'gamify', true);
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            world: 'MAIN',
            func: (fileSrc) => {
                try {
                    const LOADER_ID = 'rlo-gamify-loader';
                    if (!document.getElementById(LOADER_ID)) {
                        const tag = document.createElement('script');
                        tag.id = LOADER_ID;
                        tag.src = fileSrc;
                        tag.onload = () => {
                            try {
                                window.__RLOGamifyRun && window.__RLOGamifyRun();
                            } catch {}
                        };
                        (document.head || document.documentElement).appendChild(tag);
                        console.log('[BG→PAGE] Gamify script-tag injected.');
                    } else {
                        try {
                            window.__RLOGamifyRun && window.__RLOGamifyRun();
                        } catch {}
                        console.log('[BG→PAGE] Gamify run requested via existing tag.');
                    }
                } catch (e) {
                    console.warn('[BG→PAGE] Gamify inject error:', e);
                }
            },
            args: [src],
        });
        console.log('[BG] Gamify ensured via script tag.');
        __rloSetApplied(tabId, 'gamify', true);
    } catch (e) {
        console.warn('[BG] Gamify script-tag injection failed:', e?.message || e);
    }
}

async function disableGamifyOnPage(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            world: 'MAIN',
            func: () => {
                try {
                    window.RLO_GAMIFY_DISABLE && window.RLO_GAMIFY_DISABLE();
                } catch {}
                document.querySelectorAll('.content-program-container .rlo-gamify-stars').forEach(n => n.remove());
                document.querySelectorAll('.rlo-gamify-banner').forEach(n => n.remove());
                document.getElementById('rlo-gamify-styles')?.remove();
                document.querySelectorAll('.content-program-container .shadow-progress').forEach(el => {
                    el.style.width = '';
                    el.style.removeProperty('--hours-streamed');
                });
                console.log('[BG→PAGE] Gamify cleaned up.');
            }
        });
        console.log('[BG] Gamify disabled (cleanup script run).');
        __rloSetApplied(tabId, 'gamify', false);
    } catch (e) {
        console.warn('[BG] Gamify disable failed:', e?.message || e);
    }
}

async function ensureGamifyForTab(tab) {
    if (!tab?.id || !tab?.url) return;
    if (!isDashboard30(tab.url)) return;

    const {
        functionStates
    } = await chrome.storage.local.get('functionStates');
    const wantEnabled = functionStates?.['enable-gamify-dashboard'] === true;
    const key = `gamify:${tab.id}`;

    __rloDebouncePerTab(key, async () => {
        const last = __rloGetApplied(tab.id, 'gamify');
        if (last === wantEnabled) {
            if (__RLO_DEBUG) console.log('[BG] Gamify no-op (state unchanged):', tab.id, wantEnabled);
            return;
        }
        if (wantEnabled) {
            await injectGamifyByScriptTag(tab.id);
            console.log('[BG] Gamify enabled on:', tab.url);
        } else {
            await disableGamifyOnPage(tab.id);
            console.log('[BG] Gamify disabled on:', tab.url);
        }
    });
}


/* =========================
   RAID TARGETS (FINAL - CORRECTED)
========================= */
function scrapeRaidTargetsViaTab(url) {
    return new Promise((resolve) => {
        chrome.tabs.create({
            url: url,
            active: false
        }, (tab) => {
            if (!tab || !tab.id) return resolve([]);
            const id = `rt-${tab.id}`;
            pendingScrapes[id] = {
                tabId: tab.id,
                scriptInjected: false
            };
            raidTargetResolvers[tab.id] = (list) => {
                try {
                    chrome.tabs.remove(tab.id);
                } catch {}
                delete pendingScrapes[id];
                delete raidTargetResolvers[tab.id];
                resolve(Array.isArray(list) ? list : []);
            };
        });
    });
}


/* =========================
   RAID OWNERSHIP GUARDS
========================= */
function normalizeHandle(s) {
    return String(s || '').trim().replace(/^@/, '').toLowerCase();
}
async function getOwnUsername() {
    let {
        rumbleUsername
    } = await chrome.storage.local.get(['rumbleUsername']);
    if (rumbleUsername) return normalizeHandle(rumbleUsername);
    const {
        rumbleApiKey
    } = await chrome.storage.local.get(['rumbleApiKey']);
    if (rumbleApiKey) {
        try {
            const res = await fetch(rumbleApiKey);
            if (res.ok) {
                const j = await res.json();
                const derived = (j.username || '').replace(/^@/, '').trim();
                if (derived) {
                    await chrome.storage.local.set({
                        rumbleUsername: derived
                    });
                    return normalizeHandle(derived);
                }
            }
        } catch {}
    }
    return null;
}
// In RumbleLiveOPS v4/background.js

async function detectStreamOwnerInTab(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: () => {
                const norm = s => (s || '').trim().replace(/^@/, '').toLowerCase();

                const selectors = [
                    'h1.channel-title--live a',
                    'a.videostream__channel-name',
                    '.media-by--header-username',
                    'a.channel__name-link',
                    'h3.channel-header--title',
                    'meta[property="og:title"]',
                ];

                let owner = '';
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) {
                        owner = (selector.startsWith('meta')) ? el.content : el.textContent;
                        if (owner) break;
                    }
                }

                return {
                    raw: owner || null,
                    normalized: owner ? norm(owner) : null
                };
            }
        });
        return res?.result || {
            raw: null,
            normalized: null
        };
    } catch (e) {
        console.warn('[Raid] detect owner failed:', e?.message || e);
        return {
            raw: null,
            normalized: null
        };
    }
}

async function isTabOwnedByUser(tabId) {
    const me = await getOwnUsername();
    if (!me) return false;
    const {
        normalized: owner
    } = await detectStreamOwnerInTab(tabId);
    return !!owner && owner === me;
}

async function showNotOwnerPopup(tabId, text = 'Not the Stream Owner') {
    try {
        await chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: (message) => {
                try {
                    let el = document.getElementById('rlo-not-owner-popup');
                    if (!el) {
                        el = document.createElement('div');
                        el.id = 'rlo-not-owner-popup';
                        Object.assign(el.style, {
                            position: 'fixed',
                            top: '20px',
                            right: '20px',
                            zIndex: '2147483647',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            background: 'rgba(17,17,17,0.95)',
                            color: '#fff',
                            boxShadow: '0 8px 30px rgba(0,0,0,.4)',
                            font: '600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
                            pointerEvents: 'none'
                        });
                        document.documentElement.appendChild(el);
                    }
                    el.textContent = message;
                    clearTimeout(window.__rloNotOwnerTimer__);
                    window.__rloNotOwnerTimer__ = setTimeout(() => el.remove(), 2500);
                } catch {
                    alert(message);
                }
            },
            args: [text],
        });
    } catch {}
    try {
        chrome.runtime.sendMessage({
            type: 'toast',
            level: 'error',
            message: text
        });
    } catch {}
}

/* =========================
   NAVIGATION HOOKS
========================= */
chrome.webNavigation.onCompleted.addListener(
    ({
        tabId,
        url
    }) => {
        if (isDashboard30(url)) chrome.tabs.get(tabId, (t) => ensureGamifyForTab(t));
        if (isStreamerPage(url)) chrome.tabs.get(tabId, (t) => ensureStreamerForTab(t));
    }, {
        url: [{
                hostEquals: 'rumble.com',
                pathEquals: '/account/profile'
            },
            {
                hostEquals: 'rumble.com',
                pathEquals: '/account/verification'
            },
            {
                hostEquals: 'rumble.com',
                pathEquals: '/account/recurring-subs'
            },
            {
                hostEquals: 'rumble.com',
                pathEquals: '/account/dashboard'
            },
        ]
    }
);

chrome.webNavigation.onHistoryStateUpdated.addListener(
    ({
        tabId,
        url
    }) => {
        if (isDashboard30(url)) chrome.tabs.get(tabId, (t) => ensureGamifyForTab(t));
        if (isStreamerPage(url)) chrome.tabs.get(tabId, (t) => ensureStreamerForTab(t));
    }, {
        url: [{
            hostEquals: 'rumble.com'
        }]
    }
);

/* =========================
   TABS.onUpdated (incl. legacy flows)
========================= */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    if (isDashboard30(tab.url)) ensureGamifyForTab(tab);
    if (isStreamerPage(tab.url)) ensureStreamerForTab(tab);

    if (tabId === currentBulkTabId && !bulkScriptInjected) {
        bulkScriptInjected = true;
        chrome.scripting.executeScript({
                target: {
                    tabId
                },
                files: ['playlist-automator.js']
            },
            async () => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.error('[bg] executeScript error:', err.message);
                    return;
                }
                try {
                    await chrome.tabs.sendMessage(tabId, {
                        type: 'startBulkPlaylistUpdate',
                        jobs: pendingBulkJobs
                    });
                    console.log(`[bg] Sent startBulkPlaylistUpdate to tab ${tabId} with ${pendingBulkJobs.length} jobs.`);
                } catch {
                    console.warn(`[bg] Failed to start bulk playlist update for tab ${tabId}`);
                }
            }
        );
    }

    const updateJobId = Object.keys(pendingPlaylistUpdates).find(id => pendingPlaylistUpdates[id].tabId === tabId);
    if (updateJobId && !pendingPlaylistUpdates[updateJobId].scriptInjected) {
        pendingPlaylistUpdates[updateJobId].scriptInjected = true;
        chrome.scripting.executeScript({
            target: {
                tabId
            },
            files: ['playlist-automator.js']
        }, () => {
            chrome.tabs.sendMessage(tabId, {
                type: 'startPlaylistUpdate',
                job: pendingPlaylistUpdates[updateJobId].job
            });
        });
        return;
    }

    const pid = Object.keys(pendingPlaylistScrapes).find(k => pendingPlaylistScrapes[k].tabId === tabId);
    if (pid && !pendingPlaylistScrapes[pid].scriptInjected && tab.url.includes('/playlists')) {
        pendingPlaylistScrapes[pid].scriptInjected = true;
        chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: injectedPlaylistScraperScript
        });
        return;
    }

    const findPendingTask = (obj) => Object.keys(obj).find(id => obj[id].tabId === tabId);

    const scrapeId = findPendingTask(pendingScrapes);
    if (scrapeId && !pendingScrapes[scrapeId].scriptInjected) {
        pendingScrapes[scrapeId].scriptInjected = true;
        chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: injectedScrapeScript
        });
        return;
    }

    const raidCommandId = findPendingTask(pendingRaidCommands);
    if (raidCommandId && !pendingRaidCommands[raidCommandId].scriptInjected) {
        pendingRaidCommands[raidCommandId].scriptInjected = true;
        const {
            raidTargetUrl
        } = pendingRaidCommands[raidCommandId];

        chrome.scripting.executeScript({
            target: {
                tabId
            },
            func: injectedRaidScript,
            args: [raidTargetUrl]
        });
        return;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    const cleanup = (obj) => {
        const key = Object.keys(obj).find(k => obj[k].tabId === tabId);
        if (key) delete obj[key];
    };
    cleanup(pendingScrapes);
    cleanup(pendingRaidCommands);
    cleanup(pendingPlaylistUpdates);
    if (playlistScrapeResolvers[tabId]) {
        playlistScrapeResolvers[tabId]([]);
        delete playlistScrapeResolvers[tabId];
    }
    if (raidTargetResolvers[tabId]) {
        try {
            raidTargetResolvers[tabId]([]);
        } catch {}
        delete raidTargetResolvers[tabId];
    }
    if (tabId === currentBulkTabId) {
        currentBulkTabId = null;
        pendingBulkJobs = [];
        bulkScriptInjected = false;
    }

    __RLO_LAST_APPLIED.streamer.delete(tabId);
    __RLO_LAST_APPLIED.gamify.delete(tabId);
});

/* =========================
   RUNTIME MESSAGES
========================= */

function deriveLivestreamLink(ls = {}) {
    const cands = [ls.url, ls.short_url, ls.share_url, ls.permalink];
    for (const u of cands) {
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
            const idMatch = u.match(/\/v([a-zA-Z0-9]+)(?:-|$)/);
            return {
                streamUrl: u,
                streamId: idMatch ? idMatch[1] : null
            };
        }
    }
    const idish = ls.shortcode || ls.hash || ls.slug || ls.id || ls.video_id;
    if (typeof idish === 'string') {
        const m = idish.match(/([a-zA-Z0-9]{5,12})/);
        if (m) {
            const code = m[1];
            return {
                streamUrl: `https://rumble.com/v${code}`,
                streamId: code
            };
        }
    }
    return {
        streamUrl: null,
        streamId: null
    };
}

async function broadcastHideCampaigns(enabled) {
    try {
        const studioTabs = await chrome.tabs.query({
            url: 'https://studio.rumble.com/*'
        });
        await Promise.all(
            studioTabs.map(t =>
                chrome.tabs.sendMessage(t.id, {
                    type: 'rlo-hide-campaigns-toggle',
                    enabled: !!enabled
                }).catch(() => {})
            )
        );
        console.log(`[BG] Sent rlo-hide-campaigns-toggle (${enabled ? 'ON' : 'OFF'}) to ${studioTabs.length} Studio tab(s).`);
    } catch (e) {
        console.warn('[BG] broadcastHideCampaigns failed:', e?.message || e);
    }
}


/* =========================
   RUNTIME MESSAGES (FINAL, UNIFIED)
========================= */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let willRespondAsync = true;
    const broadcastUpdate = async (excludeTabId) => {
        const tabs = await chrome.tabs.query({
            url: "*://studio.rumble.com/*"
        });
        for (const tab of tabs) {
            if (tab.id === excludeTabId) continue;
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'rlo-hidden-campaigns-updated'
                });
            } catch (e) {}
        }
    };

    switch (message?.type) {
        case 'getOwnUsername': {
            (async () => {
                const username = await getOwnUsername();
                sendResponse({
                    username
                });
            })();
            break;
        }

        case 'verifyStreamOwnership': {
            (async () => {
                try {
                    const {
                        oembedUrl
                    } = message.payload || {};
                    if (!oembedUrl) {
                        return sendResponse({
                            isOwner: false,
                            reason: 'No oEmbed URL provided'
                        });
                    }

                    const urlParams = new URLSearchParams(new URL(oembedUrl).search);
                    const videoUrl = urlParams.get('url');

                    if (!videoUrl) {
                        return sendResponse({
                            isOwner: false,
                            reason: 'oEmbed URL does not contain a video URL'
                        });
                    }

                    const pageStreamIdMatch = videoUrl.match(/\/v([a-zA-Z0-9]+)/);
                    const pageStreamId = pageStreamIdMatch ? pageStreamIdMatch[1] : null;

                    if (!pageStreamId) {
                        return sendResponse({
                            isOwner: false,
                            reason: 'Could not parse ID from oEmbed URL'
                        });
                    }

                    const {
                        rumbleApiKey
                    } = await chrome.storage.local.get("rumbleApiKey");
                    if (!rumbleApiKey) {
                        return sendResponse({
                            isOwner: false,
                            reason: 'API Key not found'
                        });
                    }

                    const res = await fetch(rumbleApiKey);
                    if (!res.ok) {
                        return sendResponse({
                            isOwner: false,
                            reason: `API fetch failed with status ${res.status}`
                        });
                    }

                    const apiData = await res.json();
                    const livestream = apiData.livestreams?.[0];
                    const apiStreamId = livestream?.id || null;
                    const isOwner = !!(apiStreamId && apiStreamId === pageStreamId);

                    console.log(`[RLO Ownership Check] Final Comparison -> Page: '${pageStreamId}', API: '${apiStreamId}', Owner: ${isOwner}`);

                    sendResponse({
                        isOwner
                    });

                } catch (e) {
                    console.error('Error verifying stream ownership:', e);
                    sendResponse({
                        isOwner: false,
                        reason: e.message
                    });
                }
            })();
            return true;
        }

        case 'getHiddenCampaignNames': {
            (async () => {
                const {
                    hiddenCampaignNames
                } = await chrome.storage.local.get('hiddenCampaignNames');
                sendResponse({
                    hiddenNames: hiddenCampaignNames || []
                });
            })();
            break;
        }

        case 'addHiddenCampaignName': {
            (async () => {
                const {
                    name
                } = message.payload || {};
                const n = (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (n) {
                    const {
                        hiddenCampaignNames = []
                    } = await chrome.storage.local.get('hiddenCampaignNames');
                    if (!hiddenCampaignNames.includes(n)) {
                        hiddenCampaignNames.push(n);
                        await chrome.storage.local.set({
                            hiddenCampaignNames
                        });
                        await broadcastUpdate(sender.tab.id);
                    }
                }
                sendResponse({
                    ok: true
                });
            })();
            break;
        }
        case 'removeHiddenCampaignName': {
            (async () => {
                const {
                    name
                } = message.payload || {};
                const n = (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (n) {
                    const {
                        hiddenCampaignNames = []
                    } = await chrome.storage.local.get('hiddenCampaignNames');
                    const next = hiddenCampaignNames.filter(x => x !== n);
                    await chrome.storage.local.set({
                        hiddenCampaignNames: next
                    });
                    await broadcastUpdate(sender.tab.id);
                }
                sendResponse({
                    ok: true
                });
            })();
            break;
        }
        case 'resetHiddenCampaignNames':
        case 'rlo-reset-hidden-campaigns': {
            (async () => {
                await chrome.storage.local.set({
                    hiddenCampaignNames: []
                });
                await broadcastUpdate();
                sendResponse({
                    ok: true
                });
            })();
            break;
        }

        case 'getApiData': {
            (async () => {
                try {
                    const {
                        rumbleApiKey
                    } = await chrome.storage.local.get("rumbleApiKey");
                    if (!rumbleApiKey) return void sendResponse({
                        success: false,
                        error: "API Key not found."
                    });
                    const res = await fetch(rumbleApiKey);
                    if (!res.ok) throw new Error(`API responded with status: ${res.status}`);
                    const apiData = await res.json();
                    const ls = Array.isArray(apiData?.livestreams) ? apiData.livestreams[0] : null;
                    if (ls) {
                        const {
                            streamUrl,
                            streamId
                        } = deriveLivestreamLink(ls);
                        ls.streamUrl = streamUrl;
                        ls.streamId = streamId;
                    }
                    sendResponse({
                        success: true,
                        data: apiData
                    });
                } catch (e) {
                    sendResponse({
                        success: false,
                        error: String(e?.message || e)
                    });
                }
            })();
            break;
        }
        case 'getRaidTargets': {
            (async () => {
                try {
                    let {
                        rumbleUsername
                    } = await chrome.storage.local.get('rumbleUsername');
                    if (!rumbleUsername) {
                        const {
                            rumbleApiKey
                        } = await chrome.storage.local.get(['rumbleApiKey']);
                        if (rumbleApiKey) {
                            try {
                                const res = await fetch(rumbleApiKey);
                                if (res.ok) {
                                    const j = await res.json();
                                    const derived = (j.username || '').replace(/^@/, '').trim();
                                    if (derived) {
                                        rumbleUsername = derived;
                                        await chrome.storage.local.set({
                                            rumbleUsername
                                        });
                                    }
                                }
                            } catch (e) {
                                console.warn('[RaidTargets] API key fetch for username failed', e);
                            }
                        }
                    }

                    let targets = [];
                    if (rumbleUsername) {
                        const userPageUrl = `https://rumble.com/user/${encodeURIComponent(rumbleUsername)}`;
                        console.log('[RaidTargets] Scraping user page via hidden tab:', userPageUrl);
                        targets = await scrapeRaidTargetsViaTab(userPageUrl);
                    }

                    if (!targets || targets.length === 0) {
                        console.log('[RaidTargets] User page scrape failed, trying /following...');
                        targets = await scrapeRaidTargetsViaTab('https://rumble.com/following');
                    }

                    sendResponse({
                        success: true,
                        targets
                    });
                } catch (e) {
                    sendResponse({
                        success: false,
                        error: String(e?.message || e)
                    });
                }
            })();
            break;
        }

        case 'harvestVideos': {
            runVideoHarvest();
            try {
                sendResponse({
                    status: 'started'
                });
            } catch {}
            break;
        }
        case 'fetchPlaylists': {
            runPlaylistHarvest();
            try {
                sendResponse({
                    status: 'started'
                });
            } catch {}
            break;
        }
        case 'playAlertSound': {
            chrome.runtime.sendMessage({
                type: 'play-sound',
                src: message.soundSrc
            });
            break;
        }
        case 'playlistWorkerLog': {
            console.log('[Bulk/DBG]', message.where, message.data || {});
            break;
        }

        case 'clearPlaylistsFromVideos': {
            DirectVideoApplyJob.start({
                videoUrls: message.payload?.videoUrls || [],
                clearAll: true,
                perVideoTimeoutMs: 30000
            });
            break;
        }

        case 'rlo-reset-hidden-campaigns': {
            (async () => {
                try {
                    await chrome.storage.local.set({
                        hiddenCampaignNames: []
                    });
                    const tabs = await chrome.tabs.query({
                        url: '*://studio.rumble.com/*'
                    });
                    await Promise.allSettled(
                        tabs.map(t => chrome.tabs.sendMessage(t.id, {
                            type: 'rlo-hidden-campaigns-updated',
                            names: []
                        }))
                    );
                    sendResponse({
                        ok: true
                    });
                } catch (e) {
                    sendResponse({
                        ok: false,
                        error: String(e?.message || e)
                    });
                }
            })();
            break;
        }

        case 'raidButtonPressed': {
            (async () => {
                try {
                    const {
                        targetUrl
                    } = message.payload || {};
                    if (!targetUrl) {
                        return sendResponse({
                            ok: false,
                            error: 'no-target-url'
                        });
                    }

                    const {
                        rumbleApiKey
                    } = await chrome.storage.local.get("rumbleApiKey");
                    if (!rumbleApiKey) {
                        return sendResponse({
                            ok: false,
                            error: 'no-api-key'
                        });
                    }

                    const res = await fetch(rumbleApiKey);
                    if (!res.ok) {
                        return sendResponse({
                            ok: false,
                            error: `API fetch failed: ${res.status}`
                        });
                    }

                    const apiData = await res.json();
                    const livestream = apiData.livestreams?.[0];

                    if (!livestream || !livestream.id) {
                        return sendResponse({
                            ok: false,
                            error: 'no-livestream-found'
                        });
                    }

                    const ownStreamUrl = `https://rumble.com/v${livestream.id}`;
                    const raidCommandId = Date.now().toString();

                    chrome.tabs.create({
                        url: ownStreamUrl,
                        active: false
                    }, (tab) => {
                        if (chrome.runtime.lastError || !tab) {
                            console.error("Error creating hidden tab:", chrome.runtime.lastError);
                            return;
                        }

                        pendingRaidCommands[raidCommandId] = {
                            tabId: tab.id,
                            originalTabId: sender.tab.id,
                            raidTargetUrl: targetUrl,
                            scriptInjected: false
                        };
                    });

                    sendResponse({
                        ok: true
                    });

                } catch (e) {
                    console.error('Error in raidButtonPressed:', e);
                    sendResponse({
                        ok: false,
                        error: String(e.message || e)
                    });
                }
            })();
            break;
        }

        case 'raidPopupContent': {
            (async () => {
                const {
                    html
                } = message;
                const raidCommandId = Object.keys(pendingRaidCommands).find(id => pendingRaidCommands[id].tabId === sender.tab.id);

                if (raidCommandId) {
                    const {
                        originalTabId
                    } = pendingRaidCommands[raidCommandId];
                    try {
                        await chrome.tabs.sendMessage(originalTabId, {
                            type: 'showRaidConfirmation',
                            payload: {
                                html: html,
                                raidCommandId: raidCommandId
                            }
                        });
                        sendResponse({
                            ok: true
                        });
                    } catch (e) {
                        console.error("Error sending message to original tab:", e);
                        sendResponse({
                            ok: false,
                            error: e.message
                        });
                    }
                } else {
                    sendResponse({
                        ok: false,
                        error: 'raid-command-not-found'
                    });
                }
            })();
            break;
        }

        case 'confirmRaid': {
            (async () => {
                const {
                    raidCommandId
                } = message.payload;
                const command = pendingRaidCommands[raidCommandId];

                if (!command || !command.tabId) {
                    return sendResponse({
                        ok: false,
                        error: 'raid-command-not-found'
                    });
                }

                try {

                    await chrome.tabs.sendMessage(command.tabId, {
                        type: 'clickConfirm'
                    });
                    sendResponse({
                        ok: true
                    });

                    setTimeout(() => {
                        try {
                            chrome.tabs.remove(command.tabId);
                            delete pendingRaidCommands[raidCommandId];
                        } catch (e) {
                        }
                    }, 1500);

                } catch (e) {
                    sendResponse({
                        ok: false,
                        error: e.message
                    });
                }
            })();
            return true;
        }

        case 'cancelRaid': {
            (async () => {
                const {
                    raidCommandId
                } = message.payload;
                const command = pendingRaidCommands[raidCommandId];

                if (!command || !command.tabId) {
                    return sendResponse({
                        ok: false,
                        error: 'raid-command-not-found'
                    });
                }

                try {
                    await chrome.tabs.remove(command.tabId);
                    delete pendingRaidCommands[raidCommandId];
                    sendResponse({
                        ok: true
                    });
                } catch (e) {
                    delete pendingRaidCommands[raidCommandId];
                    sendResponse({
                        ok: false,
                        error: e.message
                    });
                }
            })();
            return true;
        }




        case 'liveStreamersFromScrape': {
            const resolver = raidTargetResolvers[sender.tab.id];
            if (resolver) {
                resolver(message.liveStreamers);
            }
            break;
        }

        case 'broadcastFunctionStates': {
            (async () => {
                try {
                    const {
                        functionStates
                    } = await chrome.storage.local.get('functionStates');
                    const tabs = await chrome.tabs.query({
                        url: '*://*.rumble.com/*'
                    });
                    await Promise.all(
                        tabs.map(t => chrome.tabs
                            .sendMessage(t.id, {
                                type: 'function-states-updated',
                                functionStates: functionStates || {}
                            })
                            .catch(() => {}))
                    );
                    await broadcastHideCampaigns(!!functionStates?.['enable-hide-campaigns']);
                    console.log(`[BG] (Immediate) broadcasted function-states to ${tabs.length} tab(s).`);
                    sendResponse({
                        ok: true,
                        tabs: tabs.length
                    });
                } catch (e) {
                    sendResponse({
                        ok: false,
                        error: String(e?.message || e)
                    });
                }
            })();
            break;
        }

        default: {
            willRespondAsync = false;
        }
    }
    return willRespondAsync;
});

/* =========================
   HELPER: run worker in a fresh hidden tab
========================= */
async function runWorkerInNewTab(videoUrl, {
    playlistIds = [],
    playlistNames = [],
    clearAll = false
} = {}, timeoutMs = 30000) {
    return new Promise((resolve) => {
        chrome.tabs.create({
            url: videoUrl,
            active: false
        }, (tab) => {
            if (!tab || !tab.id) return resolve({
                status: 'error',
                error: 'failed to create tab'
            });

            let timeoutHandle = null;
            const onMessage = (msg, sender) => {
                if (!sender.tab || sender.tab.id !== tab.id) return;
                if (msg.type === 'videoWorkerResult') {
                    cleanup();
                    resolve({
                        status: msg.ok ? 'success' : 'error',
                        reason: msg.reason || null,
                        details: msg.details || null
                    });
                }
            };
            const cleanup = () => {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                chrome.runtime.onMessage.removeListener(onMessage);
                try {
                    chrome.tabs.remove(tab.id);
                } catch {}
            };

            chrome.runtime.onMessage.addListener(onMessage);

            timeoutHandle = setTimeout(() => {
                cleanup();
                resolve({
                    status: 'timeout'
                });
            }, timeoutMs);

            chrome.tabs.onUpdated.addListener(function onUpdated(tabId, changeInfo) {
                if (tabId !== tab.id || changeInfo.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(onUpdated);
                chrome.scripting.executeScript({
                    target: {
                        tabId: tab.id
                    },
                    files: ['playlist-automator.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        cleanup();
                        resolve({
                            status: 'error',
                            error: chrome.runtime.lastError.message
                        });
                        return;
                    }
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'videoWorkerRun',
                        payload: {
                            playlistIds,
                            playlistNames,
                            clearAll
                        }
                    });
                });
            });
        });
    });
}

/* =========================
   DIRECT VIDEO APPLY JOB
========================= */
const DirectVideoApplyJob = (() => {
    let job = null;

    function toAbs(u) {
        try {
            return new URL(u, 'https://rumble.com').toString();
        } catch {
            return u;
        }
    }

    function stripParams(u) {
        try {
            const x = new URL(u);
            x.search = '';
            x.hash = '';
            return x.toString().replace(/\/+$/, '');
        } catch {
            return (u || '').replace(/\/+$/, '');
        }
    }

    function cleanup() {
        if (!job) return;
        try {
            if (!job.debugKeepTab && job.tabId) chrome.tabs.remove(job.tabId);
        } catch {}
        chrome.tabs.onUpdated.removeListener(onUpdated);
        if (job.onWorkerMsg) chrome.runtime.onMessage.removeListener(job.onWorkerMsg);
        if (job.videoTimer) clearTimeout(job.videoTimer);
        job = null;
    }

    function sendProgress(note) {
        chrome.runtime.sendMessage({
            type: 'playlist-apply-progress',
            done: job.done,
            total: job.total,
            currentVideoUrl: job.currentUrl || null,
            page: null,
            processedThisPage: 1,
            note
        });
    }

    function next() {
        if (!job) return;
        if (job.videoTimer) {
            clearTimeout(job.videoTimer);
            job.videoTimer = null;
        }

        if (job.queue.length === 0) {
            chrome.runtime.sendMessage({
                type: 'playlist-apply-complete',
                successCount: job.done,
                total: job.total,
                note: 'All videos processed.'
            });
            cleanup();
            return;
        }

        job.currentUrl = job.queue.shift();
        chrome.tabs.update(job.tabId, {
            url: job.currentUrl,
            active: false
        });
    }

    function onUpdated(tabId, changeInfo, tab) {
        if (!job || tabId !== job.tabId) return;
        if (changeInfo.status !== 'complete') return;

        chrome.scripting.executeScript({
            target: {
                tabId
            },
            files: ['playlist-automator.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[Direct] inject failed:', chrome.runtime.lastError.message);
                job.done += 1;
                sendProgress('Inject failed; skipping.');
                next();
                return;
            }

            job.videoTimer = setTimeout(() => {
                job.done += 1;
                sendProgress('Timeout; skipping.');
                next();
            }, job.perVideoTimeoutMs);

            chrome.tabs.sendMessage(tabId, {
                type: 'videoWorkerRun',
                payload: {
                    playlistIds: job.playlistIds,
                    playlistNames: job.playlistNames,
                    clearAll: !!job.clearAll
                }
            });
        });
    }

    function start(payload) {
        if (job) cleanup();

        const {
            playlistIds = [],
                playlistNames = [],
                videoUrls = [],
                debugKeepTab = false,
                clearAll = false,
                perVideoTimeoutMs = 30000
        } = payload || {};

        const abs = videoUrls.map(toAbs).map(stripParams);
        const unique = Array.from(new Set(abs));
        if (!unique.length || (!clearAll && !playlistIds.length && !playlistNames.length)) {
            chrome.runtime.sendMessage({
                type: 'playlist-apply-error',
                message: 'Missing videos or playlists.'
            });
            return;
        }

        job = {
            playlistIds,
            playlistNames,
            clearAll,
            perVideoTimeoutMs,
            queue: unique.slice(),
            total: unique.length,
            done: 0,
            currentUrl: null,
            tabId: null,
            debugKeepTab,
            videoTimer: null,
            onWorkerMsg: null
        };

        chrome.runtime.sendMessage({
            type: 'playlist-apply-started',
            total: job.total,
            mode: job.clearAll ? 'clear' : 'set'
        });

        chrome.tabs.create({
            url: unique[0],
            active: false
        }, (tab) => {
            if (!tab || !tab.id) {
                chrome.runtime.sendMessage({
                    type: 'playlist-apply-complete',
                    successCount: 0,
                    total: job.total,
                    note: 'Failed to create hidden tab.'
                });
                cleanup();
                return;
            }

            job.tabId = tab.id;
            chrome.tabs.onUpdated.addListener(onUpdated);

            job.onWorkerMsg = function handler(msg, sender) {
                if (!job) return;
                if (!(sender.tab && sender.tab.id === job.tabId)) return;
                if (msg.type === 'videoWorkerResult') {
                    if (job.videoTimer) {
                        clearTimeout(job.videoTimer);
                        job.videoTimer = null;
                    }
                    job.done += 1;
                    sendProgress(msg.ok ? (job.clearAll ? 'Cleared' : 'Updated') : ('Skipped: ' + (msg.reason || 'unknown')));
                    next();
                }
            };
            chrome.runtime.onMessage.addListener(job.onWorkerMsg);

            job.currentUrl = job.queue.shift();
        });
    }

    return {
        start
    };
})();

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'applyPlaylistsToVideos') {
        DirectVideoApplyJob.start(msg.payload || {});
    }
});

/* =========================
   (legacy) SINGLE-VIDEO PLAYLIST UPDATER
========================= */
async function processPlaylistQueue() {
    if (isPlaylistUpdaterRunning || playlistUpdateQueue.length === 0) return;
    isPlaylistUpdaterRunning = true;
    const job = playlistUpdateQueue.shift();
    console.log(`✅ [BG] Processing playlist update for video ID: ${job.videoId}`);
    const tab = await chrome.tabs.create({
        url: `https://rumble.com${job.videoUrl}`,
        active: false
    });
    pendingPlaylistUpdates[job.videoId] = {
        tabId: tab.id,
        job: job
    };
}

/* =========================
   FEATURE TOGGLES: Live update + Broadcast
========================= */
chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.functionStates) return;
    const newVals = changes.functionStates.newValue || {};

    try {
        const allTabs = await chrome.tabs.query({
            url: 'https://rumble.com/*'
        });
        for (const t of allTabs) {
            if (isStreamerPage(t.url)) ensureStreamerForTab(t);
            if (isDashboard30(t.url)) ensureGamifyForTab(t);
        }
    } catch {

    }

    try {
        const tabs = await chrome.tabs.query({
            url: '*://*.rumble.com/*'
        });
        await Promise.all(
            tabs.map(t => chrome.tabs
                .sendMessage(t.id, {
                    type: 'function-states-updated',
                    functionStates: newVals
                })
                .catch(() => {}))
        );
        console.log(`✅ [BG] Broadcasted function-states to ${tabs.length} tab(s).`);
    } catch {}

    try {
        const prev = changes.functionStates.oldValue || {};
        if (prev['enable-hide-campaigns'] !== newVals['enable-hide-campaigns']) {
            await broadcastHideCampaigns(!!newVals['enable-hide-campaigns']);
        }
    } catch {}
});