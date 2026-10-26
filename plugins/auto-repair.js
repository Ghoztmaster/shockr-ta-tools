// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * auto-repair.js — repair damaged offense units (and, opt-in, buildings) automatically.
 *
 * Off by default — `/st plugin enable auto-repair`. Buildings are a separate
 * opt-in: `/st config set autorepair.buildings true` (default false).
 *
 * One repair path per kind, per own base (not ghost, not foreign):
 *   units:     city.get_CityRepairData().CanRepairAll(Vis.Mode.ArmySetup) → RepairAll(ArmySetup)
 *   buildings: city.get_CityRepairData().CanRepairAll(Vis.Mode.City)      → RepairAll(City)
 * The vis mode is only an argument: the view is never switched (petui's
 * building Autorepair does set_Mode(City) - not copied).
 *
 * Triggers:
 *   1. Units, right after an own attack: a pass-through observer on
 *      CommunicationManager.SendCommand / SendSimpleCommand (the same route
 *      MehrStrom's battle-intent logger uses) sees "InvokeBattle" and remembers
 *      the attacking base (`battleSetup.a`, else the current own base).
 *   2. Buildings, after an attack ON a base: every ALERT_POLL_MS the game's own
 *      under-attack flag `city.get_isAlerted()` (the flag PvpAlert reads; read
 *      here directly, so it works without PvpAlert) is checked; an alerted base
 *      is remembered. Only while autorepair.buildings is on.
 *   3. Safety net: every `autorepair.interval` minutes (default 5, minimum 1;
 *      read on every check) all own bases - units, plus buildings when on.
 * A remembered base is tried every TRIGGER_POLL_MS until it was repaired or
 * TRIGGER_WINDOW_MS passed. The window only starts counting once the base is
 * no longer alerted or locked (while it is, the deadline moves along): right
 * after a battle the damage may not be applied yet and the base is in lockdown.
 * The observer never blocks or changes the command.
 *
 * Never:
 *   - while the attack screen is open (Vis.Mode.CombatSetup): a repair in the
 *     middle of a TABS / MehrStrom simulation would change its numbers;
 *   - on a base with get_IsLocked() (lockdown) or, for buildings, while it is
 *     still under attack (get_isAlerted()).
 *
 * Mutually exclusive with RepairGuard (`excludes`): enabling one turns the
 * other off; if both are stored on at startup, RepairGuard wins
 * (`yieldsOnConflict`). RepairGuard also wraps CityRepair.RepairAll*, both
 * vis modes, so while it runs this plugin could not repair anyway.
 *
 * Verified live (Wilco, 2026-10-23, 5.29.0): units after an own attack.
 * NOT VERIFIED LIVE: the buildings route (CanRepairAll/RepairAll with
 * Vis.Mode.City on CityRepair) and when get_isAlerted() drops after a defense.
 * The console logs every trigger and CanRepairAll before and after every RepairAll.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';

const DEFAULT_INTERVAL_MIN = 5;
const MIN_INTERVAL_MIN = 1;
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const TRIGGER_POLL_MS = 3 * 1000;
const TRIGGER_WINDOW_MS = 3 * 60 * 1000;
const ALERT_POLL_MS = 5 * 1000;
const BATTLE_COMMAND = 'InvokeBattle';
const HOOKED_FUNCTIONS = ['SendCommand', 'SendSimpleCommand'];

/** kind -> vis mode name (the CityRepair argument) and chat keys. */
const KINDS = {
    units: { mode: 'ArmySetup', repaired: 'autoRepairRepaired', triggered: 'autoRepairAfterAttack' },
    buildings: { mode: 'City', repaired: 'autoRepairBuildingsRepaired', triggered: 'autoRepairBuildingsAfterAttack' },
};

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
        this._alertTimer = null;
        this._pending = new Map();     // "kind:id" -> { kind, id, until }
        this._hooks = [];              // { cm, fn, original, wrapper }
        this._lastRepairAt = 0;
        this._lastSkip = null;
        this._repairs = 0;
    }

    async start() {
        this.running = true;
        this._installHook();
        this._schedule(FIRST_CHECK_DELAY_MS);
        this._alertTimer = setInterval(() => this._alertTick(), ALERT_POLL_MS);
        chatMessage(`[ST] ${t('autoRepairEnabled', { min: this.intervalMin() })}`);
        if (this.buildingsOn()) chatMessage(`[ST] ${t('autoRepairBuildingsOn')}`);
        console.log(`[ST] AutoRepair: started (units after every attack + every ${this.intervalMin()} min; buildings ${this.buildingsOn() ? 'on' : 'off'})`);
    }

    stop() {
        this.running = false;
        if (this._timer) clearTimeout(this._timer);
        if (this._triggerTimer) clearTimeout(this._triggerTimer);
        if (this._alertTimer) clearInterval(this._alertTimer);
        this._timer = this._triggerTimer = this._alertTimer = null;
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
            ` · ${t(this.buildingsOn() ? 'autoRepairStatusBuildingsOn' : 'autoRepairStatusBuildingsOff')}` +
            (this._lastSkip ? ` · ${this._lastSkip}` : '');
    }

    /** Interval from `autorepair.interval`, default 5, at least 1 minute. */
    intervalMin() {
        const v = Number(this.config.get('autorepair.interval', DEFAULT_INTERVAL_MIN));
        if (!Number.isFinite(v)) return DEFAULT_INTERVAL_MIN;
        return Math.max(MIN_INTERVAL_MIN, v);
    }

    /** `autorepair.buildings` (default off); read every time, so a change applies at once. */
    buildingsOn() {
        const v = this.config.get('autorepair.buildings', false);
        return v === true || v === 'true' || v === 1;
    }

    // ─── Trigger 1: units, after an own attack ───────────────────────

    /** Wrap SendCommand / SendSimpleCommand once; the wrappers only watch. */
    _installHook() {
        let cm = null;
        try { cm = ClientLib.Net.CommunicationManager.GetInstance(); } catch { cm = null; }
        if (!cm) {
            console.warn('[ST] AutoRepair: CommunicationManager not found - no repair right after an attack, only the interval');
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

    _onBattle(args, via) {
        const setup = (args && args.battleSetup) || args || {};
        let id = (setup && setup.a !== undefined && setup.a !== null) ? setup.a : null;
        if (id === null) {
            try { id = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCityId(); } catch { id = null; }
        }
        if (id === null) return;
        console.log(`[ST] AutoRepair: attack from ${id} seen (${via}) - repairing units as soon as possible`);
        this._remember('units', id);
    }

    // ─── Trigger 2: buildings, after an attack on a base ─────────────

    _alertTick() {
        if (!this.running || !this.buildingsOn()) return;
        let all;
        try { all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d; } catch { return; }
        for (const city of Object.values(all)) {
            try {
                if (!city || !city.IsOwnBase() || city.get_IsGhostMode()) continue;
                if (typeof city.get_isAlerted !== 'function' || !city.get_isAlerted()) continue;
                const id = city.get_Id();
                if (!this._pending.has(`buildings:${id}`)) {
                    console.log(`[ST] AutoRepair: ${city.get_Name()} is under attack - repairing buildings once it is over`);
                }
                this._remember('buildings', id);
            } catch (err) {
                console.error('[ST] AutoRepair: alert check failed', err);
            }
        }
    }

    // ─── Remembered bases: try until repaired or the window ends ─────

    _remember(kind, id) {
        this._pending.set(`${kind}:${id}`, { kind, id, until: Date.now() + TRIGGER_WINDOW_MS });
        if (!this._triggerTimer) this._triggerTimer = setTimeout(() => this._triggerTick(), TRIGGER_POLL_MS);
    }

    _triggerTick() {
        this._triggerTimer = null;
        if (!this.running) return;
        const now = Date.now();
        const repaired = { units: [], buildings: [] };
        for (const [key, p] of [...this._pending]) {
            if (p.kind === 'buildings' && !this.buildingsOn()) {
                this._pending.delete(key);
                continue;
            }
            let status = 'wait';
            try { status = this._tryCity(p.id, p.kind); } catch (err) {
                console.error(`[ST] AutoRepair: ${p.id} - ${p.kind} repair failed`, err);
            }
            if (status === 'repaired' || status === 'gone') {
                this._pending.delete(key);
                if (status === 'repaired') repaired[p.kind].push(this._name(p.id));
            } else if (status === 'held') {
                p.until = now + TRIGGER_WINDOW_MS;       // under attack / locked: the window starts afterwards
            } else if (now >= p.until) {
                this._pending.delete(key);
                console.log(`[ST] AutoRepair: ${this._name(p.id)} - no ${p.kind} repaired within ${TRIGGER_WINDOW_MS / 1000} s; the interval takes over`);
            }
        }
        for (const kind of Object.keys(repaired)) {
            if (repaired[kind].length) this._repaired(kind, repaired[kind], true);
        }
        if (this._pending.size) this._triggerTimer = setTimeout(() => this._triggerTick(), TRIGGER_POLL_MS);
    }

    /** 'repaired' | 'held' (locked / under attack) | 'wait' (attack screen, nothing to repair yet) | 'gone' */
    _tryCity(id, kind) {
        if (this._inAttackScreen()) return 'wait';
        const city = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(id);
        if (!city || !city.IsOwnBase() || city.get_IsGhostMode()) return 'gone';
        if (city.get_IsLocked()) return 'held';
        if (kind === 'buildings' && typeof city.get_isAlerted === 'function' && city.get_isAlerted()) return 'held';
        return this._repairCity(city, kind) ? 'repaired' : 'wait';
    }

    // ─── Trigger 3: the interval ─────────────────────────────────────

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
     * One interval check: units of every own base, plus buildings when
     * autorepair.buildings is on.
     * @returns {{skipped: ?string, repaired: Array<string>, buildings: Array<string>, locked: Array<string>}}
     */
    check() {
        const result = { skipped: null, repaired: [], buildings: [], locked: [] };
        if (this._inAttackScreen()) {
            result.skipped = t('autoRepairSkipCombat');
            this._lastSkip = result.skipped;
            return result;
        }
        this._lastSkip = null;
        const withBuildings = this.buildingsOn();
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
                if (this._repairCity(city, 'units')) result.repaired.push(name);
                const attacked = typeof city.get_isAlerted === 'function' && city.get_isAlerted();
                if (withBuildings && !attacked && this._repairCity(city, 'buildings')) result.buildings.push(name);
            } catch (err) {
                console.error(`[ST] AutoRepair: ${name} - repair failed`, err);
            }
        }
        if (result.locked.length) {
            this._lastSkip = t('autoRepairSkipLocked', { bases: result.locked.join(', ') });
        }
        if (result.repaired.length) this._repaired('units', result.repaired, false);
        if (result.buildings.length) this._repaired('buildings', result.buildings, false);
        return result;
    }

    // ─── Shared ──────────────────────────────────────────────────────

    _inAttackScreen() {
        return ClientLib.Vis.VisMain.GetInstance().get_Mode() === ClientLib.Vis.Mode.CombatSetup;
    }

    /** RepairAll(<vis mode of kind>) if there is something to repair. @returns {boolean} repaired */
    _repairCity(city, kind) {
        const modeName = KINDS[kind].mode;
        const mode = ClientLib.Vis.Mode[modeName];
        const rep = city.get_CityRepairData();
        if (!rep || !rep.CanRepairAll(mode)) return false;
        rep.RepairAll(mode);
        const still = rep.CanRepairAll(mode);
        console.log(`[ST] AutoRepair: ${city.get_Name()} - RepairAll(${modeName}) called (${kind}); CanRepairAll before true, after ${still}`);
        return true;
    }

    _repaired(kind, names, triggered) {
        this._lastRepairAt = Date.now();
        this._repairs += names.length;
        const k = KINDS[kind];
        chatMessage(`[ST] ${t(triggered ? k.triggered : k.repaired, { bases: names.join(', ') })}`);
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
