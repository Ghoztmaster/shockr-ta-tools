// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * army-overview.js — base / defense / army state and repair charges per own base.
 *
 * On by default. Opened from the Shockr toolbar (tank icon) or `/st army`.
 * Two sections, as MaelstromTools' Overview window (RepairTime class; same
 * getters and rules, own implementation):
 *
 * 1. Overview, every own base:
 *    Base     Level · Buildings cur / max (red: a free slot) · Health %
 *    Defense  Level · Buildings cur / max (red: 5+ free, yellow: 3+) · Health %
 *    Army     Level · Units cur / max (red: 10+ free, yellow: 5+) · Health %
 *    Health colours: red < 25 %, yellow < 100 %. Defense / Army empty when
 *    the unit limit is 0. Click a base name: base view.
 *
 * 2. Repair charges, only bases with an army (offense unit limit > 0):
 *    Inf / Veh / Air repair time (the longest yellow) · Charges (GetResourceCount,
 *    shown as a timespan like MaelstromTools) · Attacks cur / max · Next at · Max+1 at.
 *    All times via the game's FormatTimespan (d:hh:mm:ss over 24 h).
 *    Click a base name: offense view (pavmPlayerOffense).
 *
 * Attacks (MaelstromTools' rule): RT = the longest repair time,
 *   cur = ceil(charges / RT), one less and marked "*" when the offense health
 *   is below 100 % (a repair is still due); max = ceil(max charges / RT).
 *   No repair time (RT 0): 0 / 0.
 * Next at   = time until cur goes up by one: RT × ceil(charges / RT) − charges
 *             (charges fill 1 per second); yellow when that charge level is above
 *             max storage (MaelstromTools' yellow). Hidden when 0.
 * Max+1 at  = time until the charges reach RT × max (the level for max + 1
 *             attacks) − charges. Hidden when 0.
 * MaelstromTools shows Next at / Max+1 at as the charge LEVEL; here it is the
 * time still to wait (the work order), which for charges in seconds is the
 * same level minus the current charges.
 *
 * Game API:
 *   city.get_LvlBase / get_LvlDefense / get_LvlOffense, GetBuildingSlotCount / GetBuildingSlotLimit,
 *   GetBuildingsConditionInPercent / GetDefenseConditionInPercent / GetOffenseConditionInPercent,
 *   GetResourceCount / GetResourceMaxStorage(EResourceType.RepairChargeInf);
 *   unitsData = city.get_CityUnitsData(): get_TotalDefenseHeadCount / get_UnitLimitDefense,
 *   get_TotalOffenseHeadCount / get_UnitLimitOffense,
 *   GetRepairTimeFromEUnitGroup(EUnitGroup.<Infantry|Vehicle|Aircraft>, false)  (seconds)
 * A value whose getter is missing or throws is null ("—").
 * NOT VERIFIED LIVE on the current client (taken from MaelstromTools 0.1.5.5).
 */
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { OverviewPanel, renderTable, ownBases, openBase } from '../lib/overview-panel.js';

const TOOLBAR_ID = 'army';
export const RT_KEYS = ['rt_inf', 'rt_veh', 'rt_air'];
const RED = 'color:#ff5252;';
const YELLOW = 'color:#ffd740;';
const VIEW_OFFENSE = 'offense';

function num(fn) {
    try {
        const v = Number(fn());
        return Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

/** Own fallback: "5:30", "1:05:30", over 24 h "4:12:11:42" (d:hh:mm:ss). */
export function fallbackTimespan(sec) {
    const s = Math.max(0, Math.round(sec));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, '0');
    if (d > 0) return `${d}:${pad(h)}:${pad(m)}:${pad(s % 60)}`;
    if (h > 0) return `${h}:${pad(m)}:${pad(s % 60)}`;
    return `${m}:${pad(s % 60)}`;
}

/**
 * Seconds as a timespan, the way MaelstromTools shows them: the game's own
 * ClientLib.Vis.VisMain.FormatTimespan (d:hh:mm:ss over 24 h), else the fallback.
 * null → "—".
 */
export function formatDuration(sec) {
    if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
    try {
        const fmt = ClientLib.Vis.VisMain.FormatTimespan;
        if (typeof fmt === 'function') {
            const out = fmt(sec);
            if (typeof out === 'string' && out) return out;
        }
    } catch { /* fallback below */ }
    return fallbackTimespan(sec);
}

/** The longest of the three repair times (0 when none is known). */
export function longestRepair(values) {
    let max = 0;
    for (const k of RT_KEYS) {
        const v = values[k];
        if (v !== null && v !== undefined && v > max) max = v;
    }
    return max;
}

/**
 * Attacks and waiting times (MaelstromTools' rule, see the header).
 * @returns {{cur: ?number, star: boolean, max: ?number, next: ?number, nextOver: boolean, maxNext: ?number}}
 */
export function repairStats(charges, maxCharges, rt, health) {
    const out = { cur: null, star: false, max: null, next: null, nextOver: false, maxNext: null };
    if (charges === null) return out;
    if (!(rt > 0)) return { ...out, cur: 0, max: 0 };
    const k = Math.ceil(charges / rt);
    out.star = health !== null && health !== undefined && health < 100;
    out.cur = out.star ? k - 1 : k;
    out.max = maxCharges !== null ? Math.ceil(maxCharges / rt) : null;
    const nextLevel = rt * k;
    if (nextLevel - charges > 0) {
        out.next = nextLevel - charges;
        out.nextOver = maxCharges !== null && nextLevel > maxCharges;
    }
    if (out.max !== null && rt * out.max - charges > 0) out.maxNext = rt * out.max - charges;
    return out;
}

/** Table values of one base. */
export function readCity(city) {
    const R = ClientLib.Base.EResourceType;
    let ud = null;
    try { ud = city.get_CityUnitsData(); } catch { ud = null; }
    const u = (fn) => (ud ? num(() => fn(ud)) : null);
    const v = {
        base_lvl: num(() => city.get_LvlBase()),
        base_cur: num(() => city.GetBuildingSlotCount()),
        base_max: num(() => city.GetBuildingSlotLimit()),
        base_health: num(() => city.GetBuildingsConditionInPercent()),
        def_lvl: num(() => city.get_LvlDefense()),
        def_cur: u(d => d.get_TotalDefenseHeadCount()),
        def_max: u(d => d.get_UnitLimitDefense()),
        def_health: num(() => city.GetDefenseConditionInPercent()),
        off_lvl: num(() => city.get_LvlOffense()),
        off_cur: u(d => d.get_TotalOffenseHeadCount()),
        off_max: u(d => d.get_UnitLimitOffense()),
        off_health: num(() => city.GetOffenseConditionInPercent()),
        rt_inf: null, rt_veh: null, rt_air: null,
        charges: num(() => city.GetResourceCount(R.RepairChargeInf)),
        charges_max: num(() => city.GetResourceMaxStorage(R.RepairChargeInf)),
    };
    for (const key of ['def_health', 'off_health']) if (v[key] !== null && v[key] < 0) v[key] = 0;   // MaelstromTools: negative → 0
    if (ud) {
        const G = ClientLib.Data.EUnitGroup;
        v.rt_inf = u(d => d.GetRepairTimeFromEUnitGroup(G.Infantry, false));
        v.rt_veh = u(d => d.GetRepairTimeFromEUnitGroup(G.Vehicle, false));
        v.rt_air = u(d => d.GetRepairTimeFromEUnitGroup(G.Aircraft, false));
    }
    if (v.charges !== null) v.charges = Math.floor(v.charges);
    v.rt_max = longestRepair(v);
    const s = repairStats(v.charges, v.charges_max, v.rt_max, v.off_health);
    v.att_cur = s.cur;
    v.att_star = s.star;
    v.att_max = s.max;
    v.next = s.next;
    v.next_over = s.nextOver;
    v.max_next = s.maxNext;
    return v;
}

// ─── Formatting ──────────────────────────────────────────────────────

/** Level as MaelstromTools: floored to 2 decimals. */
export const level = (v) => (v === null || v === undefined ? '—' : (Math.floor(v * 100) / 100).toFixed(2));
const pair = (a, b) => `${a === null ? '—' : a} / ${b === null ? '—' : b}`;
const percent = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const healthStyle = (v) => (v === null || v === undefined ? '' : v < 25 ? RED : v < 100 ? YELLOW : '');
/** Colour by free slots: red at `red` or more, yellow at `yellow` or more. */
const freeStyle = (cur, max, red, yellow) => {
    if (cur === null || max === null) return '';
    const free = max - cur;
    return free >= red ? RED : yellow !== null && free >= yellow ? YELLOW : '';
};
/** Blank cell for Defense / Army when that unit limit is 0 (MaelstromTools skips them). */
const unless = (limitKey, fmt) => (v, row) => (row.values[limitKey] === 0 ? '' : fmt(v, row));

export function overviewColumns() {
    const gB = t('armyGroupBase');
    const gD = t('armyGroupDefense');
    const gA = t('armyGroupArmy');
    const L = t('armyColLevel');
    const H = t('armyColHealth');
    return [
        { key: 'base_lvl', group: gB, label: L, format: level },
        {
            key: 'base_cur', group: gB, label: t('armyColBuildings'),
            format: (v, row) => pair(v, row.values.base_max),
            style: (v, row) => freeStyle(v, row.values.base_max, 1, null),
        },
        { key: 'base_health', group: gB, label: H, format: percent, style: healthStyle },
        { key: 'def_lvl', group: gD, label: L, format: unless('def_max', level) },
        {
            key: 'def_cur', group: gD, label: t('armyColBuildings'),
            format: unless('def_max', (v, row) => pair(v, row.values.def_max)),
            style: (v, row) => freeStyle(v, row.values.def_max, 5, 3),
        },
        { key: 'def_health', group: gD, label: H, format: unless('def_max', percent), style: healthStyle },
        { key: 'off_lvl', group: gA, label: L, format: unless('off_max', level) },
        {
            key: 'off_cur', group: gA, label: t('armyColUnits'),
            format: unless('off_max', (v, row) => pair(v, row.values.off_max)),
            style: (v, row) => freeStyle(v, row.values.off_max, 10, 5),
        },
        { key: 'off_health', group: gA, label: H, format: unless('off_max', percent), style: healthStyle },
    ];
}

export function repairColumns() {
    const rtStyle = (v, row) => (row.values.rt_max > 0 && v === row.values.rt_max ? YELLOW : '');
    const wait = (v) => (v === null || v === undefined ? '' : formatDuration(v));
    return [
        { key: 'rt_inf', label: t('armyColInf'), format: formatDuration, style: rtStyle },
        { key: 'rt_veh', label: t('armyColVeh'), format: formatDuration, style: rtStyle },
        { key: 'rt_air', label: t('armyColAir'), format: formatDuration, style: rtStyle },
        { key: 'charges', label: t('armyColCharges'), format: formatDuration },
        {
            key: 'att_cur', label: t('armyColAttacks'),
            format: (v, row) => `${v === null ? '—' : v}${row.values.att_star ? '*' : ''} / ${row.values.att_max === null ? '—' : row.values.att_max}`,
            style: (v, row) => (row.values.att_star ? RED : 'color:#fff;font-weight:bold;'),
        },
        { key: 'next', label: t('armyColNextAt'), format: wait, style: (v, row) => (row.values.next_over ? YELLOW : '') },
        { key: 'max_next', label: t('armyColMaxAt'), format: wait },
    ];
}

/** Both sections; the repair section only for bases with an army. */
export function render(data) {
    const armies = data.rows.filter(r => r.values.off_max !== null && r.values.off_max > 0);
    let html = renderTable({ columns: overviewColumns(), rows: data.rows, jumpHint: t('ovJumpHint') });
    html += `<div style="margin:14px 0 4px;color:#fff;font-weight:bold;">${escapeHtml(t('armyRepairTitle'))}</div>`;
    html += armies.length
        ? renderTable({ columns: repairColumns(), rows: armies, jumpHint: t('armyJumpHintOffense'), view: VIEW_OFFENSE })
        : `<div style="color:#999;padding:6px 0;">${escapeHtml(t('armyNoArmies'))}</div>`;
    return html;
}

/**
 * Open a base in the offense view (MaelstromTools' route:
 * openVisModeInMainWindow(PlayerAreaViewMode.pavmPlayerOffense, id, false));
 * fallback: the base view. NOT VERIFIED LIVE.
 */
export function openOffense(id) {
    try {
        const uv = webfrontend.gui.UtilView;
        if (uv && typeof uv.openVisModeInMainWindow === 'function') {
            uv.openVisModeInMainWindow(ClientLib.Data.PlayerAreaViewMode.pavmPlayerOffense, id, false);
            return true;
        }
    } catch (err) {
        console.warn('[ST] ArmyOverview: offense view failed, opening the base', err && err.message);
    }
    return openBase(id);
}

export class ArmyOverview {
    /** Short description for `/st help`. */
    get description() { return t('descArmyOverview'); }

    constructor(config, toolbar, cli) {
        this.name = 'ArmyOverview';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.panel = new OverviewPanel(config, {
            id: 'st-army-panel',
            prefix: 'ArmyOverview',
            width: 640,
            title: () => t('armyTitle'),
            read: () => this.read(),
            render,
            onRowClick: (id, view) => (view === VIEW_OFFENSE ? openOffense(id) : openBase(id)),
        });
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.tank,
            label: () => t('toolbarArmy'),
            onClick: () => this.panel.toggle(),
        });
        this.cli.register('army', () => this.panel.toggle());
    }

    stop() {
        this.running = false;
        this.panel.destroy();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('army');
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t(this.panel.isOpen() ? 'armyStatusOpen' : 'armyStatusClosed');
    }

    /** { rows: [{id, name, values}] }, or null without city data. */
    read() {
        const rows = ownBases().map(city => ({ id: city.get_Id(), name: city.get_Name(), values: readCity(city) }));
        return rows.length ? { rows } : null;
    }
}
