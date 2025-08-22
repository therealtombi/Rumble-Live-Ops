/*!
 * Rumble Live Ops - content.js
 * Version: v4.0.0
 * Description: Content-side injector and UI manager for RLO.
 *              Runs in the page context (top/frames) and manages injected
 *              buttons, overlays, chat styling, and campaign-hiding logic.
 *
 * Core responsibilities
 * ─────────────────────
 * • Guards & messaging
 *   - Detects page type (studio/live/campaigns).
 *   - bgMessage(): safe wrapper for runtime messaging with timeout.
 *
 * • Base styles
 *   - injectBaseStyles(): injects core CSS for raid button, center modal, clip button, faux chat, etc.
 *   - Uses data-rlo-page="studio|live" to tailor styling.
 *
 * • Popups & modals
 *   - showCenterPopup()/closeCenterPopup(): reusable center-screen modal with title, subtitle, rows, actions.
 *   - Used for raid target lists, cooldown messages, error states, etc.
 *
 * • Faux chat
 *   - injectSimulatedMessage(): inserts fake “RAID”/“RANT” messages into chat UI for demo/testing.
 *   - renderFauxRow()/findChatHostForSimulation(): fallback inline styles ensure visibility everywhere.
 *
 * • Chat enhancements
 *   - rloStyleRowAsYT2(): reflows chat list items into timestamped grid (YT-style).
 *   - rloObserveChatAsYT2(): mutation observer for new messages.
 *   - rloObserveChatTimestamps(): adds HH:MM:SS stamps to each message.
 *   - disableChatEnhancements()/revertRowStyleFromYT2(): cleanup/restore originals.
 *
 * • Clip button
 *   - ensureClipButton()/removeClipButton(): adds 🎬 Clip button to chat send row.
 *   - onClipClick(): auto-sends "!clip" into chat with 30s cooldown + popup feedback.
 *
 * • Sounds
 *   - playDefaultSound(kind): plays stored RAID/RANT sound selections from chrome.storage.
 *
 * • Campaign hiding
 *   - Persistent per-name hide across Campaigns table & Passthrough cards.
 *   - Storage helpers: getHiddenNames(), addHiddenName(), removeHiddenName(), resetHiddenNames().
 *   - DOM mappers: findCampaignRows(), findCampaignCards() → ensure hide controls → applyCampaignHides().
 *   - Observers: manageCampaignsTable(), manageAdReads() for dynamic reapply.
 *
 * • Raid button & logic
 *   - ensureRaidButton()/insertRaidButton()/removeRaidButton(): manages 🚀 Rumble Raid button injection.
 *   - setRaidButtonBusy(): spinner feedback during API calls.
 *   - onRaidClickHandler():
 *       - Checks ownership (isCurrentPageOwned).
 *       - Validates live status / scheduled_on → shows ETA or flashes “Start Stream” button.
 *       - Fetches raid targets via bgMessage('getRaidTargets') → shows selection popup.
 *
 * • Feature toggles
 *   - Function states (enable-raid-button-live, enable-followers-live, enable-chat-styling, etc.)
 *     are loaded from chrome.storage.local.
 *   - applySettingsDiff(): applies enable/disable transitions live (inserting/removing buttons, observers).
 *
 * • Miscellaneous
 *   - insertFollowerButton()/insertGiftedSubsButton(): adds follower + gifted subs UI with live data.
 *   - flashStartStreamIfPresent(): pulses “Start Stream” button in Studio when not yet live.
 *   - computeEta(): human-readable countdown from scheduled_on.
 *   - initializeOwnerFeatures(): stubbed init for Studio ownership features.
 *
 * • Messaging (content listener)
 *   - rlo-ping → responds with ok + href.
 *   - rlo-test-raid / rlo-test-rant → injects simulated messages + plays sounds.
 *   - rlo-show-demo-popup → shows arbitrary popup for testing.
 *   - rlo-hidden-campaigns-updated → triggers reload.
 *   - rlo-reset-hidden-campaigns → clears hidden names via background + reload.
 *
 * • Bootstrap
 *   - Loads functionStates from storage.
 *   - Injects base styles, applies toggles (raid/followers/gifted/chat/clips/hiding).
 *   - Sets up tryApply() loop (interval + event listeners) to maintain UI in dynamic SPAs.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

console.log("✅ [RLO] content.js injected on:", location.href);

/* =========================
   Guards & Utils
========================= */
const IS_TOP = (() => {
    try {
        return window.top === window.self;
    } catch {
        return false;
    }
})();

function isStudioPage() {
    const u = location.pathname;
    return u.includes('/studio/') || u.includes('/room/');
}

function isLiveStreamPage() {
    return /^\/v/i.test(location.pathname);
}

function isCampaignsListPage() {
    return location.hostname.startsWith('studio.') && location.pathname === '/campaigns';
}

function isStudioPassthroughPage() {
    return location.hostname.startsWith('studio.') && /\/studio\/passthrough\//.test(location.pathname);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

let __rloChatObs, __rloYtObs2;

function bgMessage(type, payload = {}, timeoutMs = 5000) {
    console.log("✅ [RLO] bgMessage →", type, payload);
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            console.warn("✅ [RLO] bgMessage timeout:", type);
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
            console.log("✅ [RLO] bgMessage ←", type, res);
            resolve(res);
        });
    });
}

/* =========================
   Base styles (UPDATED)
========================= */
function injectBaseStyles() {
    if (document.getElementById('rlo-base-styles')) return;
    try {
        const host = (location.hostname || '').toLowerCase();
        const pageKind =
            host.includes('studio.rumble.com') ? 'studio' :
            (host === 'rumble.com' || host.endsWith('.rumble.com')) ? 'live' :
            'other';
        document.documentElement.setAttribute('data-rlo-page', pageKind);
    } catch {}
    const css = `
       #raid-button,#raid-button *{color:#fff!important} #raid-button{ display:inline-flex;align-items:center;justify-content:center;gap:.571429rem; height:2.6rem;padding:.75rem;border-radius:9999px;background:rgb(var(--color-indigo,27 33 39)); font-weight:700;font-size:14px;white-space:nowrap;margin:0!important;min-width:0;width:fit-content; flex:none;box-sizing:border-box;max-width:100%; align-self:center;vertical-align:middle; } .header-user-actions button#raid-button, .flex.items-center.space-x-2.flex-wrap.justify-end button#raid-button, .shrink-0.flex.items-center.space-x-2 button#raid-button{margin-left:10px} .rlo-spinner{width:1em;height:1em;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rlo-spin .8s linear infinite;display:inline-block;vertical-align:middle;margin-left:.5rem} @keyframes rlo-spin{to{transform:rotate(360deg)}} #rlo-center-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;display:flex;align-items:center;justify-content:center} #rlo-center-modal{width:min(560px,92vw);max-height:min(80vh,720px);overflow:auto;background:rgba(12,17,22,.98);border:1px solid #2a3440;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.5);color:#fff;padding:18px;font:500 14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif} #rlo-center-modal h3{margin:0 0 10px;font-size:16px;line-height:1.2;font-weight:800} #rlo-center-modal .rlo-subtle{color:#9bb4d3;font-weight:600;margin-top:4px} #rlo-center-modal .rlo-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);margin-top:8px} #rlo-center-modal .rlo-live-dot{width:10px;height:10px;border-radius:50%;background:#f23160;margin-right:6px} #rlo-center-modal .rlo-col{display:flex;align-items:center;gap:8px;min-width:0} #rlo-center-modal .rlo-username{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #rlo-center-modal .rlo-viewers{opacity:.9;font-weight:700} #rlo-center-modal .rlo-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end} #rlo-center-modal button{appearance:button;border:0;border-radius:999px;cursor:pointer;font-weight:800;color:#0c1116;padding:10px 14px;background:#9bb4d3} #rlo-center-modal button.rlo-primary{background:rgb(var(--brand-500-rgb,133 199 66));color:#000} #rlo-center-modal button.rlo-ghost{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15)} @keyframes rlo-flash{0%,100%{box-shadow:0 0 0 0 rgba(133,199,66,.8)}50%{box-shadow:0 0 0 8px rgba(133,199,66,0)}} .rlo-flash{animation:rlo-flash 1.2s ease-out 4;outline:2px solid rgba(133,199,66,.8);outline-offset:2px} .rlo-faux-chat-row{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px;line-height:1.35} .rlo-faux-badge{display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 .5rem;border-radius:9999px;font-weight:700;background:rgba(110,92,224,.25);border:1px solid rgba(110,92,224,.45)} .rlo-faux-user{font-weight:700}.rlo-faux-text{opacity:.95} :root[data-rlo-page="studio"] body #raid-button{ height: 48px !important; min-height: 48px !important; min-width: 48px !important; line-height: 1 !important; padding: 0 1rem !important; gap: .4rem !important; border-radius: 9999px !important; } :root[data-rlo-page="studio"] .header-user-actions button#raid-button, :root[data-rlo-page="studio"] .flex.items-center.space-x-2.flex-wrap.justify-end button#raid-button, :root[data-rlo-page="studio"] .shrink-0.flex.items-center.space-x-2 button#raid-button{ margin-left: 12px !important; } :root[data-rlo-page="studio"] body #raid-button:hover{ filter: brightness(1.16); } :root[data-rlo-page="live"] body #raid-button{ height: 2.6rem !important; min-height: 2.6rem !important; line-height: 1 !important; padding: 0 .75rem !important; gap: .5rem !important; border-radius: 9999px !important; } :root[data-rlo-page="live"] .header-user-actions button#raid-button, :root[data-rlo-page="live"] .flex.items-center.space-x-2.flex-wrap.justify-end button#raid-button, :root[data-rlo-page="live"] .shrink-0.flex.items-center.space-x-2 button#raid-button{ margin-left: 10px !important; } :root[data-rlo-page="live"] body #raid-button:hover{ filter: brightness(1.08); } #rlo-center-modal.rlo-compact{ width: min(420px, 92vw); max-height: none; padding: 14px 16px; } #rlo-center-modal.rlo-compact h3{ margin-bottom: 6px; } #rlo-center-modal.rlo-compact .rlo-subtle{ margin-top: 2px; } #rlo-center-modal.rlo-compact #rlo-center-body:empty{ display: none; } #rlo-clip-btn, #rlo-clip-btn * { color: #fff; } #rlo-clip-btn { display: inline-flex; align-items: center; justify-content: center; height: 2.6rem; min-height: 2.6rem; padding: .35rem .75rem; gap: .5rem; border-radius: 9999px; cursor: pointer; background: rgb(var(--color-indigo, 27 33 39)); border: 1px solid rgba(255,255,255,.08); font-weight: 800; font-size: 14px; white-space: nowrap; box-sizing: border-box; flex: 0 0 auto; margin-left: .5rem; } #rlo-clip-btn:hover { filter: brightness(1.08); } #rlo-clip-btn[aria-busy="true"] { opacity:.7; pointer-events:none; } li.js-chat-history-item.rlo-yt2 { display: grid !important; grid-template-columns: auto 1fr auto; grid-template-areas: "rlo-ava rlo-head rlo-ts" "rlo-msg rlo-msg rlo-msg"; column-gap: 8px; row-gap: 2px; align-items: center; padding: 4px 0; margin-left: 6px; } .rlo-yt2 .rlo-yt-ava { grid-area: rlo-ava; display: flex; align-items: center; gap: 6px; } .rlo-yt2 .rlo-yt-ava img.chat-history--user-avatar { width: 24px !important; height: 24px !important; border-radius: 50% !important; object-fit: cover; margin-left: 6px; } .rlo-yt2 .rlo-yt-head { grid-area: rlo-head; display: inline-flex; align-items: center; gap: 4px; min-width: 0; } .rlo-yt2 .rlo-yt-head .chat-history--username { font-weight: 700; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; } .rlo-yt2 .rlo-yt-head .chat-history--badges-wrapper { display: inline-flex !important; align-items: center; gap: 4px; } .rlo-yt2 .rlo-yt-head .chat-history--badges-wrapper img, .rlo-yt2 .rlo-yt-head .chat-history--badges-wrapper svg { height: 16px; width: auto; } .rlo-yt2 .rlo-yt-ts { grid-area: rlo-ts; font-size: 11px; line-height: 1; color: rgba(255,255,255,0.7); white-space: nowrap; } .rlo-yt2 .rlo-yt-msg { grid-area: rlo-msg; word-wrap: break-word; overflow-wrap: anywhere; font-size: 14px; line-height: 1.4; text-align: left; margin-left: 6px; } .rlo-hide-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:9999px; font-size:12px; font-weight:700; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:#fff; cursor:pointer; user-select:none; } .rlo-hide-chip input { accent-color:#85c742; } .rlo-reset-ads-btn{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:9999px; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.08); color:#fff; font-weight:800; cursor:pointer; }
    #rlo-center-modal .rlo-row { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); margin-top: 8px; }
    #rlo-center-modal .rlo-avatar-icon { width: 36px; height: 36px; border-radius: 50%; background-size: cover; background-color: #333; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    #rlo-center-modal .rlo-username-viewers { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
    #rlo-center-modal .rlo-username { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #rlo-center-modal .rlo-viewers-inline { display: inline-flex; align-items: center; gap: 6px; opacity: .8; font-size: 0.9em; }
    #rlo-center-modal .rlo-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #f23160; }
    #rlo-center-modal .rlo-raid-link-btn { all: unset; box-sizing: border-box; cursor: pointer; color: #fff; background: #85c742; padding: 6px 12px; border-radius: 9999px; font-weight: 700; font-size: 13px; text-align: center; }
    #rlo-center-modal .rlo-raid-link-btn:hover { filter: brightness(1.1); }
    .rlo-hide-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:9999px; font-size:12px; font-weight:700; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:#fff; cursor:pointer; user-select:none; }
    .rlo-hide-chip input { accent-color:#85c742; }
       #rlo-center-modal .rlo-avatar-icon img {
           width: 100%;
           height: 100%;
           object-fit: cover;
       }
  `;
    const s = document.createElement('style');
    s.id = 'rlo-base-styles';
    s.textContent = css;
    document.head.appendChild(s);
}

/* =========================
   Popup helpers (UPDATED)
========================= */
function closeCenterPopup() {
    document.getElementById('rlo-center-overlay')?.remove();
}

function showCenterPopup({
    title = 'Status',
    subtitle = '',
    rows = [],
    actions = []
} = {}) {
    closeCenterPopup();
    const overlay = document.createElement('div');
    overlay.id = 'rlo-center-overlay';
    const modal = document.createElement('div');
    modal.id = 'rlo-center-modal';
    const isCompact = (!rows || rows.length === 0) && (String(subtitle).length <= 160);
    if (isCompact) modal.classList.add('rlo-compact');
    modal.innerHTML = `<h3>${title}</h3>${subtitle ? `<div class="rlo-subtle">${subtitle}</div>` : ''}<div id="rlo-center-body"></div><div class="rlo-actions"></div>`;
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
    const body = modal.querySelector('#rlo-center-body');

    (rows || []).forEach(r => {
        const row = document.createElement('div');
        row.className = 'rlo-row';
        const avatarContent = r.avatarUrl ? `<img src="${r.avatarUrl}" alt="${r.username}'s avatar" />` : '';
        const raidUrl = r.url.startsWith('http') ? r.url : `https://rumble.com${r.url}`;

        row.innerHTML = `
      <div class="rlo-avatar-icon">${avatarContent}</div>
      <div class="rlo-username-viewers">
        <span class="rlo-username" title="${r.username}">${r.username}</span>
        ${typeof r.viewers === 'number' ? `<span class="rlo-viewers-inline"><i class="rlo-live-dot"></i> ${r.viewers} watching</span>` : ''}
      </div>
      <div><button data-url="${raidUrl}" class="rlo-raid-link-btn">Raid</button></div>
    `;
        body.appendChild(row);
    });

    modal.querySelectorAll('.rlo-raid-link-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetUrl = e.target.getAttribute('data-url');
            if (targetUrl) {
                bgMessage('raidButtonPressed', {
                    targetUrl
                });
                closeCenterPopup();
            }
        });
    });

    const actWrap = modal.querySelector('.rlo-actions');
    const addBtn = (label, cls, onClick) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = cls;
        b.addEventListener('click', onClick);
        actWrap.appendChild(b);
    };
    if (!Array.isArray(actions) || !actions.length) {
        addBtn('Close', 'rlo-ghost', closeCenterPopup);
    } else {
        actions.forEach(a => addBtn(a.label, a.primary ? 'rlo-primary' : 'rlo-ghost', () => a.onClick?.(closeCenterPopup)));
    }
}

/* =========================
   Faux chat
========================= */
function findChatHostForSimulation() {
    const nullState = document.querySelector('[data-sentry-component="CINullStateView"]');
    if (nullState) {
        const outer = nullState.closest('.grow.overflow-hidden.pb-16.w-full');
        if (outer) return outer;
    }
    return document.querySelector('[class*="chat"] [class*="scroll"], .chat-message-list, .chat__message-list') || document.body;
}

function renderFauxRow({
    kind,
    user,
    text
}) {
    const row = document.createElement('div');
    row.className = 'rlo-faux-chat-row';
    row.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;line-height:1.35';
    const badge = document.createElement('span');
    badge.className = 'rlo-faux-badge';
    badge.textContent = (kind === 'raid' ? 'RAID' : 'RANT');
    badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 .5rem;border-radius:9999px;font-weight:700;background:rgba(110,92,224,.25);border:1px solid rgba(110,92,224,.45)';
    const u = document.createElement('span');
    u.className = 'rlo-faux-user';
    u.textContent = user;
    u.style.fontWeight = '700';
    const t = document.createElement('span');
    t.className = 'rlo-faux-text';
    t.textContent = `— ${text}`;
    t.style.opacity = '.95';
    row.appendChild(badge);
    row.appendChild(u);
    row.appendChild(t);
    return row;
}

function injectSimulatedMessage(kind = 'raid', user = 'Awesome Raider', extra = '') {
    const host = findChatHostForSimulation();
    if (!host) return false;
    const nullState = host.querySelector('[data-sentry-component="CINullStateView"]');
    if (nullState) nullState.remove();
    const wrapId = 'rlo-faux-chat-wrap';
    let wrap = document.getElementById(wrapId);
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = wrapId;
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.width = '100%';
        host.appendChild(wrap);
    }
    const text = kind === 'raid' ? `${user} has raided the stream!` : `${user} ${extra || 'sent a rant!'}`;
    wrap.appendChild(renderFauxRow({
        kind,
        user,
        text
    }));
    try {
        host.scrollTop = host.scrollHeight;
    } catch {}
    return true;
}
/* =========================
   Timestamps + Chat layout
========================= */

function revertRowStyleFromYT2(li) {
    if (!li || !li.dataset.rloModified) return;

    if (li.dataset.rloOriginalHTML) {
        li.innerHTML = li.dataset.rloOriginalHTML;
    }

    li.classList.remove('rlo-yt2');
    delete li.dataset.rloModified;
    delete li.dataset.rloStamped;
    delete li.dataset.rloOriginalHTML;
}

function disableChatEnhancements() {
    if (__rloChatObs) {
        __rloChatObs.disconnect();
        __rloChatObs = null;
    }
    if (__rloYtObs2) {
        __rloYtObs2.disconnect();
        __rloYtObs2 = null;
    }

    const host = document.getElementById('chat-history-list');
    if (host) {
        delete host.__rloYtObs2;
    }

    document.querySelectorAll('li.js-chat-history-item[data-rlo-modified="1"]').forEach(revertRowStyleFromYT2);

    console.log("✅ [RLO] Chat enhancements disabled and layout restored.");
}

function rloNowHHMMSS() {
    const d = new Date(),
        pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rloStyleRowAsYT2(li) {
    if (!li || li.dataset.rloModified) return;

    const msgWrap = li.querySelector('.chat-history--message-wrapper');
    const msg = msgWrap?.querySelector('.js-chat-message');
    const nameBtn = msgWrap?.querySelector('.chat-history--username');
    const badges = msgWrap?.querySelector('.chat-history--badges-wrapper');
    const avatarAnchor = li.querySelector(':scope > a[href^="/user/"], :scope > a[href^="/c/"]');

    if (!msg || !msgWrap) {
        return;
    }

    li.dataset.rloOriginalHTML = li.innerHTML;
    li.dataset.rloModified = '1';

    const ava = document.createElement('div');
    ava.className = 'rlo-yt-ava';
    const head = document.createElement('div');
    head.className = 'rlo-yt-head';
    const msgHost = document.createElement('div');
    msgHost.className = 'rlo-yt-msg';
    const ts = document.createElement('span');
    ts.className = 'rlo-yt-ts';

    if (avatarAnchor) ava.appendChild(avatarAnchor);
    if (nameBtn) head.appendChild(nameBtn);
    if (badges) head.appendChild(badges);
    msgHost.appendChild(msg);
    ts.textContent = rloNowHHMMSS();

    li.innerHTML = '';
    li.appendChild(ava);
    li.appendChild(head);
    li.appendChild(ts);
    li.appendChild(msgHost);

    li.classList.add('rlo-yt2');
    li.dataset.rloStamped = '1';
}


function rloObserveChatAsYT2() {
    const host = document.getElementById('chat-history-list');
    if (!host) return;

    host.querySelectorAll('li.js-chat-history-item:not([data-rlo-modified])').forEach(rloStyleRowAsYT2);

    if (host.__rloYtObs2) return;
    const mo = new MutationObserver(muts => {
        for (const m of muts) {
            m.addedNodes.forEach(n => {
                if (n.nodeType === 1 && n.matches?.('li.js-chat-history-item')) {
                    rloStyleRowAsYT2(n);
                }
            });
        }
    });
    mo.observe(host, {
        childList: true
    });
    host.__rloYtObs2 = mo;
}

function rloObserveChatTimestamps() {
    const ul = document.getElementById('chat-history-list');
    if (!ul) return;
    if (__rloChatObs) {
        __rloChatObs.disconnect();
    }
    __rloChatObs = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList' && m.addedNodes?.length) {
                m.addedNodes.forEach(n => {
                    if (n && n.nodeType === 1 && n.matches?.('li.js-chat-history-item.rlo-yt2')) {
                        const ts = n.querySelector('.rlo-yt-ts');
                        if (ts) ts.textContent = rloNowHHMMSS();
                    }
                });
            }
        }
    });
    __rloChatObs.observe(ul, {
        childList: true
    });
}

/* =========================
   Clip button (with cooldown)
========================= */
function findChatSendRow() {
    return document.querySelector('.chat--rant-row') || null;
}

function ensureClipButton() {
    if (document.getElementById('rlo-clip-btn')) return true;
    const row = findChatSendRow();
    if (!row) return false;
    const sendBtn = row.querySelector('.chat--send');
    const btn = document.createElement('button');
    btn.id = 'rlo-clip-btn';
    btn.type = 'button';
    btn.title = 'Send !clip';
    btn.innerHTML = `<span>🎬 Clip</span>`;
    if (sendBtn && sendBtn.parentElement) {
        sendBtn.parentElement.appendChild(btn);
    } else {
        row.appendChild(btn);
    }
    bindClipButton(btn);
    return true;
}

function removeClipButton() {
    document.getElementById('rlo-clip-btn')?.remove();
}

function setClipBusy(busy) {
    const btn = document.getElementById('rlo-clip-btn');
    if (!btn) return;
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
}

function bindClipButton(btn) {
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await onClipClick();
    });
}
let __rloLastClipAt = 0;
const CLIP_COOLDOWN_MS = 30_000;
async function onClipClick() {
    const now = Date.now();
    const since = now - __rloLastClipAt;
    if (since < CLIP_COOLDOWN_MS) {
        const remain = Math.ceil((CLIP_COOLDOWN_MS - since) / 1000);
        showCenterPopup({
            title: 'Please wait…',
            subtitle: `Clip command is on cooldown. Try again in ${remain}s.`
        });
        return;
    }
    __rloLastClipAt = now;
    setClipBusy(true);
    try {
        const input = document.querySelector('#chat-message-text-input');
        const form = input ? input.closest('form') : null;
        if (!input || !form) {
            console.warn('✅ [RLO] [Clip] Chat input or form not found.');
            return;
        }
        input.focus();
        input.value = '!clip';
        input.dispatchEvent(new Event('input', {
            bubbles: true
        }));
        const submitEvent = new Event('submit', {
            bubbles: true,
            cancelable: true
        });
        form.dispatchEvent(submitEvent);
    } catch (e) {
        console.warn('✅ [RLO] [Clip] Failed to send !clip:', e);
    } finally {
        setClipBusy(false);
    }
}

/* =========================
   Sounds
========================= */
async function playDefaultSound(kind = 'raid') {
    try {
        const RAID_LIST = 'raidSounds',
            RAID_SELECTED = 'raidSelectedIndex',
            RANT_LIST = 'rantSounds',
            RANT_SELECTED = 'rantSelectedIndex';
        const data = await chrome.storage.local.get([RAID_LIST, RAID_SELECTED, RANT_LIST, RANT_SELECTED]);
        let src = null;
        if (kind === 'raid') {
            const list = data[RAID_LIST] || [];
            const sel = (typeof data[RAID_SELECTED] === 'number') ? data[RAID_SELECTED] : (list.length ? 0 : null);
            if (sel != null && list[sel]) src = list[sel].dataUrl || null;
        } else {
            const list = data[RANT_LIST] || [];
            const sel = (typeof data[RANT_SELECTED] === 'number') ? data[RANT_SELECTED] : (list.length ? 0 : null);
            if (sel != null && list[sel]) src = list[sel].dataUrl || null;
        }
        if (!src) return;
        const a = new Audio(src);
        a.volume = 1;
        a.play().catch(() => {});
    } catch {}
}

/* =========================
   Campaign Hiding – storage + helpers
========================= */
function normName(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
async function getHiddenNames() {
    const res = await bgMessage('getHiddenCampaignNames');
    return res?.hiddenNames || [];
}
async function addHiddenName(name) {
    return bgMessage('addHiddenCampaignName', {
        name
    });
}
async function removeHiddenName(name) {
    return bgMessage('removeHiddenCampaignName', {
        name
    });
}
async function resetHiddenNames() {
    return bgMessage('resetHiddenCampaignNames');
}

/* =========================
   Campaign Hiding – DOM mapping
========================= */
function findCampaignRows() {
    return Array.from(document.querySelectorAll('table tr.bg-navy'));
}

function getRowCompanyName(tr) {
    const d = tr?.querySelector('td:first-child .break-words.whitespace-pre-line.line-clamp-2.text-light');
    return (d?.textContent || '').replace(/\s+/g, ' ').trim();
}

function ensureRowHideControl(tr, companyName) {
    if (!tr || tr.querySelector('.rlo-hide-chip')) return;
    const firstTd = tr.querySelector('td:first-child');
    if (!firstTd) return;
    const nameContainer = firstTd.querySelector('div');
    if (nameContainer) {
        nameContainer.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 8px;';
    }
    const chip = document.createElement('label');
    chip.className = 'rlo-hide-chip';
    chip.title = 'Hide this advertiser on all campaign screens';
    chip.innerHTML = `<input type="checkbox" /> Hide`;
    chip.querySelector('input').addEventListener('change', async (e) => {
        if (e.target.checked) {
            await addHiddenName(companyName);
            tr.remove();
        }
    });
    if (nameContainer) {
        nameContainer.appendChild(chip);
    } else {
        firstTd.appendChild(chip);
    }
}

function findCampaignCards() {
    return Array.from(document.querySelectorAll('div[data-sentry-component="CICampaignCardBase"]'));
}

function getCardCompanyName(card) {
    const d = card?.querySelector('.break-words.whitespace-pre-line.line-clamp-1.text-body.text-light.font-bold');
    return (d?.textContent || '').replace(/\s+/g, ' ').trim();
}

function ensureCardHideControl(card, companyName) {
    if (!card || card.querySelector('.rlo-hide-chip')) return;
    const topBar = card.querySelector('.flex.items-center.justify-between') || card;
    const holder = document.createElement('div');
    holder.style.cssText = 'display: inline-flex; align-items: center; gap: 8px;';
    const chip = document.createElement('label');
    chip.className = 'rlo-hide-chip';
    chip.title = 'Hide this advertiser on all campaign screens';
    chip.innerHTML = `<input type="checkbox" /> Hide`;
    chip.querySelector('input').addEventListener('change', async (e) => {
        if (e.target.checked) {
            await addHiddenName(companyName);
            card.remove();
        }
    });
    holder.appendChild(chip);
    topBar.appendChild(holder);
}

async function applyCampaignHides() {
    const hidden = await getHiddenNames();
    const hiddenSet = new Set(hidden.map(normName));
    if (isCampaignsListPage()) {
        findCampaignRows().forEach(tr => {
            const name = getRowCompanyName(tr);
            if (!name) return;
            if (hiddenSet.has(normName(name))) {
                tr.remove();
            } else {
                ensureRowHideControl(tr, name);
            }
        });
    }
    if (isStudioPassthroughPage()) {
        findCampaignCards().forEach(card => {
            const name = getCardCompanyName(card);
            if (!name) return;
            if (hiddenSet.has(normName(name))) {
                card.remove();
            } else {
                ensureCardHideControl(card, name);
            }
        });
    }
}

let __rloCampaignsObs, __rloPassthroughObs;

function manageCampaignsTable() {
    if (!isCampaignsListPage()) return;
    try {
        __rloCampaignsObs?.disconnect();
    } catch {}
    const host = document.querySelector('table') || document.body;
    __rloCampaignsObs = new MutationObserver(() => applyCampaignHides());
    __rloCampaignsObs.observe(host, {
        childList: true,
        subtree: true
    });
    applyCampaignHides();
}

function manageAdReads() {
    if (!isStudioPassthroughPage()) return;
    try {
        __rloPassthroughObs?.disconnect();
    } catch {}
    const host = document.querySelector('[data-sentry-component="CICampaignCardBase"]')?.parentElement || document.body;
    __rloPassthroughObs = new MutationObserver(() => applyCampaignHides());
    __rloPassthroughObs.observe(host, {
        childList: true,
        subtree: true
    });
    applyCampaignHides();
}

/* =========================
   Raid button + logic (FINAL)
========================= */
function getButtonTargetContainer() {
    return document.querySelector(".header-user-actions.space-x-4") || document.querySelector(".chat-message-form-section") || document.querySelector(".flex.items-center.space-x-2.flex-wrap.justify-end") || document.querySelector(".shrink-0.flex.items-center.space-x-2");
}

function ensureButtonHitTest() {
    document.body.addEventListener('click', (e) => {
        const target = e.target.closest('#raid-button');
        if (!target) return;
        if (target.dataset.bound === '1') return;
        bindRaidButton(target);
    }, {
        capture: true
    });
}

function setRaidButtonBusy(busy) {
    const btn = document.getElementById('raid-button');
    if (!btn) return;
    if (busy) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        if (!btn.querySelector('.rlo-spinner')) {
            const sp = document.createElement('i');
            sp.className = 'rlo-spinner';
            btn.appendChild(sp);
        }
    } else {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.querySelector('.rlo-spinner')?.remove();
    }
}

function ensureRaidButton() {
    const targetDiv = getButtonTargetContainer();
    if (!targetDiv) return false;
    let btn = document.getElementById('raid-button');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'raid-button';
        btn.type = 'button';
        btn.innerHTML = `<span>🚀 Rumble Raid</span>`;
        targetDiv.appendChild(btn);
    } else if (!targetDiv.contains(btn)) {
        targetDiv.appendChild(btn);
    }
    bindRaidButton(btn);
    ensureButtonHitTest();
    return true;
}

function insertRaidButton() {
    ensureRaidButton();
}

function removeRaidButton() {
    document.getElementById('raid-button')?.remove();
}

function bindRaidButton(btn) {
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:.571429rem;height:2.6rem;padding:.75rem;border-radius:9999px;background:rgb(var(--color-indigo,27 33 39));font-weight:700;font-size:14px;white-space:nowrap;margin:0;min-width:0;width:fit-content;flex:none;box-sizing:border-box;color:#fff;';
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await onRaidClickHandler();
    });
}

function flashStartStreamIfPresent() {
    if (!isStudioPage()) return;
    let btn = null;
    document.querySelectorAll('button').forEach(b => {
        const t = (b.textContent || '').trim().toLowerCase();
        if (!btn && (t === 'start stream' || t.includes('start stream'))) btn = b;
    });
    if (!btn) {
        for (const sel of ['button[data-testid="start-stream"]', 'button.btn-primary', 'button[type="submit"]']) {
            const el = document.querySelector(sel);
            if (el) {
                btn = el;
                break;
            }
        }
    }
    if (btn) {
        btn.classList.add('rlo-flash');
        setTimeout(() => btn.classList.remove('rlo-flash'), 5000);
    }
}

function computeEta(scheduledOn) {
    try {
        const t = new Date(/^\d+$/.test(String(scheduledOn)) ? (String(scheduledOn).length > 12 ? Number(scheduledOn) : Number(scheduledOn) * 1000) : scheduledOn).getTime();
        if (!isFinite(t)) return null;
        const diffMs = t - Date.now();
        if (diffMs <= 0) return 'starting soon';
        const mins = Math.round(diffMs / 60000);
        if (mins < 60) return `${mins} minute${mins===1?'':'s'}`;
        const hrs = Math.round(mins / 60);
        return `${hrs} hour${hrs===1?'':'s'}`;
    } catch {
        return null;
    }
}

/* =========================
   Raid button + logic (FINAL)
========================= */
async function onRaidClickHandler() {
    console.log("✅ [RLO] Raid button clicked");
    setRaidButtonBusy(true);
    const done = () => setRaidButtonBusy(false);
    const isOwner = await isCurrentPageOwned();
    if (!isOwner) {
        showCenterPopup({
            title: 'Not the Stream Owner',
            subtitle: 'Raiding is not available on this page.'
        });
        done();
        return;
    }
    const apiRes = await bgMessage('getApiData', {}, 5000);
    if (!apiRes || !apiRes.success || !apiRes.data) {
        done();
        showCenterPopup({
            title: 'API Unavailable',
            subtitle: 'Could not read your live status.'
        });
        return;
    }
    try {
        const data = apiRes.data || {};
        const ls = Array.isArray(data.livestreams) ? data.livestreams[0] : null;

        const isLive = !!ls?.is_live;
        const scheduledOn = ls?.scheduled_on;

        if (!isLive) {
            done();
            const eta = scheduledOn ? computeEta(scheduledOn) : null;

            if (isStudioPage()) {
                if (!scheduledOn) {
                    showCenterPopup({
                        title: 'You are not yet Live',
                        subtitle: 'Go Live first.'
                    });
                    flashStartStreamIfPresent();
                } else {
                    showCenterPopup({
                        title: 'You are not yet Live',
                        subtitle: `Live in ${eta}`
                    });
                }
            } else {
                showCenterPopup({
                    title: 'You are not yet Live',
                    subtitle: eta ? `Live in ${eta}` : 'Go Live first.'
                });
            }
            return;
        }
        const res = await bgMessage('getRaidTargets', {}, 7000);
        done();
        const list = (res && res.success && Array.isArray(res.targets)) ? res.targets : [];
        if (!list.length) {
            showCenterPopup({
                title: 'No Raid Targets Found',
                subtitle: 'We could not find live channels you follow.'
            });
            return;
        }
        const rows = list.map(t => ({
            live: true,
            username: t.username || 'Unknown',
            avatarUrl: t.avatarUrl,
            url: t.url,
            viewers: (typeof t.viewers === 'number') ? t.viewers : undefined
        }));

        showCenterPopup({
            title: 'Live Raid Targets',
            subtitle: 'Viewer counts are from followed channels.',
            rows,
            actions: [{
                label: 'Close',
                primary: false,
                onClick: (close) => close()
            }]
        });
    } catch (e) {
        done();
        showCenterPopup({
            title: 'Status Error',
            subtitle: 'Could not determine your live state.'
        });
    }
}

/* =========================
   Feature-state & owner helpers
========================= */
const defaultStates = {
    'enable-raid-button-live': false,
    'enable-raid-button-studio': false,
    'enable-followers-live': false,
    'enable-hide-campaigns': false,
    'enable-chat-styling': false,
    'enable-studio-layouts': false,
    'enable-gifted-live': false,
    'enable-followers-studio': false,
    'enable-gifted-studio': false,
    'enable-clips-command': false,
};
let currentSettings = {
        ...defaultStates
    },
    chatStylingEnabled = false,
    hasInitializedOwnerFeatures = false,
    adManagementDebounceTimer = null;

function applyRaidKillSwitchLive(enabled) {
    const styleId = 'rlo-raid-toggle-style-live';
    document.getElementById(styleId)?.remove();
    if (!enabled && isLiveStreamPage()) {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `#raid-button{display:none!important;visibility:hidden!important}`;
        document.head.appendChild(s);
        removeRaidButton();
    }
}

async function isCurrentPageOwned() {
    try {
        if (isStudioPage()) {
            return true;
        }

        const oembedLink = document.querySelector('link[rel="alternate"][type="application/json+oembed"]');
        const oembedUrl = oembedLink ? oembedLink.href : null;

        if (!oembedUrl) {
            return false;
        }

        const ownerResponse = await bgMessage('verifyStreamOwnership', {
            oembedUrl
        });
        return ownerResponse ? ownerResponse.isOwner : false;

    } catch (e) {
        console.warn("✅ [RLO] isCurrentPageOwned check failed:", e);
        return false;
    }
}



function applySettingsDiff(oldS, newS) {
    const live = isLiveStreamPage(),
        studio = isStudioPage();
    if (oldS['enable-raid-button-live'] !== newS['enable-raid-button-live']) {
        if (IS_TOP && live) {
            applyRaidKillSwitchLive(!!newS['enable-raid-button-live']);
            if (newS['enable-raid-button-live']) insertRaidButton();
            else removeRaidButton();
        }
    }
    if (oldS['enable-raid-button-studio'] !== newS['enable-raid-button-studio']) {
        if (IS_TOP && studio) {
            if (newS['enable-raid-button-studio']) insertRaidButton();
            else removeRaidButton();
        }
    }
    if (oldS['enable-followers-live'] !== newS['enable-followers-live']) {
        if (IS_TOP && live) {
            (async () => {
                const owner = await isCurrentPageOwned();
                if (!owner) {
                    removeFollowerButton();
                    return;
                }
                if (newS['enable-followers-live']) insertFollowerButton();
                else removeFollowerButton();
            })();
        }
    }
    if (oldS['enable-gifted-live'] !== newS['enable-gifted-live']) {
        if (IS_TOP && live) {
            (async () => {
                const owner = await isCurrentPageOwned();
                if (!owner) {
                    removeGiftedSubsButton();
                    return;
                }
                if (newS['enable-gifted-live']) insertGiftedSubsButton();
                else removeGiftedSubsButton();
            })();
        }
    }
    if (oldS['enable-followers-studio'] !== newS['enable-followers-studio']) {
        if (IS_TOP && studio) {
            (async () => {
                const owner = await isCurrentPageOwned();
                if (!owner) {
                    removeFollowerButton();
                    return;
                }
                if (newS['enable-followers-studio']) insertFollowerButton();
                else removeFollowerButton();
            })();
        }
    }
    if (oldS['enable-gifted-studio'] !== newS['enable-gifted-studio']) {
        if (IS_TOP && studio) {
            (async () => {
                const owner = await isCurrentPageOwned();
                if (!owner) {
                    removeGiftedSubsButton();
                    return;
                }
                if (newS['enable-gifted-studio']) insertGiftedSubsButton();
                else removeGiftedSubsButton();
            })();
        }
    }
    if (oldS['enable-chat-styling'] !== newS['enable-chat-styling']) {
        chatStylingEnabled = !!newS['enable-chat-styling'];
    }
    if (oldS['enable-studio-layouts'] !== newS['enable-studio-layouts']) {
        if (IS_TOP && studio) {
            if (newS['enable-studio-layouts']) {
                if (typeof manageStudioLayouts === 'function') manageStudioLayouts();
            } else {
                if (typeof disableStudioLayouts === 'function') disableStudioLayouts();
            }
        }
    }
    if (oldS['enable-hide-campaigns'] !== newS['enable-hide-campaigns']) {
        if (IS_TOP && newS['enable-hide-campaigns']) {
            clearTimeout(adManagementDebounceTimer);
            adManagementDebounceTimer = setTimeout(() => {
                if (typeof manageAdReads === 'function') manageAdReads();
                if (typeof manageCampaignsTable === 'function') manageCampaignsTable();
            }, 500);
        }
    }
    if (oldS['enable-clips-command'] !== newS['enable-clips-command']) {
        if (IS_TOP) {
            if (newS['enable-clips-command']) {
                ensureClipButton();
            } else {
                removeClipButton();
            }
        }
    }
    if (oldS['enable-chat-enhancements'] !== newS['enable-chat-enhancements']) {
        if (IS_TOP && live) {
            if (newS['enable-chat-enhancements']) {
                rloObserveChatAsYT2();
                rloObserveChatTimestamps();
            } else {
                disableChatEnhancements();
            }
        }
    }
}



chrome.storage.onChanged.addListener((changes, area) => {
    if (!IS_TOP) return;
    if (area !== 'local' || !changes.functionStates) return;
    const oldS = {
        ...currentSettings
    };
    currentSettings = {
        ...defaultStates,
        ...(changes.functionStates.newValue || {})
    };
    console.log("✅ [RLO] functionStates changed → apply diff");
    applySettingsDiff(oldS, currentSettings);
});

function insertFollowerButton() {
    if (document.getElementById('follower-button')) return;
    const targetDiv = getButtonTargetContainer();
    if (!targetDiv) return;
    const btn = document.createElement('button');
    btn.id = 'follower-button';
    btn.type = 'button';
    btn.innerHTML = `<span>🤝</span><span id="latest-follower-display" style="margin:0 8px;">—</span><span>▼</span>`;
    targetDiv.appendChild(btn);
    bgMessage('getApiData').then(apiRes => {
        if (apiRes && apiRes.success && apiRes.data) {
            const latestFollower = apiRes.data.followers?.recent_followers?.[0]?.username || '—';
            document.getElementById('latest-follower-display').textContent = latestFollower;
        }
    });
}


function removeFollowerButton() {
    document.getElementById('follower-button')?.remove();
}

function insertGiftedSubsButton() {
    if (document.getElementById('gifted-subs-button')) return;
    const targetDiv = getButtonTargetContainer();
    if (!targetDiv) return;
    const btn = document.createElement('button');
    btn.id = 'gifted-subs-button';
    btn.type = 'button';
    btn.innerHTML = `<span id="gifted-subs-count">—</span>`;
    targetDiv.appendChild(btn);

    bgMessage('getApiData').then(apiRes => {
        if (apiRes && apiRes.success && apiRes.data) {
            const giftedSubsCount = apiRes.data.gifted_subs?.recent_gifted?.length || '—';
            document.getElementById('gifted-subs-count').textContent = giftedSubsCount;
        }
    });
}

function removeGiftedSubsButton() {
    document.getElementById('gifted-subs-button')?.remove();
}

function scheduleDashboardRefresh(_ms) {
}
async function initializeOwnerFeatures() {
    if (hasInitializedOwnerFeatures) return;
    hasInitializedOwnerFeatures = true;
    scheduleDashboardRefresh(0);
}

/* =========================
   MESSAGE LISTENER (FINAL)
========================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let willRespondAsync = false;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'rlo-ping':
            console.log('✅ [RLO] Ping received in content.js for', location.href);
            sendResponse({
                ok: true,
                href: location.href
            });
            break;

        case 'rlo-test-raid':
            console.log('✅ [RLO] Received test RAID');
            const raidName = msg.from || 'Awesome Raider';
            injectSimulatedMessage('raid', raidName);
            playDefaultSound('raid');
            break;

        case 'rlo-test-rant':
            console.log('✅ [RLO] Received test RANT');
            const rantName = msg.from || 'Awesome Raider';
            const dollars = typeof msg.amount === 'number' ? `$${msg.amount.toFixed(2)}` : '2 Dollar';
            injectSimulatedMessage('rant', rantName, `${dollars} Rant`);
            playDefaultSound('rant');
            break;

        case 'rlo-show-demo-popup':
            console.log('✅ [RLO] Received show demo popup request', msg.payload);
            showCenterPopup({
                title: msg.payload?.title || 'Demo Popup',
                subtitle: msg.payload?.subtitle || '',
                rows: msg.payload?.rows || [],
                actions: [{
                    label: 'Close',
                    primary: false,
                    onClick: (close) => close()
                }]
            });
            break;

        case 'rlo-hidden-campaigns-updated':
            location.reload();
            break;

        case 'rlo-reset-hidden-campaigns':
            willRespondAsync = true;
            (async () => {
                await bgMessage('resetHiddenCampaignNames');
                location.reload();
                try {
                    sendResponse({
                        ok: true
                    });
                } catch {}
            })();
            break;

        case 'showRaidConfirmation': {
            const {
                html,
                raidCommandId
            } = msg.payload;
            if (html && raidCommandId) { 
                document.getElementById('raid-confirm-popup-wrapper')?.remove();

                const raidPopupWrapper = document.createElement('div');
                raidPopupWrapper.id = 'raid-confirm-popup-wrapper';

                const raidPopup = document.createElement('div');
                raidPopup.id = 'raid-confirm-popup';
                raidPopup.innerHTML = html;

                raidPopupWrapper.appendChild(raidPopup);
                document.body.appendChild(raidPopupWrapper);

                const confirmButton = raidPopup.querySelector('[data-js="raid_confirm_confirm_button"]');
                const cancelButton = raidPopup.querySelector('[data-js="raid_confirm_cancel_button"]');

                if (confirmButton) {
                    confirmButton.addEventListener('click', () => {
                        bgMessage('confirmRaid', {
                            raidCommandId
                        });
                        raidPopupWrapper.remove();
                    });
                }
                if (cancelButton) {
                    cancelButton.addEventListener('click', () => {
                        bgMessage('cancelRaid', {
                            raidCommandId
                        });
                        raidPopupWrapper.remove();
                    });
                }
            }
            sendResponse({
                ok: true
            });
            break;
        }

    }

    return willRespondAsync;
});

/* =========================
   Bootstrap
========================= */
(async () => {
    const {
        functionStates
    } = await chrome.storage.local.get({
        functionStates: defaultStates
    });
    currentSettings = {
        ...defaultStates,
        ...(functionStates || {})
    };
    console.log("✅ [RLO] content bootstrap on", location.href, {
        isTop: IS_TOP,
        live: isLiveStreamPage(),
        studio: isStudioPage(),
        states: currentSettings
    });
    injectBaseStyles();
    chatStylingEnabled = !!currentSettings['enable-chat-styling'];
    applyRaidKillSwitchLive(!!currentSettings['enable-raid-button-live']);
    if (!currentSettings['enable-raid-button-live']) removeRaidButton();
    if (!currentSettings['enable-followers-live'] && !currentSettings['enable-followers-studio']) removeFollowerButton();
    if (!currentSettings['enable-gifted-live'] && !currentSettings['enable-gifted-studio']) removeGiftedSubsButton();

    const tryApply = async () => {
        const targetDiv = getButtonTargetContainer();
        if (!targetDiv) {
            /*noop*/ }
        if (currentSettings['enable-clips-command']) {
            ensureClipButton();
        }
        if (isLiveStreamPage()) {
            if (currentSettings['enable-chat-enhancements']) {
                rloObserveChatAsYT2();
                rloObserveChatTimestamps();
            }
        }

        if (IS_TOP) {
            const live = isLiveStreamPage(),
                studio = isStudioPage();
            if (live && currentSettings['enable-raid-button-live']) insertRaidButton();
            if (studio && currentSettings['enable-raid-button-studio']) insertRaidButton();
            const needOwnerInit = (live && (currentSettings['enable-followers-live'] || currentSettings['enable-gifted-live'])) || (studio && (currentSettings['enable-followers-studio'] || currentSettings['enable-gifted-studio']));
            if (needOwnerInit && !hasInitializedOwnerFeatures) await initializeOwnerFeatures();
            if (studio && currentSettings['enable-studio-layouts']) {
                if (typeof manageStudioLayouts === 'function') manageStudioLayouts();
            }
            if (currentSettings['enable-hide-campaigns']) {
                manageCampaignsTable();
                manageAdReads();
            }
            ensureButtonHitTest();
        }
    };

    tryApply();
    setInterval(tryApply, 1000);
    window.addEventListener('pageshow', () => setTimeout(tryApply, 0));
    document.addEventListener('readystatechange', tryApply);
    document.addEventListener('visibilitychange', tryApply);
})();