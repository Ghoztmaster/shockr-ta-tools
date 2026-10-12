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
        this.isNew = true;   // no stored config at load time = fresh install
        this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            this.isNew = !raw;
            if (raw) this.data = JSON.parse(raw);
        } catch {
            this.data = {};
        }
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
