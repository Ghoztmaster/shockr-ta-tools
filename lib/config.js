/**
 * config.js — localStorage-based configuration for plugins.
 *
 * Each plugin can store key-value pairs under its own namespace.
 * Config persists across game sessions via localStorage.
 */
export class Config {
    /**
     * @param {string} storageKey — localStorage key for all config
     */
    constructor(storageKey = 'st-config') {
        this.storageKey = storageKey;
        this.data = {};
        this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) this.data = JSON.parse(raw);
        } catch {
            this.data = {};
        }
    }

    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        } catch (e) {
            console.warn('[ST] Config save failed:', e);
        }
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
