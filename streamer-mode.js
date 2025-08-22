/*!
 * Rumble Live Ops - streamer-mode.js
 * Version: v4.0.0
 * Description: Main controller for Streamer Mode. Obfuscates or hides sensitive
 *              elements on Rumble (earnings, personal details, subscriptions, etc.)
 *              while streaming or screen-sharing.
 *
 * Core responsibilities
 * ─────────────────────
 * • Lifecycle
 *   - Ensures singleton activation via window.__RLO_STREAMER_ACTIVE__.
 *   - Exposes:
 *       • window.__RLOStreamerRun → reapply protections (called externally).
 *       • window.RLO_STREAMER_DISABLE → full teardown + restore.
 *   - Lifts precloak (applied by streamer-precloak.js) once masking is ready.
 *
 * • Style Injection
 *   - Adds <style id="rlo-streamer-styles"> with utility classes:
 *       .rlo-sm-blur   → blur + disable interaction (numbers, charts).
 *       .rlo-sm-secure → text inputs shown as •••• (text-security).
 *       .rlo-sm-select → hides text in <select>.
 *       .rlo-sm-hidden → completely hide nodes.
 *       .rlo-streamer-banner → pill banner showing “Streamer Mode active”.
 *   - Optional debug outline if <html> has .rlo-sm-debug.
 *
 * • Page-specific handlers
 *   - Profile (/account/profile):
 *       • Secures inputs (text, email, phone) + selects in .paymentInfoCon.
 *       • Hides political donation info form.
 *   - Verification (/account/verification):
 *       • Hides verified phone numbers block.
 *   - Recurring Subs (/account/recurring-subs):
 *       • Hides “Rumble Subscriptions” section.
 *   - Dashboard (/account/dashboard):
 *       • Blurs all earnings figures, charts, and legends.
 *
 * • General utilities
 *   - hideElement / unhideElement → toggle visibility with dataset restore.
 *   - secureInput / unsecureInput → mask sensitive input fields.
 *   - secureSelect / unsecureSelect → obfuscate select labels.
 *   - blurElement / unblurElement → apply/remove blur filter.
 *   - addBanner / removeBanner → show visual confirmation of Streamer Mode.
 *
 * • Enforcement
 *   - Interval “enforcer” (1500ms) continuously reapplies protection.
 *   - MutationObserver monitors DOM changes; re-secures elements dynamically.
 *
 * • Disable flow
 *   - Stops observer + timer.
 *   - Restores all blurred/hidden/secured elements.
 *   - Removes banner + lifts precloak.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

(() => {

    if (window.__RLO_STREAMER_ACTIVE__) {
        try {
            window.__RLOStreamerRun && window.__RLOStreamerRun();
        } catch {}
        return;
    }
    window.__RLO_STREAMER_ACTIVE__ = true;
    window.__RLO_STREAMER_PRESENT__ = true;

    const SLOG = (...a) => console.log('[RLO Streamer]', ...a);
    const WLOG = (...a) => console.warn('[RLO Streamer]', ...a);

    function liftPrecloak() {
        document.documentElement.classList.remove('rlo-precloak');
        document.getElementById('rlo-precloak-style')?.remove();
    }


    let observer = null;
    let enforcerTimer = null;

    function injectStyles() {
        if (document.getElementById('rlo-streamer-styles')) return;
        const style = document.createElement('style');
        style.id = 'rlo-streamer-styles';
        style.textContent = `
      .rlo-streamer-banner{
        display:inline-flex;align-items:center;gap:.5rem;
        background:#0ea5e9;color:#062;padding:.25rem .6rem;
        border-radius:999px;font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        margin:.25rem 0 .5rem 0;
      }

      .rlo-sm-blur{
        filter: blur(11px) saturate(.8) contrast(.9);
        transition: filter .15s ease;
        pointer-events: none;
        user-select: none;
      }
      /* For INPUT-like fields that should keep real value but shown as bullets */
      .rlo-sm-secure{
        -webkit-text-security: disc !important; /* Chrome/Edge/Safari */
        text-security: disc !important;         /* spec-ish */
      }
      /* For selects (no text-security support); hide label while keeping layout */
      .rlo-sm-select{
        color: transparent !important;
        text-shadow: 0 0 10px rgba(0,0,0,.5) !important;
        caret-color: transparent !important;
      }
      /* Hide completely */
      .rlo-sm-hidden{ display: none !important; }

      /* Helpful outline when you want to debug targets
         (toggle by adding rlo-sm-debug class on <html> if needed) */
      html.rlo-sm-debug .rlo-sm-blur,
      html.rlo-sm-debug .rlo-sm-secure,
      html.rlo-sm-debug .rlo-sm-select,
      html.rlo-sm-debug .rlo-sm-hidden { outline: 1px dashed #0ea5e9; }
    `;
        document.head.appendChild(style);
        SLOG('Styles injected.');
    }

    function addBanner(targetSection) {
        const BANNER_ID = 'rlo-streamer-banner';
        if (document.getElementById(BANNER_ID)) return;
        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.className = 'rlo-streamer-banner';
        banner.innerHTML = `🎥 Streamer Mode <strong>active</strong>`;
        if (targetSection) {
            targetSection.prepend(banner);
        } else {
            document.body.prepend(banner);
        }
    }

    function removeBanner() {
        document.getElementById('rlo-streamer-banner')?.remove();
    }

    function hideElement(el) {
        if (!el) return;
        if (el.dataset.rloSmHidden === '1') return;
        el.dataset.rloSmHidden = '1';

        if (!el.dataset.rloSmDisplay) {
            const d = el.style.display || '';
            el.dataset.rloSmDisplay = d;
        }
        el.classList.add('rlo-sm-hidden');
        SLOG('[Hide]', el);
    }

    function unhideElement(el) {
        if (!el) return;
        if (el.dataset.rloSmHidden === '1') {
            el.classList.remove('rlo-sm-hidden');
            const d = el.dataset.rloSmDisplay || '';
            if (d) el.style.display = d;
            else el.style.removeProperty('display');
            delete el.dataset.rloSmHidden;
            delete el.dataset.rloSmDisplay;
        }
    }

    function secureInput(input) {
        if (!input) return;
        if (input.dataset.rloSmSecured === '1') return;
        input.dataset.rloSmSecured = '1';

        input.classList.add('rlo-sm-secure');

        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        SLOG('[Secure Input]', input.name || input.id || input.placeholder || input);
    }

    function unsecureInput(input) {
        if (!input) return;
        if (input.dataset.rloSmSecured === '1') {
            input.classList.remove('rlo-sm-secure');
            delete input.dataset.rloSmSecured;
        }
    }

    function secureSelect(sel) {
        if (!sel) return;
        if (sel.dataset.rloSmSecured === '1') return;
        sel.dataset.rloSmSecured = '1';
        sel.classList.add('rlo-sm-select');
        SLOG('[Secure Select]', sel.name || sel.id || sel);
    }

    function unsecureSelect(sel) {
        if (!sel) return;
        if (sel.dataset.rloSmSecured === '1') {
            sel.classList.remove('rlo-sm-select');
            delete sel.dataset.rloSmSecured;
        }
    }

    function blurElement(el, label) {
        if (!el) return;
        if (el.dataset.rloSmBlurred === '1') return;
        el.dataset.rloSmBlurred = '1';
        el.classList.add('rlo-sm-blur');
        SLOG('[Blur]', label || el);
    }

    function unblurElement(el) {
        if (!el) return;
        if (el.dataset.rloSmBlurred === '1') {
            el.classList.remove('rlo-sm-blur');
            delete el.dataset.rloSmBlurred;
        }
    }

    const isRumble = () => location.hostname.endsWith('rumble.com');
    const path = () => location.pathname.replace(/\/+$/, '');

    const onProfile = () => path() === '/account/profile';
    const onVerification = () => path() === '/account/verification';
    const onRecurringSubs = () => path() === '/account/recurring-subs';
    const onDashboard = () => path() === '/account/dashboard';

    function applyProfile() {
        const section = document.querySelector('.paymentInfoCon');
        if (section) addBanner(section);
        else addBanner();

        if (section) {
            const inputs = section.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]');
            const selects = section.querySelectorAll('select');

            let countInputs = 0,
                countSelects = 0;
            inputs.forEach(inp => {
                secureInput(inp);
                countInputs++;
            });
            selects.forEach(sel => {
                secureSelect(sel);
                countSelects++;
            });

            SLOG(`[Profile] Secured ${countInputs} input(s), ${countSelects} select(s) in .paymentInfoCon`);
        } else {
            WLOG('[Profile] .paymentInfoCon not found');
        }

        const email = document.querySelector('#email.inital-fild.required, input#email[type="email"]');
        if (email) {
            secureInput(email);
            SLOG('[Profile] Secured standalone #email input');
        }

        const donateForm = document.querySelector('form#politicalDonationInfo.section-wrap');
        if (donateForm) {
            hideElement(donateForm);
            SLOG('[Profile] Hidden Political Donation Info form');
        }
    }

    function restoreProfile() {
        const section = document.querySelector('.paymentInfoCon');
        const inputs = section ? section.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]') : [];
        const selects = section ? section.querySelectorAll('select') : [];
        inputs.forEach(unsecureInput);
        selects.forEach(unsecureSelect);

        const email = document.querySelector('#email.inital-fild.required, input#email[type="email"]');
        unsecureInput(email);

        const donateForm = document.querySelector('form#politicalDonationInfo.section-wrap');
        unhideElement(donateForm);
    }

    function applyVerification() {
        addBanner();

        const headings = Array.from(document.querySelectorAll('h2'));
        const phoneH2 = headings.find(h => /verified phone numbers/i.test(h.textContent || ''));
        if (phoneH2) {
            const block = phoneH2.closest('div');
            if (block) {
                hideElement(block);
                SLOG('[Verification] Hidden verified phone numbers block');
            }
        } else {
            WLOG('[Verification] Could not find the verified phone numbers heading');
        }
    }

    function restoreVerification() {
        const headings = Array.from(document.querySelectorAll('h2'));
        const phoneH2 = headings.find(h => /verified phone numbers/i.test(h.textContent || ''));
        const block = phoneH2?.closest('div');
        unhideElement(block);
    }

    function applyRecurringSubs() {
        addBanner();

        const h3s = Array.from(document.querySelectorAll('h3'));
        const subH3 = h3s.find(h => /rumble subscriptions/i.test(h.textContent || ''));
        if (subH3) {
            const container = subH3.closest('div');
            if (container) {
                hideElement(container);
                SLOG('[Recurring Subs] Hidden "Rumble Subscriptions" section');
            }
        } else {
            WLOG('[Recurring Subs] Heading not found');
        }
    }

    function restoreRecurringSubs() {
        const h3s = Array.from(document.querySelectorAll('h3'));
        const subH3 = h3s.find(h => /rumble subscriptions/i.test(h.textContent || ''));
        const container = subH3?.closest('div');
        unhideElement(container);
    }

    function applyDashboard() {
        addBanner();

        const h5s = Array.from(document.querySelectorAll('h5'));
        const allTimeH5 = h5s.find(h => /all\s*time\s*earnings/i.test(h.textContent || ''));
        if (allTimeH5) {
            const container = allTimeH5.closest('div');
            const number = container?.parentElement?.querySelector('p.m-0.font-bold.text-2xl, p.font-bold.text-2xl');
            if (number) blurElement(number, 'All Time Earnings');
        }

        document.querySelectorAll('p.text-4xl.font-bold, p.hidden.md\\:block.m-0.text-4xl.font-bold')
            .forEach(el => blurElement(el, 'Big earnings figure (text-4xl)'));

        document.querySelectorAll('.js-dashboard__tabs-earnings')
            .forEach(el => blurElement(el, 'Tab earnings (.js-dashboard__tabs-earnings)'));

        document.querySelectorAll('.js-dashboard__charts-container')
            .forEach(el => blurElement(el, 'Charts canvas'));

        const legend = document.getElementById('js-dashboard__earnings-legend-container');
        if (legend) blurElement(legend, 'Earnings legend');

        SLOG('[Dashboard] Applied blur to: All-time, big figure(s), tab earnings, chart canvas, legend');
    }

    function restoreDashboard() {
        document.querySelectorAll('.rlo-sm-blur').forEach(unblurElement);
    }

    function runForCurrentPage() {
        injectStyles();

        if (!isRumble()) return;

        const p = path();

        SLOG('Enable called on', p);

        if (onProfile()) applyProfile();
        if (onVerification()) applyVerification();
        if (onRecurringSubs()) applyRecurringSubs();
        if (onDashboard()) applyDashboard();
        if (!enforcerTimer) {
            enforcerTimer = setInterval(() => {
                if (onProfile()) applyProfile();
                if (onVerification()) applyVerification();
                if (onRecurringSubs()) applyRecurringSubs();
                if (onDashboard()) applyDashboard();
            }, 1500);
        }

        if (!observer) {
            observer = new MutationObserver((muts) => {

                let shouldReapply = false;
                for (const m of muts) {
                    if (m.addedNodes && m.addedNodes.length) {
                        shouldReapply = true;
                        break;
                    }
                    if (m.type === 'attributes') {
                        shouldReapply = true;
                        break;
                    }
                }
                if (shouldReapply) {
                    if (onProfile()) applyProfile();
                    if (onVerification()) applyVerification();
                    if (onRecurringSubs()) applyRecurringSubs();
                    if (onDashboard()) applyDashboard();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true
            });
            SLOG('Observer attached.');
        }

        SLOG('Streamer Mode enabled.');
        return true;
    }

    function disable() {
        if (observer) {
            observer.disconnect();
            observer = null;
            SLOG('Observer disconnected.');
        }
        if (enforcerTimer) {
            clearInterval(enforcerTimer);
            enforcerTimer = null;
            SLOG('Enforcer timer cleared.');
        }
        if (onProfile()) restoreProfile();
        if (onVerification()) restoreVerification();
        if (onRecurringSubs()) restoreRecurringSubs();
        if (onDashboard()) restoreDashboard();

        document.querySelectorAll('.rlo-sm-blur').forEach(unblurElement);
        document.querySelectorAll('.rlo-sm-select').forEach(unsecureSelect);
        document.querySelectorAll('.rlo-sm-secure').forEach(unsecureInput);
        document.querySelectorAll('.rlo-sm-hidden').forEach(unhideElement);

        removeBanner();
        liftPrecloak();
        SLOG('Streamer Mode disabled; elements restored.');


        SLOG('Streamer Mode disabled; elements restored.');
    }

    window.__RLOStreamerRun = runForCurrentPage;
    window.RLO_STREAMER_DISABLE = disable;

    runForCurrentPage();
    SLOG('Streamer Mode enabled.');
    liftPrecloak();
    return true;

})();