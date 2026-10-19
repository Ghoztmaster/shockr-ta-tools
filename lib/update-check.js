// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * update-check.js — one in-game notice when a newer script version exists (5.25.0).
 *
 * Tampermonkey updates the script by itself through the header's @updateURL
 * (build.js) and keeps the script id + GM storage (the config mirror) while
 * doing so. This module only TELLS the player that an update is waiting, so
 * nobody updates through the dashboard's "Import" (new script id, GM storage
 * gone, key gone - the 5.25.0 work order's cause).
 *
 * Source: GET {api.url}/api/version - the alliance server's public endpoint for
 * config/version.json ({version, date, changelog}). Same server the plugins
 * use (api.url, or the 5.24.0 default); no url -> no check.
 *
 * The bundle runs in the page (lib/bootstrap.js injects it), so GM_info is not
 * reachable here: the own version is the ST_VERSION constant main.js passes in.
 *
 * Silent unless the server's version is semver-higher; one notice per page
 * load. Any failure (network, bad JSON, missing field) is silent too.
 */

const VERSION_PATH = '/api/version';
/** Give up on a slow server: the notice is informational, startup must not hang on it. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Compare two version strings numerically, part by part ("5.26.0" > "5.9.0").
 * Missing parts count as 0 ("5.26" == "5.26.0"); non-numeric parts as 0.
 * @returns {number} negative when a < b, 0 when equal, positive when a > b
 */
export function compareVersions(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
    }
    return 0;
}

function parse(v) {
    return String(v || '').trim().replace(/^v/i, '').split('.').map(p => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
}

/**
 * Ask the server for its version.
 * @param {string} baseUrl — api.url (trailing slash allowed); empty = no check
 * @param {string} current — the running script's version
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{newer: boolean, version: string|null}>} version = the server's, null when unknown/failed
 */
export async function checkForUpdate(baseUrl, current, fetchFn = globalThis.fetch) {
    const base = String(baseUrl || '').trim().replace(/\/$/, '');
    if (!base || typeof fetchFn !== 'function') return { newer: false, version: null };
    let timer = null;
    try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        if (ctrl) timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const resp = await fetchFn(base + VERSION_PATH, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
        if (!resp || !resp.ok) return { newer: false, version: null };
        const data = await resp.json();
        const version = data && typeof data.version === 'string' ? data.version.trim() : '';
        if (!version) return { newer: false, version: null };
        return { newer: compareVersions(version, current) > 0, version };
    } catch {
        return { newer: false, version: null };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Run the check once and hand a newer version to `notify(version)`.
 * Never throws, never notifies twice (also not when called again).
 * @param {{url: string, current: string, notify: (version: string) => void, fetchFn?: typeof fetch}} opts
 * @returns {Promise<string|null>} the newer version that was announced, else null
 */
let announced = false;
export async function announceUpdateOnce({ url, current, notify, fetchFn }) {
    if (announced) return null;
    const result = await checkForUpdate(url, current, fetchFn);
    if (!result.newer || announced) return null;
    announced = true;
    try {
        notify(result.version);
    } catch (e) {
        console.warn('[ST] Update notice failed:', e);
    }
    return result.version;
}

/** Tests only: forget that a notice was shown. */
export function _resetUpdateNotice() {
    announced = false;
}
