// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * config.js — localStorage-based configuration for plugins.
 *
 * Each plugin can store key-value pairs under its own namespace.
 * Config persists across game sessions via localStorage.
 *
 * 5.25.0: GM mirror. localStorage is per game host (cncappXX), the userscript
 * manager's storage (GM_getValue/GM_setValue) is not. The bootstrapper
 * (lib/bootstrap.js) runs in the manager's sandbox and hands its copy of the
 * config to the page via events; every change is sent back. localStorage stays
 * the primary store, GM is a best-effort mirror. Without a bootstrapper (no GM
 * storage, tests) Config works on localStorage alone, as before.
 *
 * Events (detail is a JSON string, so it crosses the sandbox/page boundary
 * in every browser):
 *   bundle → bootstrapper  'st-gm-request'                  (asks for the GM config)
 *   bootstrapper → bundle  'st-gm-config'   {config}        (answer, synchronous)
 *   bundle → bootstrapper  'st-config-changed' {key, value} (value absent = delete)
 */

/** localStorage key with what this host last sent to GM (base of the startup merge). */
const SYNC_SUFFIX = '-gm-sync';

/** GM config from the bootstrapper; null = no mirror available. */
let gmConfig = null;

/** Logged once when the config is gone from localStorage AND GM although this host synced before (5.25.0). */
export const CONFIG_LOST_MESSAGE = '[ST] Config niet gevonden in localStorage en GM-storage. Als je het script via "Importeren" hebt bijgewerkt, is je config gewist. Gebruik /st config import met je export-code, of /st register.';

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('st-gm-config', (e) => {
        try {
            const parsed = JSON.parse(e.detail);
            const cfg = parsed && parsed.config;
            gmConfig = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
        } catch {
            gmConfig = null;
        }
    });
    // The bootstrapper answers synchronously, so gmConfig is set before this module finishes.
    try {
        window.dispatchEvent(new CustomEvent('st-gm-request'));
    } catch { /* no CustomEvent: no mirror */ }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Startup merge of the local config with the GM mirror. Per key:
 *  - only GM has it          → take the GM value;
 *  - only local has it       → keep it (it goes to GM);
 *  - both, local unchanged since the last sync (equals `base`) and GM differs
 *                            → another host changed it: take the GM value;
 *  - otherwise (conflict, or no sync base yet) → local wins.
 * A key missing from GM never deletes a local one (GM storage can be wiped,
 * e.g. by reinstalling the script).
 * @returns {object} merged config (new object)
 */
export function mergeWithGm(local, gm, base) {
    const merged = { ...local };
    for (const [k, v] of Object.entries(gm || {})) {
        if (v === undefined || v === null) continue;
        if (!(k in merged)) {
            merged[k] = v;
        } else if (base && k in base && same(merged[k], base[k]) && !same(merged[k], v)) {
            merged[k] = v;
        }
    }
    return merged;
}

export class Config {
    /**
     * @param {string} storageKey — localStorage key for all config
     * @param {object|null} [gm] — GM mirror config; defaults to what the bootstrapper sent
     */
    constructor(storageKey = 'st-config', gm = gmConfig) {
        this.storageKey = storageKey;
        this.data = {};
        this.isNew = true;   // no stored config at load time = fresh install
        this.configLost = false; // 5.25.0: see load() - wiped config detected (chat notice in main.js)
        this._gm = gm && typeof gm === 'object' ? gm : null;
        this._synced = null; // what GM holds as far as we know (only with a mirror)
        this.load();
    }

    load() {
        let raw = null;
        try {
            raw = localStorage.getItem(this.storageKey);
            if (raw) this.data = JSON.parse(raw);
        } catch {
            this.data = {};
        }
        this.isNew = !raw;
        if (!this._gm) return;

        // With a mirror: an empty local config is not a fresh install when GM has one
        const base = this._readSync();
        // 5.25.0 diagnosis: no config here, none in GM, but this host DID sync to GM
        // before (the -gm-sync marker) -> the script was re-created (Tampermonkey
        // "Import": new script id, GM storage gone). One line, nothing else changes.
        this.configLost = !raw && base !== null && Object.keys(this._gm).length === 0;
        if (this.configLost) console.warn(CONFIG_LOST_MESSAGE);
        const before = JSON.stringify(this.data);
        this.data = mergeWithGm(this.data, this._gm, base);
        if (Object.keys(this._gm).length) this.isNew = false;
        this._synced = { ...this._gm };
        // Writes the merged result locally (if it changed) and sends GM what it lacks
        this.save(JSON.stringify(this.data) !== before);
        this._writeSync();
    }

    /**
     * Pin `<plugin>.enabled` for plugins whose default changed, so the new default
     * only reaches fresh installs. Unset key: fresh install -> the plugin's current
     * default, existing install -> the old default from `legacyDefaults`. A key the
     * player set is never touched. After this runs the key is always stored,
     * so later startups (when isNew is false) can't flip it.
     * @param {Array<{name: string, defaultEnabled?: boolean}>} plugins
     * @param {Object<string, boolean>} legacyDefaults — plugin name -> old default
     */
    pinChangedDefaults(plugins, legacyDefaults) {
        for (const plugin of plugins) {
            if (!(plugin.name in legacyDefaults)) continue;
            const key = `${plugin.name}.enabled`;
            if (this.get(key) !== undefined) continue;
            this.set(key, this.isNew ? plugin.defaultEnabled !== false : legacyDefaults[plugin.name]);
        }
    }

    /** @param {boolean} [writeLocal=true] — false: only mirror, localStorage is already current */
    save(writeLocal = true) {
        if (writeLocal) {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            } catch (e) {
                console.warn('[ST] Config save failed:', e);
            }
        }
        this._mirror();
    }

    /** Send every key that differs from what GM holds (also catches direct `data` writes, e.g. import). */
    _mirror() {
        if (!this._synced) return;
        const keys = new Set([...Object.keys(this.data), ...Object.keys(this._synced)]);
        let changed = false;
        for (const k of keys) {
            const v = this.data[k];
            if (same(v, this._synced[k])) continue;
            const detail = v === undefined ? { key: k } : { key: k, value: v };
            try {
                window.dispatchEvent(new CustomEvent('st-config-changed', { detail: JSON.stringify(detail) }));
            } catch { /* mirror is best effort */ }
            if (v === undefined) delete this._synced[k];
            else this._synced[k] = v;
            changed = true;
        }
        if (changed) this._writeSync();
    }

    _readSync() {
        try {
            const raw = localStorage.getItem(this.storageKey + SYNC_SUFFIX);
            const v = raw ? JSON.parse(raw) : null;
            return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
        } catch {
            return null;
        }
    }

    _writeSync() {
        try {
            localStorage.setItem(this.storageKey + SYNC_SUFFIX, JSON.stringify(this._synced));
        } catch { /* next startup merges without a base: local wins */ }
    }

    /**
     * Get a config value.
     * @param {string} key — dot-separated key, e.g. 'CampTracker.size'
     * @param {*} defaultValue — returned if key is not set
     */
    get(key, defaultValue = undefined) {
        const val = this.data[key.toLowerCase()];
        return val !== undefined ? val : defaultValue;
    }

    /**
     * Set a config value and persist.
     * @param {string} key
     * @param {*} value — pass undefined to delete
     */
    set(key, value) {
        const k = key.toLowerCase();
        if (value === undefined) {
            delete this.data[k];
        } else {
            this.data[k] = value;
        }
        this.save();
    }
}
