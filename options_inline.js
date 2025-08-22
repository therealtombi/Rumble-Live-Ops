/*!
 * Rumble Live Ops - options_inline.js
 * Version: v4.0.0
 * Description:
 *   Provides the inline logic for the "Reset Advert Filters" button in the Options UI.
 *
 * Core responsibilities
 * ─────────────────────
 * • Attaches a click handler to #reset-advert-filters-btn on the Options page.
 * • Locates an open Rumble Studio Campaigns or Passthrough tab via chrome.tabs.query.
 * • Sends a message → { type: 'rlo-reset-hidden-campaigns' } directly to that tab.
 * • Displays success/error feedback via the global showToast() (if present) or fallback alert().
 *
 * Flow
 * ────
 * 1. Wait for DOM ready.
 * 2. Bind click listener to reset button.
 * 3. On click:
 *    - Ensure a Campaigns or Passthrough tab is open.
 *    - If found → request that tab’s content script to reset its hidden advertisers list.
 *    - If successful → toast: "Advert filters reset. Hidden advertisers will reappear."
 *    - Else → toast error.
 *
 * Safety
 * ──────
 * • Gracefully no-ops if button is missing.
 * • Handles missing/closed Campaigns tab with a clear error toast.
 * • Catches and logs chrome.runtime.lastError when messaging fails.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

(function initResetAdvertFilters() {
    function toast(message, type = 'info') {
        if (typeof window.showToast === 'function') window.showToast(message, type);
        else alert(message);
    }

    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onReady(() => {
        const btn = document.getElementById('reset-advert-filters-btn');
        if (!btn) return;

        btn.addEventListener('click', () => {
            console.log('[RLO] Reset Advert Filters clicked');
            chrome.tabs.query({
                url: ["https://studio.rumble.com/campaigns", "https://studio.rumble.com/studio/passthrough/*"]
            }, (tabs) => {
                const activeTab = tabs.find(t => t.active) || tabs[0];
                if (!activeTab) {
                    toast('Please open a Rumble Campaigns or Studio Passthrough page first.', 'error');
                    return;
                }

                chrome.tabs.sendMessage(activeTab.id, {
                    type: 'rlo-reset-hidden-campaigns'
                }, (response) => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                        console.warn('[RLO] Reset failed:', err.message);
                        toast('Could not reset filters. Ensure a Campaigns page is open.', 'error');
                        return;
                    }
                    if (response && response.ok) {
                        toast('Advert filters reset. Hidden advertisers will reappear.', 'success');
                    } else {
                        toast('Reset failed.', 'error');
                    }
                });
            });
        });
    });
})();