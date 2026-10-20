// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * stabs.js — STABS, Shockr Tiberium Alliances Battle Sim (plugin 25, 5.27.0).
 *
 * Gebaseerd op TABS V2 door Eistee, TheStriker, VisiG, Lobotommi, XDaast;
 * onderhouden door NetquiK [SoO]. Herbouwd voor Shockr.
 * (TABS has no license - only NetquiK's pack is GPL - so the logic was read
 * and rewritten, no TABS code is copied; see docs/LICENTIES_DERDEN.md.
 * ClientLib calls and data layouts are the game's.)
 *
 * Phase 1 — simulate and show the statistics, as TABS does:
 *   - a Simulate button next to the view-swap button in the attack setup bar
 *     (NUM 0); a cached formation opens the panel instead of simulating again;
 *   - auto simulate (stabs.autoSimulate, default on): every formation change
 *     in the attack setup is simulated unless it is in the cache;
 *   - the server allows one simulation per 3 s: a request in that time waits
 *     and runs once the lock ends (the button counts down);
 *   - the statistics window (toolbar item or NUM 7), in the game's own style
 *     (plugins/stabs-window.js), two columns as TABS at its default width:
 *     "live" (the current formation) and the preset "CY" (the best cached
 *     simulation for the construction yard). Per column: outcome, duration,
 *     base, morale; Defender HP left; own repair costs; loot; buttons to load
 *     that column's formation and simulate it, and to view it (replay, with a
 *     back button to the attack setup). A result for another formation is
 *     dimmed. Opens by itself in the attack setup (stabs.panel.open), position
 *     in stabs.panel.x/y, sections fold (stabs.section.*).
 * The numbers come from plugins/stabs-stats.js (TABS' rules).
 *
 * Only active when TABS is not loaded: two simulators on the same screen
 * confuse. With TABS present STABS stays idle and says so in /st status.
 *
 * Client:
 *   cities.get_CurrentOwnCity().get_CityArmyFormationsManager()
 *     .GetFormationByTargetBaseId(cities.get_CurrentCityId()).get_ArmyUnits().l
 *   target.CheckInvokeBattle(own, true) === EAttackBaseResult.OK
 *   CommunicationManager.SendSimpleCommand('SimulateBattle',
 *     { battleSetup: { d: targetId, a: ownId, u: [{i: unitId, x, y}], s: 0 } }, delegate, null)
 *   repair: API.Util.GetUnitRepairCosts(level, mdbId, ratio) for the current
 *     city; for the offense TABS makes the own base current while counting
 *     (set_CurrentCityId), unless the client has GetOwnUnitRepairCosts
 *   loot: API.Battleground.GetInstance().GetLootFromCurrentCity()
 * Formation changes are noticed by reading the formation every 300 ms, only
 * while the attack setup is open.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import {
    RES, computeStats, formationKey, mergeFormation, SimCache, PRESETS, columnCells, visibleEnemyRows,
} from './stabs-stats.js';
import { StatsWindow, IMG } from './stabs-window.js';

const TOOLBAR_ID = 'stabs';
/** The server takes one simulation per this many ms (TABS: since patch 16.2). */
const SIM_LOCK_MS = 3000;
const TICK_MS = 300;
const KEY_NUM0 = 96;
const KEY_NUM7 = 103;


/** True when TABS V2 runs in this page (its main qx class is the global TABS). */
export function tabsLoaded(win = window) {
    try {
        if (typeof win.TABS !== 'undefined') return true;
        return !!(win.qx && win.qx.Class && win.qx.Class.getByName && win.qx.Class.getByName('TABS'));
    } catch {
        return false;
    }
}

// ─── Client access ───────────────────────────────────────────────────

function mainData() {
    return ClientLib.Data.MainData.GetInstance();
}

function cities() {
    return mainData().get_Cities();
}

function viewMode() {
    try { return ClientLib.Vis.VisMain.GetInstance().get_Mode(); } catch { return null; }
}

function inReplay() {
    try {
        return qx.core.Init.getApplication().getPlayArea().getViewMode() === ClientLib.Data.PlayerAreaViewMode.pavmCombatReplay;
    } catch {
        return false;
    }
}

/** Target loaded and drawn (TABS waits for this before reading or simulating). */
function targetReady() {
    try {
        const city = cities().get_CurrentCity();
        return !!city && city.get_Version() >= 0 && ClientLib.Vis.VisMain.GetInstance().GetActiveView().get_VisAreaComplete();
    } catch {
        return false;
    }
}

/** The offense formation against the viewed target (TABS.UTIL.Formation.Get), or null. */
export function readFormation() {
    try {
        const c = cities();
        const own = c.get_CurrentOwnCity();
        if (!own) return null;
        const formation = own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(c.get_CurrentCityId());
        const units = formation && formation.get_ArmyUnits();
        if (!units) return null;
        return units.l.map((u) => {
            const carried = u.get_IsTransportedCityEntity();
            const carrying = u.get_TransportedCityEntity();
            return {
                id: u.get_Id(),
                gid: carried ? u.get_TransporterCityEntity().get_Id() : (carrying !== null ? carrying.get_Id() : 0),
                gs: carried ? 2 : (carrying !== null ? 1 : 0),
                i: u.get_MdbUnitId(),
                l: u.get_CurrentLevel(),
                h: Math.ceil(u.get_Health()),
                enabled: u.get_Enabled(),
                x: u.get_CoordX(),
                y: u.get_CoordY(),
                t: carried,
            };
        });
    } catch {
        return null;
    }
}

/** What the cache checks its entries against. */
function cacheState(targetId, ownId) {
    const c = cities();
    const target = c.GetCity(targetId);
    const own = c.GetCity(ownId);
    let poi = null;
    try {
        const alliance = mainData().get_Alliance();
        if (alliance) poi = { air: alliance.get_POIAirBonus(), inf: alliance.get_POIInfantryBonus(), veh: alliance.get_POIVehicleBonus() };
    } catch { /* no bonuses */ }
    return {
        version: target ? target.get_Version() : -1,
        own: own ? { version: own.get_Version(), recovery: own.get_hasRecovery(), poi } : null,
    };
}

function enums() {
    const B = ClientLib.Base;
    const T = B.ETechName;
    return {
        GDI: B.EFactionType.GDIFaction,
        NOD: B.EFactionType.NODFaction,
        Offense: B.EPlacementType.Offense,
        Feet: B.EUnitMovementType.Feet,
        Wheel: B.EUnitMovementType.Wheel,
        Track: B.EUnitMovementType.Track,
        Air: B.EUnitMovementType.Air,
        Air2: B.EUnitMovementType.Air2,
        Structure: B.EUnitMovementType.Structure,
        ArmorNone: B.EArmorType.NONE,
        tech: {
            cy: T.Construction_Yard, cc: T.Command_Center, barracks: T.Barracks, factory: T.Factory,
            airport: T.Airport, df: T.Defense_Facility, dhq: T.Defense_HQ,
            support: [T.Support_Air, T.Support_Ion, T.Support_Art],
        },
    };
}

/** Positions of the target's key buildings; {} when the target is unknown. */
function buildingInfo(targetId) {
    const city = cities().GetCity(targetId);
    if (!city) return {};
    const bd = city.get_CityBuildingsData();
    const T = ClientLib.Base.ETechName;
    const unique = (name) => bd.GetUniqueBuildingByTechName(name);
    const pos = (b) => (b ? { x: b.get_CoordX(), y: b.get_CoordY() } : null);
    return {
        cy: pos(unique(T.Construction_Yard) || bd.GetBuildingByMDBId(ClientLib.Base.ETech.FOR_Fortress_ConstructionYard)),
        cc: pos(unique(T.Command_Center)),
        barracks: pos(unique(T.Barracks)),
        factory: pos(unique(T.Factory)),
        airport: pos(unique(T.Airport)),
        df: pos(unique(T.Defense_Facility)),
        dhq: pos(unique(T.Defense_HQ)),
        support: pos(unique(T.Support_Air) || unique(T.Support_Art) || unique(T.Support_Ion)),
    };
}

/** The ClientLib side of computeStats. */
export function clientEnv(data) {
    const E = enums();
    const util = ClientLib.API.Util;
    const resMain = ClientLib.Res.ResMain.GetInstance();
    const hpOverride = ClientLib.Base.EUnitModuleType.HitpointOverride;
    const ownCosts = typeof util.GetOwnUnitRepairCosts === 'function';
    return {
        E,
        unit: (mdbId) => resMain.GetUnit_Obj(mdbId),
        maxHealth(level, unit, bonus, modules) {
            const mod = (unit.m || []).find(m => m.t === hpOverride);
            const u = mod && (modules || []).indexOf(mod.i) !== -1 ? Object.assign({}, unit, { lp: mod.h }) : unit;
            return Math.floor(util.GetUnitMaxHealthByLevel(level, u, bonus)) * 16;
        },
        techName: (unit) => parseInt(ClientLib.Base.Tech.GetTechNameFromTechId(unit.tl, unit.f), 10),
        repairCosts(unit, mdbId, level, ratio) {
            if (unit.pt !== E.Offense || !ownCosts) {
                return cities().get_CurrentCity() !== null ? util.GetUnitRepairCosts(level, mdbId, ratio) : null;
            }
            return util.GetOwnUnitRepairCosts(level, mdbId, ratio);
        },
        buildingInfo: buildingInfo(data.d.di),
        asAttacker(fn) {
            if (ownCosts) return fn();
            const c = cities();
            c.set_CurrentCityId(data.d.ai);
            try {
                fn();
            } finally {
                c.set_CurrentCityId(data.d.di);
            }
        },
    };
}

function timespan(seconds) {
    try { return webfrontend.phe.cnc.Util.getTimespanString(seconds); } catch { return `${Math.round(seconds)} s`; }
}

function compact(n) {
    try { return webfrontend.phe.cnc.gui.util.Numbers.formatNumbersCompact(n); } catch { return String(Math.round(n)); }
}

function lootFromCurrentCity() {
    try {
        const list = ClientLib.API.Battleground.GetInstance().GetLootFromCurrentCity();
        if (list === null) return null;
        const loot = {};
        for (const r of list) loot[r.Type] = r.Count;
        return loot;
    } catch {
        return null;
    }
}

/** Morale against the shown target: { text, level: 0|1|2, value } (TABS __updateBattleMoral). */
function morale(cityId, ownId) {
    const c = cities();
    const target = c.GetCity(cityId);
    const own = c.GetCity(ownId);
    if (!target || !own) return null;
    const sign = ClientLib.Base.Util.GetMoralSignType(own.get_LvlOffense(), target.get_LvlBase());
    let center = null;
    try { center = mainData().get_EndGame().GetCenter().get_CombatId(); } catch { /* no end game */ }
    if (mainData().get_Server().get_CombatUseMoral() && target.IsNPC() && target.get_Id() !== center
        && (sign.k === 1 || sign.k === 2)) {
        return { text: `~${100 - sign.v}%`, level: sign.k, value: sign.v };
    }
    return { text: '100%', level: 0, value: 0 };
}

// ─── Plugin ──────────────────────────────────────────────────────────

export class Stabs {
    /** Short description for `/st help`. */
    get description() { return t('descStabs'); }

    constructor(config, toolbar) {
        this.name = 'STABS';
        // Parked (5.27.0): built but off - TABS is maintained separately. Not in /st help,
        // plugins.json or the Shockr toolbar; /st plugin enable stabs still works for testing.
        this.defaultEnabled = false;
        this.parked = true;
        this.config = config;
        this.toolbar = toolbar;
        this.running = false;
        this.tabsActive = false;
        this.cache = new SimCache();
        this._events = [];
        this._timer = null;
        this._button = null;
        this._win = null;          // StatsWindow
        this._backButton = null;   // replay overlay: back to the attack setup
        this._replayTarget = null; // target id of the replay we started
        this._lock = false;
        this._lockUntil = 0;
        this._lockTimer = null;
        this._request = false;
        this._formationSig = null;
        this._shown = null;        // { key, entry } of the live column
        this._columns = {};        // column id -> { key, entry } shown there
        this._dirty = true;
        this._onKeyDown = (e) => this._hotkey(e);
    }

    async start() {
        this.running = true;
        this.tabsActive = false;
        if (tabsLoaded()) {
            this._goIdle();
            return;
        }
        if (!this.parked) {
            this.toolbar.register({
                id: TOOLBAR_ID,
                icon: ICONS.sim,
                label: () => t('toolbarStabs'),
                onClick: () => this.togglePanel(),
            });
        }
        this._attach(ClientLib.Vis.VisMain.GetInstance(), 'ViewModeChange', ClientLib.Vis.ViewModeChange, this._onViewChanged);
        this._attach(cities(), 'CurrentChange', ClientLib.Data.CurrentCityChange, this._onCityChange);
        this._onViewChanged(null, viewMode());
    }

    stop() {
        this.running = false;
        this._teardown();
        this.cache = new SimCache();
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return '/st plugin enable stabs';
        if (this.tabsActive) return t('stabsStatusTabs');
        return t('stabsStatus', { n: this._cacheCount() });
    }

    /**
     * /st status: "inactive — TABS detected" instead of "on" while TABS runs.
     * Checked live: TABS may load after STABS started.
     */
    statusState() {
        if (!this.running) return null;
        if (!this.tabsActive && tabsLoaded()) this._goIdle();
        return this.tabsActive ? t('stabsInactiveTabs') : null;
    }

    // ── Lifecycle ──

    /** TABS runs here: drop everything and stay idle. */
    _goIdle() {
        if (!this.tabsActive) chatMessage(`[ST] ${t('stabsTabsDetected')}`);
        this.tabsActive = true;
        this._teardown();
        console.log('[ST] STABS: TABS is loaded - staying inactive');
    }

    _teardown() {
        for (const ev of this._events) {
            try { webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb); } catch { /* ignore */ }
        }
        this._events = [];
        this._stopTimer();
        clearTimeout(this._lockTimer);
        this._lockTimer = null;
        this._lock = false;
        this._request = false;
        document.removeEventListener('keydown', this._onKeyDown);
        this.toolbar.unregister(TOOLBAR_ID);
        if (this._button) {
            try {
                const parent = this._button.getLayoutParent();
                if (parent) parent.remove(this._button);
                this._button.dispose();
            } catch { /* ignore */ }
            this._button = null;
        }
        if (this._win) this._win.dispose();
        this._win = null;
        if (this._backButton) {
            try {
                const parent = this._backButton.getLayoutParent();
                if (parent) parent.remove(this._backButton);
                this._backButton.dispose();
            } catch { /* ignore */ }
            this._backButton = null;
        }
        this._shown = null;
        this._columns = {};
    }

    _attach(source, name, type, cb) {
        webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
        this._events.push({ source, name, type, cb });
    }

    _onViewChanged(oldMode, newMode) {
        const V = ClientLib.Vis.Mode;
        if (newMode === V.CombatSetup) {
            this._ensureButton();
            if (this._button) this._button.show();
            document.addEventListener('keydown', this._onKeyDown);
            this._formationSig = null;
        } else if (oldMode === V.CombatSetup) {
            if (this._button) this._button.hide();
            document.removeEventListener('keydown', this._onKeyDown);
        }
        if ((newMode === V.CombatSetup || newMode === V.Battleground)
            && this.config.get('stabs.panel.open', true) && !inReplay() && !this.isPanelOpen()) {
            this.openPanel();
        }
        if (newMode !== V.CombatSetup && newMode !== V.Battleground && newMode !== V.City) this.closePanel();
        this._syncTimer();
    }

    _onCityChange(oldId, newId) {
        if (cities().GetCity(newId) === null) this._shown = null;
        this._dirty = true;
    }

    /** The tick runs while the attack setup or the panel is open. */
    _syncTimer() {
        const needed = viewMode() === ClientLib.Vis.Mode.CombatSetup || this.isPanelOpen();
        if (needed && !this._timer) {
            this._timer = setInterval(() => this._tick(), TICK_MS);
            this._tick();
        } else if (!needed) {
            this._stopTimer();
        }
    }

    _stopTimer() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }

    _tick() {
        if (tabsLoaded()) {
            this._goIdle();
            return;
        }
        try {
            if (viewMode() === ClientLib.Vis.Mode.CombatSetup) this._watchFormation();
            this._updateButton();
            if (this.isPanelOpen()) this._render();
        } catch (e) {
            console.warn('[ST] STABS: tick failed', e);
        }
    }

    /** A formation change (move, enable/disable) marks the panel dirty and, with auto simulate, simulates. */
    _watchFormation() {
        if (!targetReady()) return;
        const formation = readFormation();
        const sig = formation ? `${cities().get_CurrentCityId()}#${JSON.stringify(formation.map(u => [u.id, u.x, u.y, u.enabled, u.h]))}` : null;
        if (sig === this._formationSig) return;
        this._formationSig = sig;
        this._dirty = true;
        if (formation && formation.length && this.config.get('stabs.autoSimulate', true) && !this._cachedEntry(formation)) {
            this.simulate();
        }
    }

    _hotkey(e) {
        const el = e.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        if (e.keyCode === KEY_NUM0) this._onSimulateClick();
        else if (e.keyCode === KEY_NUM7) this.togglePanel();
    }

    // ── Simulation ──

    _cachedEntry(formation) {
        const c = cities();
        const ownId = c.get_CurrentOwnCityId();
        const targetId = c.get_CurrentCityId();
        if (!formation || ownId === null || targetId === null) return null;
        return this.cache.check(targetId, formationKey(formation, ownId), cacheState(targetId, ownId));
    }

    _onSimulateClick() {
        if (this._cachedEntry(readFormation())) {
            this.openPanel();
            return;
        }
        this.simulate();
    }

    /** Simulate the current formation; during the 3 s lock it runs once the lock ends. */
    simulate() {
        if (this._lock) {
            this._request = true;
            return;
        }
        const c = cities();
        const own = c.get_CurrentOwnCity();
        const target = c.get_CurrentCity();
        if (!own || !target || target.CheckInvokeBattle(own, true) !== ClientLib.Data.EAttackBaseResult.OK) return;
        const formation = readFormation();
        if (!formation) return;
        this._lock = true;
        this._lockUntil = 0;
        this._restartLock();
        const units = formation.filter(u => u.enabled && u.h > 0).map(u => ({ i: u.id, x: u.x, y: u.y }));
        ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand('SimulateBattle', {
            battleSetup: { d: target.get_Id(), a: own.get_Id(), u: units, s: 0 },
        }, webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, result) => {
            this._restartLock();
            this._lockUntil = Date.now() + SIM_LOCK_MS;
            this._onResult(result, formation);
        }), null);
    }

    _restartLock() {
        clearTimeout(this._lockTimer);
        this._lockTimer = setTimeout(() => this._unlock(), SIM_LOCK_MS);
    }

    _unlock() {
        this._lockTimer = null;
        this._lock = false;
        this._lockUntil = 0;
        if (this._request && this.running && !this.tabsActive) {
            this._request = false;
            this.simulate();
        }
    }

    _onResult(data, formation) {
        if (!this.running || this.tabsActive || !data || cities().get_CurrentCity() === null) return;
        try {
            const d = data.d;
            const merged = mergeFormation(formation, d.a);
            const key = formationKey(merged, d.ai);
            this.cache.check(d.di, key, cacheState(d.di, d.ai));
            const stats = computeStats(data, clientEnv(data));
            const own = cities().GetCity(d.ai);
            this.cache.add(d.di, key, {
                stats, formation: merged, combat: d, ownId: d.ai, cityId: d.di,
                recovery: own ? own.get_hasRecovery() : undefined,
            });
            this._dirty = true;
        } catch (e) {
            console.error('[ST] STABS: simulation result not readable', e);
        }
    }

    _cacheCount() {
        try { return this.cache.count(cities().get_CurrentCityId()); } catch { return 0; }
    }

    // ── Simulate button (attack setup bar) ──

    _ensureButton() {
        if (this._button) return;
        try {
            const hud = qx.core.Init.getApplication().getPlayArea().getHUD();
            const swap = hud.getUIItem(ClientLib.Data.Missions.PATH.WDG_COMBATSWAPVIEW);
            const btn = new webfrontend.ui.SoundButton(null, IMG.simulate).set({
                toolTipText: t('stabsSimulate'),
                width: 44,
                height: 44,
                allowGrowX: false,
                allowGrowY: false,
                appearance: 'button-baseviews',
                marginRight: 6,
            });
            btn.addListener('click', () => this._onSimulateClick());
            swap.getLayoutParent().addAfter(btn, swap);
            this._button = btn;
        } catch (e) {
            console.warn('[ST] STABS: Simulate button not placed', e && e.message);
        }
    }

    /** Enabled unless locked or empty; a cached formation is always clickable. Counts down after a result. */
    _updateButton() {
        const btn = this._button;
        if (!btn) return;
        const formation = readFormation();
        const cached = formation ? !!this._cachedEntry(formation) : false;
        btn.setEnabled(!!formation && (cached || (!this._lock && formation.length > 0)));
        const left = this._lockUntil - Date.now();
        if (!cached && formation && formation.length && this._lock && left > 0) {
            btn.setLabel((left / 1000).toFixed(1));
            btn.setShow('label');
        } else {
            btn.setShow('icon');
        }
    }

    // ── Statistics window ──

    isPanelOpen() {
        return !!this._win && this._win.isOpen();
    }

    togglePanel() {
        if (this.isPanelOpen()) {
            this.config.set('stabs.panel.open', false);
            this.closePanel();
        } else {
            this.config.set('stabs.panel.open', true);
            this.openPanel();
        }
    }

    openPanel() {
        if (this.tabsActive) return;
        this._ensureWindow();
        if (!this._win) return;
        this._win.open();
        this._dirty = true;
        this._render();
        this._syncTimer();
    }

    /** Closing forgets the shown results (TABS resets its columns on close). */
    closePanel() {
        if (this._win) this._win.close();
        this._shown = null;
        this._columns = {};
        this._syncTimer();
    }

    _ensureWindow() {
        if (this._win) return;
        try {
            this._win = new StatsWindow({
                config: this.config,
                presets: [PRESETS.live, PRESETS.cy].map(p => ({
                    id: p.id,
                    name: p.id === 'live' ? t('stabsPresetLive') : p.name,
                    description: t(p.id === 'live' ? 'stabsPresetLiveDesc' : 'stabsPresetCyDesc'),
                })),
                onUserClose: () => {
                    this.config.set('stabs.panel.open', false);
                    this._shown = null;
                    this._columns = {};
                    this._syncTimer();
                },
                onSimulate: (id) => this._simulateColumn(id),
                onReplay: (id) => this._replayColumn(id),
                onLoad: (id) => this._loadColumn(id),
                onReset: () => {
                    const targetId = cities().get_CurrentCityId();
                    if (targetId) this.cache.clear(targetId);
                    this._shown = null;
                    this._columns = {};
                    this._dirty = true;
                    this._render();
                },
            });
        } catch (e) {
            console.warn('[ST] STABS: statistics window not built', e && e.message);
            this._win = null;
        }
    }

    /** The live column: the cached result of the current formation, else the last one (dimmed). */
    _refreshShown() {
        if (!targetReady()) return false;
        const c = cities();
        const formation = readFormation();
        if (formation) {
            const ownId = c.get_CurrentOwnCityId();
            const key = formationKey(formation, ownId);
            const entry = this.cache.check(c.get_CurrentCityId(), key, cacheState(c.get_CurrentCityId(), ownId));
            if (entry) this._shown = { key, entry };
        }
        return !!this._shown && !!formation && this._shown.key === formationKey(formation, this._shown.entry.ownId);
    }

    /** Key of the current formation, or null. */
    _currentKey() {
        const formation = readFormation();
        if (!formation) return null;
        return formationKey(formation, cities().get_CurrentOwnCityId());
    }

    _render() {
        if (!this._win || !this._win.isOpen()) return;
        if (this._dirty) {
            this._dirty = false;
            this._refreshShown();
            this._columns = { live: this._shown };
            if (targetReady()) {
                const best = this.cache.best(cities().get_CurrentCityId(), PRESETS.cy.criteria);
                if (best) this._columns.cy = best;
            }
        }
        const current = targetReady() ? this._currentKey() : null;
        const loot = lootFromCurrentCity();
        const fmt = { time: timespan, number: compact };
        const columns = ['live', 'cy'].map((id) => {
            const shown = this._columns[id] || null;
            const view = shown ? this._columnView(shown.entry, loot) : null;
            return { cells: columnCells(view, fmt), dim: !!shown && shown.key !== current, view };
        });
        this._win.update({
            columns,
            enemyRows: visibleEnemyRows(columns[0].view && columns[0].view.stats),
            moraleVisible: columns.some(c => c.view && c.view.morale && c.view.morale.text !== '100%'),
            cacheCount: this._cacheCount(),
            outcomeTitles: { 'total-defeat': t('stabsTotalDefeat'), 'total-victory': t('stabsTotalVictory'), victory: t('stabsVictory') },
        });
    }

    /** What one column needs from the client, for a cache entry. */
    _columnView(entry, loot) {
        const view = { stats: entry.stats, loot, base: '', morale: null, storage: null };
        const own = cities().GetCity(entry.ownId);
        if (own) {
            view.base = own.get_Name();
            const rc = Math.min(own.GetResourceCount(RES.RC_INF), own.GetResourceCount(RES.RC_VEH), own.GetResourceCount(RES.RC_AIR));
            try { view.storage = mainData().get_Time().GetTimeSpan(rc); } catch { view.storage = null; }
        }
        try { view.morale = morale(entry.cityId, entry.ownId); } catch { view.morale = null; }
        return view;
    }

    // ── Column buttons ──

    _columnEntry(id) {
        const shown = this._columns[id];
        return shown ? shown.entry : null;
    }

    /** Double click: put the column's formation in the attack setup. */
    _loadColumn(id) {
        const entry = this._columnEntry(id);
        if (entry) applyFormation(entry);
        this._dirty = true;
    }

    /** ⊕: load the column's formation and simulate it (the current one when the column is empty). */
    _simulateColumn(id) {
        const entry = this._columnEntry(id);
        if (entry) applyFormation(entry);
        this._dirty = true;
        this.simulate();
    }

    /** ▶: view the column's battle; the back button returns to the attack setup. */
    _replayColumn(id) {
        const entry = this._columnEntry(id);
        if (!entry || !entry.combat) return;
        try {
            this._replayTarget = entry.cityId;
            this._ensureBackButton();
            if (this._win) this._win.close();     // TABS closes its window during a replay
            startReplay(entry.cityId, entry.combat);
        } catch (e) {
            console.warn('[ST] STABS: replay failed', e && e.message);
        }
    }

    /** A back button on the game's replay overlay (that overlay belongs to the reports and has none for a simulation). */
    _ensureBackButton() {
        if (this._backButton) return;
        const overlay = qx.core.Init.getApplication().getReportReplayOverlay();
        const btn = new qx.ui.form.Button().set({
            width: 48, height: 48, icon: IMG.back, appearance: 'button-friendlist-scroll', toolTipText: t('stabsReplayBack'),
        });
        btn.addListener('click', () => this._backToSetup());
        overlay.add(btn, { top: 11, left: 346 });
        this._backButton = btn;
    }

    _backToSetup() {
        try {
            const area = qx.core.Init.getApplication().getPlayArea();
            const target = this._replayTarget || cities().get_CurrentCityId();
            area.setView(ClientLib.Data.PlayerAreaViewMode.pavmCombatSetupDefense, target, 0, 0);
            ClientLib.Vis.VisMain.GetInstance().get_CombatSetup()
                .SetPosition(0, area.getHUD().getCombatSetupOffset(ClientLib.Vis.CombatSetup.CombatSetupViewMode.Defense));
        } catch (e) {
            console.warn('[ST] STABS: back to the attack setup failed', e && e.message);
        }
    }
}

// ─── Formation and replay ────────────────────────────────────────────

/**
 * Put a cached formation back in the attack setup: the entry's own base
 * becomes current, every unit gets its cell and enabled state. A unit that
 * stands in the way and could be carried by the moving unit first moves to
 * that unit's cell; carried units (gs 2) only follow their carrier's state.
 */
export function applyFormation(entry) {
    const c = cities();
    if (c.get_CurrentOwnCityId() !== entry.ownId) c.set_CurrentOwnCityId(entry.ownId);
    const own = c.GetCity(entry.ownId);
    const formation = own && own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(entry.cityId);
    const list = formation && formation.get_ArmyUnits();
    if (!list) return false;
    const byId = (id) => list.l.find(u => u.get_Id() === id) || null;
    const carried = [];
    for (const f of entry.formation) {
        if (f.gs === 2) {
            carried.push(f);
            continue;
        }
        const unit = byId(f.id);
        if (!unit) continue;
        unit.set_Enabled(f.enabled);
        const inTheWay = formation.GetUnitByCoord(f.x, f.y);
        if (inTheWay && inTheWay !== unit
            && ClientLib.Base.Unit.CanBeTransported(inTheWay.get_UnitGameData_Obj(), unit.get_UnitGameData_Obj())) {
            inTheWay.MoveBattleUnit(unit.get_CoordX(), unit.get_CoordY());
        }
        unit.MoveBattleUnit(f.x, f.y);
    }
    for (const f of carried) {
        const unit = byId(f.id);
        const carrier = formation.GetUnitByCoord(f.x, f.y);
        if (unit && carrier && carrier.get_Enabled()) unit.set_Enabled(true);
    }
    return true;
}

/** Show a simulated battle in the game's replay view, at normal speed. */
function startReplay(cityId, combat) {
    qx.core.Init.getApplication().getPlayArea().setView(ClientLib.Data.PlayerAreaViewMode.pavmCombatReplay, cityId, 0, 0);
    const battleground = ClientLib.Vis.VisMain.GetInstance().get_Battleground();
    battleground.Init();
    battleground.LoadCombatDirect(combat);
    setTimeout(() => {
        battleground.RestartReplay();
        battleground.set_ReplaySpeed(1);
    }, 0);
}
