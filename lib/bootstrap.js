// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * bootstrap.js — userscript-manager side of Shockr TA Tools (5.25.0).
 *
 * Not an ES module: build.js pastes this file as-is into the .user.js, after
 * `function __stBundle() { ...whole bundle... }`, and calls stBootstrap(__stBundle).
 *
 * With @grant GM_getValue/GM_setValue the manager runs the script in a sandbox,
 * where ClientLib, qx and the game objects are not reachable. So the bundle is
 * injected into the page as a <script> and talks to this side via window events
 * (see lib/config.js): it asks for the mirrored config ('st-gm-request') while
 * it loads, gets it back synchronously ('st-gm-config'), and reports every
 * config change ('st-config-changed'), which is written to GM storage. GM
 * storage is shared by all game hosts (cncappXX), localStorage is not.
 */
function stBootstrap(bundle) {
    const GM_KEY = 'st-config';
    const hasGm = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    function readGm() {
        try {
            const v = GM_getValue(GM_KEY, {});
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        } catch (e) {
            console.warn('[ST] GM config read failed:', e);
            return {};
        }
    }

    let requested = false;
    if (hasGm) {
        window.addEventListener('st-gm-request', () => {
            requested = true;
            window.dispatchEvent(new CustomEvent('st-gm-config', {
                detail: JSON.stringify({ config: readGm() }),
            }));
        });

        window.addEventListener('st-config-changed', (e) => {
            let change;
            try {
                change = JSON.parse(e.detail);
            } catch {
                return;
            }
            if (!change || typeof change.key !== 'string' || !change.key) return;
            // Read fresh each time: another tab (other host) may have written since
            const cfg = readGm();
            if ('value' in change) cfg[change.key] = change.value;
            else delete cfg[change.key];
            try {
                GM_setValue(GM_KEY, cfg);
            } catch (err) {
                console.warn('[ST] GM config write failed:', err);
            }
        });
    } else {
        console.warn('[ST] GM storage not available — config is not mirrored across game hosts');
    }

    // Synchronous: an inline script runs during appendChild, before the next line
    const script = document.createElement('script');
    script.textContent = '(' + bundle.toString() + ')();';
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    if (hasGm && !requested) {
        console.error('[ST] Bundle did not start in the page (script injection blocked?)');
    }
}
