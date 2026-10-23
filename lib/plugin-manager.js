// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * plugin-manager.js — turning plugins on and off, shared by startup,
 * `/st plugin enable|disable` and the Plugins panel in the toolbar (5.28.0).
 *
 * Every plugin toggles live (no F5): stop() undoes start(). A start that fails
 * is stopped again, so `running` is false and the next enable retries it; the
 * player gets the error in the chat instead of an "enabled" line.
 *
 * Plugins that add a block to the game's info panel (`appearsOnSelect`) only
 * render it on the panel's next `appear`: enabling one live says so.
 *
 * `excludes: ['Name']` = mutually exclusive: enabling one turns the other off
 * (AutoRepair <-> RepairGuard). At startup, if both are stored on, the one with
 * `yieldsOnConflict` is turned off (resolveConflicts).
 *
 * Menu: config `menu.hidden` lists the plugins the Plugins panel leaves out
 * (default: none, so a new plugin shows up). Config is mirrored to GM storage,
 * so the choice survives updates and world switches.
 */
import { t } from './i18n.js';

const MENU_HIDDEN_KEY = 'menu.hidden';

/** 'RepairGuard', 'repair-guard' and 'repair_guard' all match. */
const norm = (s) => String(s || '').toLowerCase().replace(/[-_]/g, '');

export class PluginManager {
    /**
     * @param {object} config
     * @param {Array<object>} plugins — in /st help and info-page order
     * @param {Function} say — chat line (main.js chatMessage)
     */
    constructor(config, plugins, say) {
        this.config = config;
        this.plugins = plugins;
        this._say = say;
    }

    /** Plugins the player gets to see (parked ones are built but not offered). */
    offered() {
        return this.plugins.filter(p => !p.parked);
    }

    find(name) {
        return this.plugins.find(p => norm(p.name) === norm(name)) || null;
    }

    isEnabled(plugin) {
        return this.config.get(`${plugin.name}.enabled`, plugin.defaultEnabled !== false);
    }

    /**
     * Start one plugin; a failure is reported and undone.
     * @returns {Promise<boolean>} started
     */
    async start(plugin) {
        try {
            await plugin.start();
            return true;
        } catch (err) {
            console.error(`[ST] ${plugin.name}: failed to start`, err);
            try {
                plugin.stop();
            } catch { /* half started: stop what it can */ }
            plugin.running = false;
            this._say(`[ST] ${t('pluginStartFailed', { name: plugin.name, error: err && err.message })}`);
            return false;
        }
    }

    /**
     * Turn a plugin on or off now and remember it; confirms in the chat.
     * A failed start is not stored as enabled.
     * @returns {Promise<boolean>} the plugin's state matches `on`
     */
    async setEnabled(plugin, on) {
        if (on) {
            // excludes: plugins that cannot run together with this one are turned
            // off first (and stored off), with a chat line saying why.
            for (const other of this._excluded(plugin)) {
                if (!other.running && !this.isEnabled(other)) continue;
                await this.setEnabled(other, false);
                this._say(`[ST] ${t('pluginExcludedOff', { off: other.name, on: plugin.name })}`);
            }
            if (!plugin.running && !(await this.start(plugin))) return false;
            this.config.set(`${plugin.name}.enabled`, true);
            this._say(`[ST] ${t('pluginEnabledMsg', { name: plugin.name })}`);
            if (plugin.appearsOnSelect) this._say(`[ST] ${t('pluginReselectHint', { name: plugin.name })}`);
            return true;
        }
        this.config.set(`${plugin.name}.enabled`, false);
        if (plugin.running) {
            try {
                plugin.stop();
            } catch (err) {
                console.error(`[ST] ${plugin.name}: failed to stop`, err);
            }
        }
        this._say(`[ST] ${t('pluginDisabledMsg', { name: plugin.name })}`);
        return true;
    }

    /** The plugins named in `plugin.excludes` (both sides should name each other). */
    _excluded(plugin) {
        return (plugin.excludes || []).map(n => this.find(n)).filter(p => p && p !== plugin);
    }

    /**
     * At startup, before any plugin starts: two enabled plugins that exclude each
     * other (an old config, or one edited by hand) - the one marked
     * `yieldsOnConflict` is stored off, with a chat line. Nothing is started here.
     * @returns {Array<string>} names turned off
     */
    resolveConflicts() {
        const off = [];
        for (const plugin of this.plugins) {
            if (!plugin.yieldsOnConflict || !this.isEnabled(plugin)) continue;
            const winner = this._excluded(plugin).find(o => this.isEnabled(o));
            if (!winner) continue;
            this.config.set(`${plugin.name}.enabled`, false);
            off.push(plugin.name);
            this._say(`[ST] ${t('pluginExcludedOff', { off: plugin.name, on: winner.name })}`);
        }
        return off;
    }

    // ─── Which plugins the panel shows ───────────────────────────────

    _hidden() {
        const v = this.config.get(MENU_HIDDEN_KEY, []);
        return Array.isArray(v) ? v : [];
    }

    inMenu(plugin) {
        return !this._hidden().includes(plugin.name);
    }

    setInMenu(plugin, show) {
        const hidden = this._hidden().filter(n => n !== plugin.name);
        if (!show) hidden.push(plugin.name);
        this.config.set(MENU_HIDDEN_KEY, hidden);
    }

    /** Offered plugins with inMenu() true, in order. */
    menuPlugins() {
        return this.offered().filter(p => this.inMenu(p));
    }
}
