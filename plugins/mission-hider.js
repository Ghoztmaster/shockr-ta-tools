// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * mission-hider.js — hide the mission tracker (the missions bar on the left).
 *
 * Off by default — `/st plugin enable mission-hider`; `disable` shows it again.
 *
 * The bar is app.getMissionsBar() (older clients: app.getMissionTracker(), as
 * MaelstromTools 0.1.5.5 falls back to). We set it to 'excluded' so the bars
 * below it move up, then app.triggerDesktopResize(). Should the game show it
 * again, a changeVisibility listener excludes it once more. Own
 * implementation; facts = game API.
 *
 * VERIFIED LIVE (2026-11-09): getMissionsBar() is
 * webfrontend.gui.missions.MissionsBar inside LeftBarsGroup; exclude() hides it
 * and the NotificationBar moves up; show() + triggerDesktopResize() restores it.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';

/** The missions bar widget, or null. */
export function missionsBar() {
    try {
        const app = qx.core.Init.getApplication();
        if (typeof app.getMissionsBar === 'function') return app.getMissionsBar();
        if (typeof app.getMissionTracker === 'function') return app.getMissionTracker();
    } catch { /* not loaded */ }
    return null;
}

function resizeDesktop() {
    try {
        const app = qx.core.Init.getApplication();
        if (typeof app.triggerDesktopResize === 'function') app.triggerDesktopResize();
    } catch { /* no resize */ }
}

export class MissionHider {
    /** Short description for `/st help`. */
    get description() { return t('descMissionHider'); }

    constructor(config) {
        this.name = 'MissionHider';
        this.defaultEnabled = false;
        this.config = config;
        this.running = false;
        this._bar = null;
        this._listenerId = null;
    }

    async start() {
        this.running = true;
        const bar = missionsBar();
        if (!bar) {
            console.warn('[ST] MissionHider: missions bar not found - client changed?');
            return;
        }
        this._bar = bar;
        this._hide();
        try {
            this._listenerId = bar.addListener('changeVisibility', () => {
                if (this.running && bar.getVisibility() !== 'excluded') this._hide();
            });
        } catch { this._listenerId = null; }
        chatMessage(`[ST] ${t('missionHiderEnabled')}`);
        console.log('[ST] MissionHider: mission tracker hidden');
    }

    stop() {
        this.running = false;
        const bar = this._bar;
        this._bar = null;
        if (!bar) return;
        try { if (this._listenerId !== null) bar.removeListenerById(this._listenerId); } catch { /* gone */ }
        this._listenerId = null;
        try { bar.show(); } catch { /* disposed */ }
        resizeDesktop();
        console.log('[ST] MissionHider: mission tracker shown again');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return t('missionHiderStatusOff');
        return this._bar ? t('missionHiderStatusOn') : t('missionHiderStatusNoBar');
    }

    _hide() {
        try {
            if (this._bar.getVisibility() === 'excluded') return;
            this._bar.exclude();
            resizeDesktop();
        } catch (err) {
            console.error('[ST] MissionHider: hide failed', err);
        }
    }
}
