// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * auto-collect.js — collect the resource packages of every own base automatically.
 *
 * Off by default — `/st plugin enable auto-collect`. Interval:
 * `/st config set autocollect.interval <min>` (default 5, minimum 1; read on
 * every check, so a change applies from the next one).
 *
 * Per own base (not ghost): city.CanCollectResources() → city.CollectAllResources().
 * The same two ClientLib.Data.City calls MaelstromTools' "collect all packages"
 * uses (own implementation, facts = game API). The chat only reports a round
 * that collected something: "[ST] Collected packages on X bases".
 *
 * NOT VERIFIED LIVE: CanCollectResources / CollectAllResources on the current
 * client (they are not obfuscated in MaelstromTools). A missing function is
 * skipped and logged once; the console logs every collect.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';

const DEFAULT_INTERVAL_MIN = 5;
const MIN_INTERVAL_MIN = 1;
const FIRST_CHECK_DELAY_MS = 10 * 1000;

export class AutoCollect {
    /** Short description for `/st help`. */
    get description() { return t('descAutoCollect'); }

    constructor(config) {
        this.name = 'AutoCollect';
        this.defaultEnabled = false;
        this.config = config;
        this.running = false;
        this._timer = null;
        this._lastCollectAt = 0;
        this._rounds = 0;
        this._warnedMissing = false;
    }

    async start() {
        this.running = true;
        this._schedule(FIRST_CHECK_DELAY_MS);
        chatMessage(`[ST] ${t('autoCollectEnabled', { min: this.intervalMin() })}`);
        console.log(`[ST] AutoCollect: started (every ${this.intervalMin()} min)`);
    }

    stop() {
        this.running = false;
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
        console.log('[ST] AutoCollect: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return t('autoCollectStatusOff');
        const last = this._lastCollectAt
            ? new Date(this._lastCollectAt).toLocaleTimeString('de-DE', { hour12: false })
            : t('autoCollectNever');
        return t('autoCollectStatusOn', { min: this.intervalMin(), last, count: this._rounds });
    }

    /** Interval from `autocollect.interval`, default 5, at least 1 minute. */
    intervalMin() {
        const v = Number(this.config.get('autocollect.interval', DEFAULT_INTERVAL_MIN));
        if (!Number.isFinite(v)) return DEFAULT_INTERVAL_MIN;
        return Math.max(MIN_INTERVAL_MIN, v);
    }

    _schedule(ms) {
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this._timer = null;
            if (!this.running) return;
            try {
                this.collect();
            } catch (err) {
                console.error('[ST] AutoCollect: collect failed', err);
            }
            if (this.running) this._schedule(this.intervalMin() * 60 * 1000);
        }, ms);
    }

    /**
     * Collect the packages of every own, non-ghost base that has any.
     * @returns {Array<string>} names of the bases that were collected
     */
    collect() {
        const collected = [];
        const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
        for (const city of Object.values(all)) {
            let name = '?';
            try {
                if (!city || !city.IsOwnBase() || city.get_IsGhostMode()) continue;
                name = city.get_Name();
                if (typeof city.CanCollectResources !== 'function' || typeof city.CollectAllResources !== 'function') {
                    if (!this._warnedMissing) {
                        console.warn('[ST] AutoCollect: CanCollectResources / CollectAllResources not found on City - client changed?');
                        this._warnedMissing = true;
                    }
                    continue;
                }
                if (!city.CanCollectResources()) continue;
                city.CollectAllResources();
                collected.push(name);
                console.log(`[ST] AutoCollect: ${name} - CollectAllResources called`);
            } catch (err) {
                console.error(`[ST] AutoCollect: ${name} - collect failed`, err);
            }
        }
        if (collected.length) {
            this._lastCollectAt = Date.now();
            this._rounds++;
            chatMessage(`[ST] ${t('autoCollectCollected', { count: collected.length })}`);
        }
        return collected;
    }
}
