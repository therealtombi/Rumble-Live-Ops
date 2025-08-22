/*!
 * Rumble Live Ops - streamer-precloak.js
 * Version: v4.0.0
 * Description: Pre-injection cloaking script for Streamer Mode.
 *
 * Core responsibilities
 * ─────────────────────
 * • Purpose
 *   - Prevents a brief flash of unmasked content by hiding the page
 *     until Streamer Mode can safely apply its modifications.
 *
 * • Behavior
 *   - Injects a <style id="rlo-precloak-style"> with:
 *       html.rlo-precloak, html.rlo-precloak body { visibility:hidden !important; }
 *   - Immediately adds class "rlo-precloak" to <html>.
 *   - Leaves the page hidden until decision is made.
 *
 * • Feature check
 *   - Reads chrome.storage.local.functionStates['enable-streamer-mode'].
 *   - If Streamer Mode is disabled:
 *       • Removes class + style immediately → page visible as normal.
 *   - If enabled:
 *       • Keeps precloak active → streamer-mode.js is responsible for removing
 *         the cloak once masking/overlays are ready.
 *
 * • Safety
 *   - Wrapped in try/catch to avoid blocking page load if errors occur.
 *   - Appends <style> to document.head or documentElement if head not ready.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

(() => {
    try {
        const style = document.createElement('style');
        style.id = 'rlo-precloak-style';
        style.textContent = `
      html.rlo-precloak, html.rlo-precloak body { visibility: hidden !important; }
    `;
        (document.head || document.documentElement).appendChild(style);
        document.documentElement.classList.add('rlo-precloak');

        chrome.storage.local.get('functionStates', ({
            functionStates
        }) => {
            const on = !!functionStates?.['enable-streamer-mode'];
            if (!on) {
                document.documentElement.classList.remove('rlo-precloak');
                document.getElementById('rlo-precloak-style')?.remove();
            }
        });
    } catch {}
})();