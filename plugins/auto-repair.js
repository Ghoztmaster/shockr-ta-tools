// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * auto-repair.js — repair damaged offense units automatically.
 *
 * Off by default — `/st plugin enable auto-repair`.
 *
 * Two triggers, one repair path:
 *   1. After an own attack: a pass-through observer on
 *      CommunicationManager.SendCommand / SendSimpleCommand (the same route
 *      MehrStrom's battle-intent logger uses) sees "InvokeBattle" and remembers
 *      the attacking base (`battleSetup.a`, else the current own base). That
 *      base is then tried every TRIGGER_POLL_MS until it was repaired or
 *      TRIGGER_WINDOW_MS passed: right after InvokeBattle the damage may not be
 *      applied yet, or the base may still be locked. The observer never blocks
 *      or changes the command; it always calls the original with the same
 *      arguments.
 *   2. Safety net: every `autorepair.interval` minutes (default 5, minimum 1;
 *      read on every check) all own bases - for what the trigger missed.
 *
 * Per base (own, not ghost):
 *   city.get_CityRepairData().CanRepairAll(ClientLib.Vis.Mode.ArmySetup)
 *     → RepairAll(ClientLib.Vis.Mode.ArmySetup)
 * The vis mode is only an argument: the view is never switched (petui's
 * building Autorepair does set_Mode(City) - not copied). Units only, no
 * buildings. Route as in MaelstromTools' "Autorepair units".
 *
 * Never:
 *   - while the attack screen is open (Vis.Mode.CombatSetup): a repair in the
 *     middle of a TABS / MehrStrom simulation would change its numbers - the
 *     trigger keeps waiting until the screen is left (or its window ends);
 *   - on a base with get_IsLocked() (lockdown).
 *
 * Mutually exclusive with RepairGuard (`excludes`): enabling one turns the
 * other off; if both are stored on at startup, RepairGuard wins
 * (`yieldsOnConflict`). RepairGuard also wraps CityRepair.RepairAll*, so
 * while it runs this plugin could not repair anyway.
 *
 * NOT VERIFIED LIVE: whether the game sends InvokeBattle through SendCommand
 * or SendSimpleCommand (both are watched) and whether battleSetup.a is the
 * attacking base; whether CanRepairAll(ArmySetup) is also false when the
 * repair charge or crystal falls short, and whether the repair is instant.
 * The console logs the trigger and CanRepairAll before and after every RepairAll.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';

const DEFAULT_INTERVAL_MIN = 5;
const MIN_INTERVAL_MIN = 1;
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const TRIGGER_POLL_MS = 3 * 1000;
const TRIGGER_WINDOW_MS = 3 * 60 * 1000;
const BATTLE_COMMAND = 'InvokeBattle';
const HOOKED_FUNCTIONS = ['SendCommand', 'SendSimpleCommand'];

export class AutoRepair {
    /** Short description for `/st help`. */
    get description() { return t('descAutoRepair'); }

    constructor(config) {
        this.name = 'AutoRepair';
        this.defaultEnabled = false;
        this.excludes = ['RepairGuard'];
        this.yieldsOnConflict = true;
        this.config = config;
        this.running = false;
        this._timer = null;
        this._triggerTimer = null;
        this._pending = new Map();     // own city id -> deadline (ms)
        this._hooks = [];              // { cm, fn, original, wrapper }
        this._lastRepairAt = 0;
        this._lastSkip = null;
        this._repairs = 0;
    }

    async start() {
        this.running = true;
        this._installHook();
        this._schedule(FIRST_CHECK_DELAY_MS);
        chatMessage(`[ST] ${t('autoRepairEnabled', { min: this.intervalMin() })}`);
        console.log(`[ST] AutoRepair: started (after every attack + every ${this.intervalMin()} min)`);
    }

    stop() {
        this.running = false;
        if (this._timer) clearTimeout(this._timer);
        if (this._triggerTimer) clearTimeout(this._triggerTimer);
        this._timer = this._triggerTimer = null;
        this._pending.clear();
        this._removeHook();
        console.log('[ST] AutoRepair: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return t('autoRepairStatusOff');
        const last = this._lastRepairAt
            ? new Date(this._lastRepairAt).toLocaleTimeString('de-DE', { hour12: false })
            : t('autoRepairNever');
        return t('autoRepairStatusOn', { min: this.intervalMin(), last, count: this._repairs }) +
            (this._lastSkip ? ` · ${this._lastSkip}` : '');
    }

    /** Interval from `autorepair.interval`, default 5, at least 1 minute. */
    intervalMin() {
        const v = Number(this.config.get('autorepair.interval', DEFAULT_INTERVAL_MIN));
        if (!Number.isFinite(v)) return DEFAULT_INTERVAL_MIN;
        return Math.max(MIN_INTERVAL_MIN, v);
    }

    // ─── Trigger 1: after an own attack ──────────────────────────────

    /** Wrap SendCommand / SendSimpleCommand once; the wrappers only watch. */
    _installHook() {
        let cm = null;
        try { cm = ClientLib.Net.CommunicationManager.GetInstance(); } catch { cm = null; }
        if (!cm) {
            console.warn('[ST] AutoRepair: CommunicationManager not found - only the interval runs');
            return;
        }
        const plugin = this;
        for (const fn of HOOKED_FUNCTIONS) {
            const original = cm[fn];
            if (typeof original !== 'function') continue;
            const wrapper = function (name, args) {
                try {
                    if (plugin.running && name === BATTLE_COMMAND) plugin._onBattle(args, fn);
                } catch (err) {
                    console.error('[ST] AutoRepair: battle observer failed', err);
                }
                return original.apply(this, arguments);
            };
            cm[fn] = wrapper;
            this._hooks.push({ cm, fn, original, wrapper });
        }
    }

    /** Put the originals back - only where nobody wrapped on top of us since. */
    _removeHook() {
        for (const h of this._hooks) {
            if (h.cm[h.fn] === h.wrapper) h.cm[h.fn] = h.original;
            // else: another script wrapped after us; our wrapper stays in the chain
            // but is inert (`running` is false).
        }
        this._hooks = [];
    }

    /** InvokeBattle seen: try the attacking base until repaired or the window ends. */
    _onBattle(args, via) {
        const setup = (args && args.battleSetup) || args || {};
        let id = (setup && setup.a !== undefined && setup.a !== null) ? setup.a : null;
        if (id === null) {
            try { id = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCityId(); } catch { id = null; }
        }
        if (id === null) return;
        this._pending.set(id, Date.now() + TRIGGER_WINDOW_MS);
        console.log(`[ST] AutoRepair: attack from ${id} seen (${via}) - repairing as soon as possible`);
        if (!this._triggerTimer) this._triggerTimer = setTimeout(() => this._triggerTick(), TRIGGER_POLL_MS);
    }

    _triggerTick() {
        this._triggerTimer = null;
        if (!this.running) return;
        const now = Date.now();
        const repaired = [];
        for (const [id, until] of [...this._pending]) {
            let status = 'wait';
            try { status = this._tryCity(id); } catch (err) {
                console.error(`[ST] AutoRepair: ${id} - repair failed`, err);
            }
            if (status === 'repaired' || status === 'gone') {
                this._pending.delete(id);
                if (status === 'repaired') repaired.push(this._name(id));
            } else if (now >= until) {
                this._pending.delete(id);
                console.log(`[ST] AutoRepair: ${this._name(id)} - nothing repaired within ${TRIGGER_WINDOW_MS / 1000} s after the attack (${status}); the interval takes over`);
            }
        }
        if (repaired.length) this._repaired(repaired, true);
        if (this._pending.size) this._triggerTimer = setTimeout(() => this._triggerTick(), TRIGGER_POLL_MS);
    }

    /** 'repaired' | 'wait' (attack screen, locked or no damage yet) | 'gone' (no own base). */
    _tryCity(id) {
        if (this._inAttackScreen()) return 'wait';
        const city = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id);
        if (!city || !city.IsOwnBase() || city.get_IsGhostMode()) return 'gone';
        if (city.get_IsLocked()) return 'wait';
        return this._repairCity(city) ? 'repaired' : 'wait';
    }

    // ─── Trigger 2: the interval ─────────────────────────────────────

    _schedule(ms) {
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => {
            this._timer = null;
            if (!this.running) return;
            try {
                this.check();
            } catch (err) {
                console.error('[ST] AutoRepair: check failed', err);
            }
            if (this.running) this._schedule(this.intervalMin() * 60 * 1000);
        }, ms);
    }

    /**
     * One interval check: repair every own base whose units can be repaired.
     * @returns {{skipped: ?string, repaired: Array<string>, locked: Array<string>}}
     */
    check() {
        const result = { skipped: null, repaired: [], locked: [] };
        if (this._inAttackScreen()) {
            result.skipped = t('autoRepairSkipCombat');
            this._lastSkip = result.skipped;
            return result;
        }
        this._lastSkip = null;
        const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
        for (const city of Object.values(all)) {
            let name = '?';
            try {
                if (!city || !city.IsOwnBase() || city.get_IsGhostMode()) continue;
                name = city.get_Name();
                if (city.get_IsLocked()) {
                    result.locked.push(name);
                    continue;
                }
                if (this._repairCity(city)) result.repaired.push(name);
            } catch (err) {
                console.error(`[ST] AutoRepair: ${name} - repair failed`, err);
            }
        }
        if (result.locked.length) {
            this._lastSkip = t('autoRepairSkipLocked', { bases: result.locked.join(', ') });
        }
        if (result.repaired.length) this._repaired(result.repaired, false);
        return result;
    }

    // ─── Shared ──────────────────────────────────────────────────────

    _inAttackScreen() {
        return ClientLib.Vis.VisMain.GetInstance().get_Mode() === ClientLib.Vis.Mode.CombatSetup;
    }

    /** RepairAll(ArmySetup) if there is something to repair. @returns {boolean} repaired */
    _repairCity(city) {
        const Mode = ClientLib.Vis.Mode;
        const rep = city.get_CityRepairData();
        if (!rep || !rep.CanRepairAll(Mode.ArmySetup)) return false;
        rep.RepairAll(Mode.ArmySetup);
        const still = rep.CanRepairAll(Mode.ArmySetup);
        console.log(`[ST] AutoRepair: ${city.get_Name()} - RepairAll(ArmySetup) called; CanRepairAll before true, after ${still}`);
        return true;
    }

    _repaired(names, afterAttack) {
        this._lastRepairAt = Date.now();
        this._repairs += names.length;
        chatMessage(`[ST] ${t(afterAttack ? 'autoRepairAfterAttack' : 'autoRepairRepaired', { bases: names.join(', ') })}`);
    }

    _name(id) {
        try {
            const c = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id);
            return c ? c.get_Name() : String(id);
        } catch {
            return String(id);
        }
    }
}
