/*!
 * Rumble Live Ops - dashboard-gamify.js
 * Version: v4.0.0
 * Description: Enhances the Creator Program dashboard (interval=30) with
 *              a gamified progress display. Recalculates bar fills beyond
 *              100% and overlays star milestones to show 200%, 300%, etc.
 *
 * Core responsibilities
 * ─────────────────────
 * • Scope control
 *   - Runs only on https://rumble.com/account/dashboard?interval=30.
 *   - Guards against double execution via __RLO_GAMIFY_ACTIVE__.
 *
 * • Style injection
 *   - Injects #rlo-gamify-styles with classes for:
 *       .rlo-gamify-banner  → banner showing Gamify active.
 *       .rlo-gamify-stars   → star overlay layer.
 *       .rlo-gamify-star    → each milestone star (+label).
 *
 * • UI elements
 *   - addBanner(): adds a “⭐ Gamify active interval=30” pill below the page heading.
 *   - updateStars(): overlays ★ markers at 100%, 200%, 300% (cap 300%) or up to 500% (cap 500%).
 *
 * • Logic
 *   - parsePair(): extracts "x / y" numeric pairs from dashboard text.
 *   - mapFill(): maps actual/target into fill percentage:
 *       • 0–100% → 0–50% fill.
 *       • >100% up to cap (300% or 500%) → 50–100% fill.
 *   - isCap300(): determines which metrics are capped at 300%.
 *
 * • DOM processing
 *   - collectMetricBlocks(): finds progress bar rows, parses titles and "x / y" values.
 *   - applyOne(): applies recalculated fill, updates classes, stashes originals, and draws stars.
 *   - stashOriginal()/restoreOriginal(): preserve and restore original styles and classes.
 *
 * • Enforcement
 *   - runInternal(): processes all metrics, applies gamify logic, sets up a lightweight
 *     enforcer interval to re-assert calculated fill values if the SPA mutates them.
 *   - MutationObserver: temporarily watches for content load if metrics aren’t ready.
 *
 * • Enable / Disable
 *   - enable(): injects styles, adds banner, recalculates metrics, sets observer/enforcer.
 *   - disable(): clears observer + enforcer, removes banner and star overlays, restores
 *     all bars to their original state, removes injected styles.
 *
 * • Exposure
 *   - window.__RLOGamifyRun = enable
 *   - window.RLO_GAMIFY_DISABLE = disable
 *
 * Safety
 * ──────
 * - Gracefully bails if not on dashboard or metrics not yet available.
 * - Always stashes originals before modifying DOM.
 * - Cleans up fully on disable.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

(() => {

    if (window.__RLO_GAMIFY_ACTIVE__) {
        try {
            window.__RLOGamifyRun && window.__RLOGamifyRun();
        } catch {}
        return;
    }
    window.__RLO_GAMIFY_ACTIVE__ = true;
    window.__RLO_GAMIFY_PRESENT__ = true;

    const SLOG = (...a) => console.log('[RLO Gamify]', ...a);
    const WLOG = (...a) => console.warn('[RLO Gamify]', ...a);

    try {
        const u = new URL(location.href);
        if (!(u.hostname.endsWith('rumble.com') &&
                u.pathname === '/account/dashboard' &&
                u.searchParams.get('interval') === '30')) {
            return;
        }
    } catch {
        return;
    }

    let observer = null;
    let enforcerTimer = null;
    let ranSuccessfully = false;

    /* ---------- Styles ---------- */
    function injectStyles() {
        if (document.getElementById('rlo-gamify-styles')) return;
        const style = document.createElement('style');
        style.id = 'rlo-gamify-styles';
        style.textContent = `
      .rlo-gamify-banner{
        display:inline-flex;align-items:center;gap:.5rem;
        background:#10b981;color:#062;padding:.25rem .5rem;
        border-radius:999px;font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        margin:.25rem 0 .5rem 0;
      }
      .rlo-gamify-wrap{position:relative;}
      .rlo-gamify-stars{position:absolute;inset:0;pointer-events:none}
      .rlo-gamify-star{
        position:absolute;top:50%;transform:translate(-50%,-50%);
        font-size:11px;line-height:1;opacity:.45;
        filter:drop-shadow(0 1px 1px rgba(0,0,0,.5));
        transition:opacity .2s ease, transform .2s ease;
        color:#ffd54a;
      }
      .rlo-gamify-star.lit{opacity:1;transform:translate(-50%,-50%) scale(1.08);}
      .rlo-gamify-star .label{
        display:block;font-size:10px;margin-top:12px;text-align:center;opacity:.85;color:#fff
      }
    `;
        document.head.appendChild(style);
        SLOG('Styles injected.');
    }

    const getContainer = () => document.querySelector('.content-program-container');

    function addBanner(container) {
        const BANNER_ID = 'rlo-gamify-banner';
        if (document.getElementById(BANNER_ID)) return;
        const heading = container.closest('section')?.querySelector('h5');
        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.className = 'rlo-gamify-banner';
        banner.innerHTML = `⭐ Gamify active <code style="background:rgba(0,0,0,.08);padding:.1rem .35rem;border-radius:6px;">interval=30</code>`;
        if (heading?.parentNode) heading.parentNode.insertBefore(banner, heading.nextSibling);
        else container.prepend(banner);
    }

    function parsePair(text) {
        if (!text) return null;
        const cleaned = text.replace(/,/g, '');
        const m = cleaned.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        if (!m) return null;
        const actual = parseFloat(m[1]);
        const target = parseFloat(m[2]);
        if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return null;
        return {
            actual,
            target
        };
    }

    function isCap300(title) {
        return /premium exclusive hours streamed/i.test(title) ||
            /host read campaigns/i.test(title);
    }

    function mapFill(actual, target, capPercent) {
        const r = actual / target;
        const capRatio = capPercent / 100;
        if (r <= 1) return 0.5 * r;
        const extra = Math.min(r - 1, capRatio - 1);
        const perUnit = 0.5 / (capRatio - 1);
        return Math.max(0, Math.min(1, 0.5 + extra * perUnit));
    }

    function marksFor(capPercent) {
        return capPercent === 300 ?
            [{
                    pct: 50,
                    label: '100%'
                },
                {
                    pct: 75,
                    label: '200%'
                },
                {
                    pct: 100,
                    label: '300%'
                },
            ] :
            [{
                    pct: 50,
                    label: '100%'
                },
                {
                    pct: 62.5,
                    label: '200%'
                },
                {
                    pct: 75,
                    label: '300%'
                },
                {
                    pct: 87.5,
                    label: '400%'
                },
                {
                    pct: 100,
                    label: '500%'
                },
            ];
    }

    function updateStars(barContainer, fill, capPercent) {
        if (!barContainer) return;
        barContainer.classList.add('rlo-gamify-wrap');

        let layer = barContainer.querySelector('.rlo-gamify-stars');
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'rlo-gamify-stars';
            barContainer.appendChild(layer);
        } else {
            layer.innerHTML = '';
        }

        const currentPct = Math.max(0, Math.min(100, fill * 100));
        for (const m of marksFor(capPercent)) {
            const star = document.createElement('div');
            star.className = 'rlo-gamify-star' + (currentPct + 0.01 >= m.pct ? ' lit' : '');
            star.style.left = `${m.pct}%`;
            star.textContent = '★';
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = m.label;
            star.appendChild(label);
            layer.appendChild(star);
        }
    }

    function stashOriginal(inner) {
        if (inner.dataset.rloOrigCss !== undefined) return;

        inner.dataset.rloOrigCss = inner.getAttribute('style') ?? '';
        inner.dataset.rloOrigClass = inner.getAttribute('class') ?? inner.className;
        inner.dataset.rloOrigVar = inner.style.getPropertyValue('--hours-streamed') || '';
        inner.dataset.rloOrigWidth = inner.style.width || '';
    }

    function restoreOriginal(inner) {
        if (inner.dataset.rloOrigCss !== undefined) {
            const css = inner.dataset.rloOrigCss;
            if (css) inner.setAttribute('style', css);
            else inner.removeAttribute('style');
        } else {
            inner.style.width = inner.dataset.rloOrigWidth || '';
            const v = inner.dataset.rloOrigVar || '';
            if (v) inner.style.setProperty('--hours-streamed', v);
            else inner.style.removeProperty('--hours-streamed');
        }

        if (inner.dataset.rloOrigClass !== undefined) {
            inner.className = inner.dataset.rloOrigClass || '';
        }

        delete inner.dataset.rloOrigCss;
        delete inner.dataset.rloOrigClass;
        delete inner.dataset.rloOrigVar;
        delete inner.dataset.rloOrigWidth;
        delete inner.dataset.rloGamifyPct;
    }

    function collectMetricBlocks(container) {

        const rows = Array.from(container.querySelectorAll(':scope > .grid.grid-flow-row.gap-2'));
        SLOG(`Container has ${rows.length} direct child(ren):`);
        rows.forEach((n, i) => SLOG(`  [${i}] ${n.className}`));

        const blocks = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            const barContainer = row.querySelector('.shadow-progress-container');
            if (!barContainer) {
                WLOG(`Row[${i}] missing ".shadow-progress-container".`);
                continue;
            }
            const inner = barContainer.querySelector('.shadow-progress');
            if (!inner) {
                WLOG(`Row[${i}] bar container has no ".shadow-progress" child.`);
                continue;
            }

            const titleEl =
                row.querySelector('.font-semibold.text-primary') ||
                row.querySelector('.font-semibold') ||
                row.querySelector('div.font-semibold');
            const titleText = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();

            const valueHost = Array.from(row.querySelectorAll('div,span,p')).find(el =>
                el && /[\d.,]+\s*\/\s*[\d.,]+/.test((el.textContent || '').replace(/\s+/g, ' '))
            );
            const valueText = (valueHost?.textContent || '').replace(/\s+/g, ' ').trim();

            if (!valueText) {
                WLOG(`Row[${i}] had no "x / y" text.`);
                continue;
            }

            blocks.push({
                row,
                barContainer,
                inner,
                titleText,
                valueText
            });
        }

        if (blocks.length === 0) {
            WLOG('Primary pairing found 0 blocks. Trying fallback pairing…');

            const inners = Array.from(container.querySelectorAll('.shadow-progress'));
            for (const inner of inners) {
                const row = inner.closest('.grid.grid-flow-row.gap-2');
                if (!row) continue;
                const barContainer = inner.closest('.shadow-progress-container');
                const titleEl =
                    row.querySelector('.font-semibold.text-primary') ||
                    row.querySelector('.font-semibold') ||
                    row.querySelector('div.font-semibold');
                const titleText = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
                const valueHost = Array.from(row.querySelectorAll('div,span,p')).find(el =>
                    el && /[\d.,]+\s*\/\s*[\d.,]+/.test((el.textContent || '').replace(/\s+/g, ' '))
                );
                const valueText = (valueHost?.textContent || '').replace(/\s+/g, ' ').trim();
                if (valueText) blocks.push({
                    row,
                    barContainer,
                    inner,
                    titleText,
                    valueText
                });
            }
        }

        SLOG(`Collected ${blocks.length} metric block(s).`);
        return blocks;
    }

    function applyOne(block) {
        const {
            inner,
            barContainer,
            titleText,
            valueText
        } = block;
        const pair = parsePair(valueText);
        if (!pair) return false;

        const cap = isCap300(titleText) ? 300 : 500;
        const fill = mapFill(pair.actual, pair.target, cap);
        const pct = (fill * 100).toFixed(3) + '%';

        stashOriginal(inner);

        inner.style.setProperty('--hours-streamed', pct);
        inner.style.width = pct;

        inner.classList.toggle('bg-progress-complete', fill >= 1);
        inner.classList.toggle('bg-progress-incomplete', fill < 1);

        updateStars(barContainer, fill, cap);

        inner.dataset.rloGamifyPct = pct;
        SLOG(`[Apply] "${titleText}" :: ${pair.actual} / ${pair.target} (cap ${cap}%) → --hours-streamed: ${pct}`);

        return true;
    }

    /* ---------- Core runner ---------- */
    function runInternal() {
        injectStyles();

        const container = getContainer();
        if (!container) {
            WLOG('No ".content-program-container" yet.');
            return false;
        }

        addBanner(container);

        const blocks = collectMetricBlocks(container);
        if (!blocks.length) {
            WLOG('No metric blocks found yet.');
            return false;
        }

        let changed = 0;
        for (const b of blocks) {
            try {
                if (applyOne(b)) changed++;
            } catch (e) {
                WLOG('applyOne error:', e);
            }
        }

        if (changed > 0) {
            ranSuccessfully = true;

            if (!enforcerTimer) {
                enforcerTimer = setInterval(() => {
                    for (const inner of document.querySelectorAll('.content-program-container .shadow-progress')) {
                        const pct = inner.dataset.rloGamifyPct;
                        if (!pct) continue;
                        const v = inner.style.getPropertyValue('--hours-streamed');
                        if (v !== pct || inner.style.width !== pct) {
                            inner.style.setProperty('--hours-streamed', pct);
                            inner.style.width = pct;
                        }
                    }
                }, 1500);
            }
            return true;
        }

        return false;
    }

    function enable() {
        SLOG('Enable called.');
        const ok = runInternal();

        if (observer) {
            observer.disconnect();
            observer = null;
        }

        if (!ok && !ranSuccessfully) {
            observer = new MutationObserver(() => {
                const done = runInternal();
                if (done && observer) {
                    observer.disconnect();
                    observer = null;
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            SLOG('Setting short-lived observer to wait for content…');

            setTimeout(() => {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            }, 8000);
        }
    }

    function disable() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (enforcerTimer) {
            clearInterval(enforcerTimer);
            enforcerTimer = null;
        }

        document.querySelectorAll('.content-program-container .rlo-gamify-stars').forEach(n => n.remove());
        document.querySelectorAll('#rlo-gamify-banner, .rlo-gamify-banner').forEach(n => n.remove());

        let restored = 0;
        document.querySelectorAll('.content-program-container .shadow-progress').forEach(inner => {
            if (
                inner.dataset.rloOrigCss !== undefined ||
                inner.dataset.rloOrigVar !== undefined ||
                inner.dataset.rloOrigWidth !== undefined
            ) {
                restoreOriginal(inner);
                restored++;
            } else {
                inner.style.removeProperty('--hours-streamed');
                inner.style.removeProperty('width');
                inner.classList.remove('bg-progress-complete', 'bg-progress-incomplete');
                inner.removeAttribute('data-rloGamifyPct');
            }
        });

        document
            .querySelectorAll('.content-program-container .rlo-gamify-wrap')
            .forEach(c => c.classList.remove('rlo-gamify-wrap'));

        document.getElementById('rlo-gamify-styles')?.remove();

        ranSuccessfully = false;
        SLOG('Gamify disabled; restored', restored, 'progress bar(s).');
    }

    window.__RLOGamifyRun = enable;
    window.RLO_GAMIFY_DISABLE = disable;
    enable();
})();