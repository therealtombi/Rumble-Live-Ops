/*!
 * Rumble Live Ops - offscreen.js
 * Version: v4.0.0
 * Description: Runs inside the offscreen document. Provides isolated DOM parsing
 *              for HTML fetched by the background service worker.
 *
 * Core responsibilities
 * ─────────────────────
 * • Lifecycle
 *   - Logs startup and immediately signals {type:'offscreen-ready'} to background.
 *
 * • Helpers
 *   - toAbs(href) → normalize relative → absolute Rumble URLs.
 *   - text(el) → trimmed textContent.
 *   - attr(el, name) → safe getAttribute.
 *   - firstTruthy(...vals) → first non-empty string.
 *   - imgSrc(imgEl) → chooses best candidate src (src/data-src/data-original/etc).
 *
 * • Parsers
 *   - parseVideos(doc)
 *       Extracts video id/title/url/thumbnail from .videostream entries.
 *   - parsePlaylists(doc)
 *       Extracts playlist id/title/url/thumbnail from multiple playlist layouts.
 *       Supports /playlist/ and /playlists/ URLs.
 *   - parseRaidTargets(doc)
 *       Extracts live usernames, URLs, avatar (CSS background-image), and viewer count
 *       from channel containers in main menu.
 *
 * • Message handling
 *   - Listens for {type:'parse-html', html, parseType}.
 *   - Creates a detached DOM via DOMParser.
 *   - Routes parseType → corresponding parser.
 *   - Responds with {type:'parse-result', data:[…]} back to background.
 *   - Safe fallback to [] if parsing fails.
 *
 * Communication
 * ─────────────
 * - Input:   {type:'parse-html', html, parseType:'videos'|'playlists'|'raidTargets'}
 * - Output:  {type:'parse-result', data:Array}
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */


console.log("✅ [RLO] Offscreen script running. Sending 'offscreen-ready' signal on:", location.href);
chrome.runtime.sendMessage({
    type: 'offscreen-ready'
});

/* =========================
   Helpers
========================= */
const RUMBLE_ORIGIN = 'https://rumble.com';

function toAbs(href) {
    if (!href) return RUMBLE_ORIGIN + '/';
    try {
        return new URL(href, RUMBLE_ORIGIN).toString();
    } catch {
        return (href.startsWith('/') ? RUMBLE_ORIGIN : RUMBLE_ORIGIN + '/') + href.replace(/^\/+/, '');
    }
}

function text(el) {
    return (el?.textContent || '').trim();
}

function attr(el, name) {
    return el?.getAttribute?.(name) || '';
}

function firstTruthy(...vals) {
    return vals.find(v => !!v) || '';
}

function imgSrc(imgEl) {
    return firstTruthy(
        attr(imgEl, 'src'),
        attr(imgEl, 'data-src'),
        attr(imgEl, 'data-original'),
        attr(imgEl, 'data-lazy-src')
    );
}

/* =========================
   Parsers
========================= */
function parseVideos(doc) {
    const out = [];
    const items = doc.querySelectorAll('.videostream');
    items.forEach(item => {
        const id = item.dataset?.videoId || attr(item, 'data-video-id') || '';
        const titleEl = item.querySelector('.thumbnail__title');
        const linkEl = item.querySelector('.videostream__link, a[href^="/v"]');
        const thumbEl = item.querySelector('img.thumbnail__image, .thumbnail__thumb img');
        if (!linkEl || !titleEl || !thumbEl) return;

        out.push({
            id,
            title: text(titleEl),
            url: toAbs(attr(linkEl, 'href')),
            thumbnail: imgSrc(thumbEl)
        });
    });
    return out;
}

function parsePlaylists(doc) {
    const out = [];
    const items = doc.querySelectorAll(
        'div.playlist, .thumbnail--playlist, .listing__item'
    );

    const getIdFromHref = (href) => {
        const abs = toAbs(href || '');
        try {
            const u = new URL(abs);
            let m = u.pathname.match(/\/playlist\/([^/]+)/i);
            if (m) return m[1];
            m = u.pathname.match(/\/playlists\/([^/]+)/i);
            if (m) return m[1];
            return '';
        } catch {
            const m = (href || '').match(/\/playlists?\/([^/?#]+)/i);
            return m ? m[1] : '';
        }
    };

    items.forEach(el => {
        const linkEl =
            el.querySelector('a.videostream__link[href*="/playlist"]') ||
            el.querySelector('a.videostream__link[href*="/playlists"]') ||
            el.querySelector('.playlist__footer a.playlist__name[href*="/playlist"]') ||
            el.querySelector('.playlist__footer a.playlist__name[href*="/playlists"]') ||
            el.querySelector('a[href*="/playlist/"], a[href*="/playlists/"]');
        if (!linkEl) return;

        const titleEl =
            el.querySelector('.playlist__footer h3.thumbnail__title') ||
            el.querySelector('h3.thumbnail__title, .listing__title, .thumbnail__title') ||
            el.querySelector('.playlist__name');

        const thumbEl =
            el.querySelector('.thumbnail__thumb img.thumbnail__image') ||
            el.querySelector('img.thumbnail__image') ||
            el.querySelector('img');

        if (!titleEl || !thumbEl) return;

        const href = attr(linkEl, 'href');
        const url = toAbs(href);
        const id = getIdFromHref(href);
        const title = (attr(titleEl, 'title') || text(titleEl) || 'Untitled').trim();

        out.push({
            id,
            title,
            thumbnail: imgSrc(thumbEl),
            url
        });
    });

    return out;
}

function parseRaidTargets(doc) {
    const out = [];
    const items = doc.querySelectorAll('.main-menu-item-channel-container');

    items.forEach(item => {
        const linkEl = item.querySelector('a.main-menu-item-channel-is-live');
        if (!linkEl) return;

        const username = attr(linkEl, 'title');
        const url = toAbs(attr(linkEl, 'href'));
        const avatarEl = item.querySelector('i.user-image');
        const avatarClass = attr(avatarEl, 'class');
        const avatarStyleAttr = attr(avatarEl, 'style');

        const bgImageMatch = avatarStyleAttr.match(/background-image:\s*url\((['"]?)(.*?)\1\)/);
        const avatarUrl = bgImageMatch ? bgImageMatch[2] : '';

        const liveWrapper = item.querySelector('.main-menu-item-channel-live-wrapper');
        const viewersAttr = liveWrapper ? attr(liveWrapper, 'data-live-viewers') : null;
        const viewers = viewersAttr ? parseInt(viewersAttr, 10) : null;

        if (username && url) {
            out.push({
                username,
                url,
                is_live: true,
                avatarClass: avatarClass || 'user-image',
                avatarUrl: avatarUrl,
                viewers: Number.isFinite(viewers) ? viewers : undefined
            });
        }
    });

    return out;
}

/* =========================
   Message Handler
========================= */
chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'parse-html') return;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(message.html || '', 'text/html');

        let parsedData = [];
        switch (message.parseType) {
            case 'videos':
                parsedData = parseVideos(doc);
                break;
            case 'playlists':
                parsedData = parsePlaylists(doc);
                break;
            case 'raidTargets':
                parsedData = parseRaidTargets(doc);
                break;
            default:
                parsedData = [];
        }

        chrome.runtime.sendMessage({
            type: 'parse-result',
            data: parsedData
        });
    } catch (e) {
        console.error('Offscreen parse error:', e);
        chrome.runtime.sendMessage({
            type: 'parse-result',
            data: []
        });
    }
});