// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * loot-summary.js — lootable resources of a Forgotten target in the region
 * info panel, before the attack (replaces MHTools Tiberium Alliances Available
 * Loot Summary + Info 1.8.3.9; the table is MaelstromTools' loot overview).
 *
 * In the info panel of a selected Forgotten camp / outpost / base on the world
 * map (RegionNPCCampStatusInfo / RegionNPCBaseStatusInfo - player bases use
 * other widgets, so they never get the section), appended at the bottom like
 * Wavy and POI Analyser. Layout = MaelstromTools updateLoot /
 * createResourceLabels: a qx Grid(5, 5), white text, icon before each value,
 * columns Tiberium · Crystal · Credits · Research · Sum, values in MHTools'
 * on-screen assignment (see COLUMNS):
 *
 *   Possible attacks from this base (available CP): 14
 *   Lootable resources:  [T] 110.8k [C] 97,981 [$] 91,039 [R] 29,341 [Σ] 329.2k   (bold)
 *   per CP:              [T] 10,073 ...                                     (bold only at 1 CP)
 *   2nd run:             value / (2 × CP)
 *   3rd run:             value / (3 × CP)
 *   11 CP from <current base>                                               (Shockr extra)
 *
 * Out of attack range of the current own base: "Target out of range, no
 * resource calculation possible" (MaelstromTools LoadState -1).
 *
 * Loot formula, identical in MHTools (getLoots) and MaelstromTools
 * (getResourcesPart): per building and defence unit (offence not counted)
 *   loot[c.Type] += c.Count * u.get_HitpointsPercent()  for c of u.get_UnitLevelRepairRequirements()
 * EResourceType 1 = Tiberium, 2 = Crystal, 3 = Gold (credits), 6 = Research.
 * Total = Research + Tiberium + Crystal + Credits (MaelstromTools "Total").
 * CP = get_CurrentOwnCity().CalculateAttackCommandPointCostToCoord(x, y);
 * possible attacks = floor(get_Player().GetCommandPointCount() / CP).
 * Numbers: the game's formatNumbersCompact (as MaelstromTools).
 *
 * Reading the lists (current client): target = get_Cities().get_CurrentCity()
 * at the selected position; defence via get_CityUnitsData().get_DefenseUnits()
 * (else the patched $DefenseUnits); buildings via city.get_Buildings() when it
 * exists, else MHTools' rule (first entry has get_UnitLevelRepairRequirements
 * and no GetUnitGroupType) on the city's own {c, d} fields, then on
 * get_CityBuildingsData(). Recomputed on the Cities Change event (MHTools:
 * onCitiesChange) and every 500 ms (max 10 s) while calculating.
 *
 * Shockr extra (work order): the Sum of "Lootable resources" and "per CP" is
 * green / red vs. the targets inspected this session (top / bottom third;
 * neutral until 3 are known).
 *
 * KillInfo (/st plunder) is untouched: that is the per-unit breakdown in its
 * own panel; this is the summary in the game's info panel.
 */
import { t } from '../lib/i18n.js';
import { fmtNumber } from '../lib/poi-util.js';

const STATUS_INFOS = ['RegionNPCBaseStatusInfo', 'RegionNPCCampStatusInfo'];
const HISTORY_MAX = 30;
const RETRY_MS = 500;
const RETRY_MAX = 20;
export const COLORS = { high: '#8bc34a', low: '#ef5350', mid: '#ffffff', muted: '#bdbdbd' };
/** MHTools' EResourceType translation (getLoots): 1 Tiberium, 2 Crystal, 3 Gold (credits), 6 ResearchPoints. */
const LOOT_TYPES = { 1: 'tib', 2: 'cry', 3: 'cred', 6: 'rp' };
/**
 * Columns as MHTools shows them in the game (work order: identical output to
 * MHTools, whatever the "correct" EResourceType mapping is): icons Tiberium ·
 * Crystal · Credits · Research, filled with MHTools' lootArray in its own
 * index order [RP, T, C, G] (calcResources: 0 = type 6, 1 = type 1, 2 = type 2,
 * 3 = type 3). So the tib icon shows MHTools' lootArray[0] (live: 110.8k on
 * the comparison camp, the value under MHTools' tib icon). key = loot field
 * shown, icon = column icon; total on the right.
 */
export const COLUMNS = [
    { key: 'rp', icon: 'ui/common/icn_res_tiberium.png' },
    { key: 'tib', icon: 'ui/common/icn_res_chrystal.png' },
    { key: 'cry', icon: 'ui/common/icn_res_dollar.png' },
    { key: 'cred', icon: 'ui/common/icn_res_research_mission.png' },
    { key: 'total', icon: 'ui/common/icn_build_slots.png' },
];

/**
 * MHTools getLoots: add p * Count of every repair requirement of every
 * unit/building in a {d: {...}} collection to r.
 */
export function getLoots(ul, r = {}) {
    for (const j in ul.d) {
        const u = ul.d[j];                                  // unit/building
        const p = u.get_HitpointsPercent();                 // 0-1, 1 means 100%
        const cl = u.get_UnitLevelRepairRequirements();     // EA API Resources/Repair Costs
        for (const i in cl) {
            const c = cl[i];                                // Requirement/Cost
            if (typeof c !== 'object') continue;
            const k = LOOT_TYPES[c.Type] === undefined ? c.Type : LOOT_TYPES[c.Type];
            if (r[k] === undefined) r[k] = 0;
            r[k] += p * c.Count;
        }
    }
    return r;
}

/** Loot of the buildings + defence units (offence not counted); total incl. research (MaelstromTools). */
export function calcLoot(buildings, defences) {
    const loot = { rp: 0, tib: 0, cry: 0, cred: 0 };
    if (buildings) getLoots(buildings, loot);
    if (defences) getLoots(defences, loot);
    loot.total = loot.rp + loot.tib + loot.cry + loot.cred;
    return loot;
}

/**
 * MaelstromTools' rows: [label key, divisor, bold]. Divisor = Modifier
 * (1, CP, 2 CP, 3 CP); bold when Modifier <= 1. Without a CP cost only the
 * loot row.
 */
export function lootRows(cp) {
    const rows = [['lootLootable', 1, true]];
    if (cp > 0) {
        rows.push(['lootPerCpRow', cp, cp <= 1], ['loot2nd', 2 * cp, false], ['loot3rd', 3 * cp, false]);
    }
    return rows;
}

/** MaelstromTools: floor(available CP / CP needed), null without a CP cost. */
export function possibleAttacks(available, cp) {
    return cp > 0 && Number.isFinite(available) ? Math.floor(available / cp) : null;
}

/** Defence units of a city: the public get_DefenseUnits() (MehrStrom-verified), else the patched $DefenseUnits. */
export function defenceUnits(city) {
    const ud = city.get_CityUnitsData();
    if (!ud) return null;
    try {
        if (typeof ud.get_DefenseUnits === 'function') {
            const d = ud.get_DefenseUnits();
            if (d && d.d) return d;
        }
    } catch { /* patched name below */ }
    return ud.$DefenseUnits && ud.$DefenseUnits.d ? ud.$DefenseUnits : null;
}

/**
 * MHTools getKeys rule for the buildings: a {c, d} object with c entries whose
 * first entry has get_UnitLevelRepairRequirements() and no GetUnitGroupType.
 */
function isBuildingList(o) {
    if (o === null || typeof o !== 'object') return false;
    if (typeof o.c === 'undefined' || o.c === 0 || typeof o.d === 'undefined') return false;
    const ks = Object.keys(o.d);
    if (ks.length !== o.c) return false;
    const u = o.d[ks[0]];
    return typeof u === 'object' && u !== null
        && typeof u.get_UnitLevelRepairRequirements === 'function'
        && typeof u.GetUnitGroupType === 'undefined';
}

/**
 * Buildings of a city: city.get_Buildings() when it exists, else the MHTools
 * rule on the city's own {c, d} fields and on get_CityBuildingsData() (in the
 * current client the lists sit on the city object; get_CityBuildingsData()
 * holds a count summary).
 */
export function buildingList(city) {
    try {
        if (typeof city.get_Buildings === 'function') {
            const b = city.get_Buildings();
            if (isBuildingList(b)) return b;
        }
    } catch { /* search below */ }
    let bd = null;
    try { bd = city.get_CityBuildingsData(); } catch { /* none */ }
    for (const src of [city, bd]) {
        if (!src) continue;
        for (const k in src) {
            let o;
            try { o = src[k]; } catch { continue; }
            if (isBuildingList(o)) return o;
        }
    }
    return null;
}

/** 'high' (top third) / 'low' (bottom third) / 'mid' of value among history; 'mid' with < 3 values. */
export function rankColor(value, history) {
    if (value === null || history.length < 3) return 'mid';
    const below = history.filter(v => v < value).length;
    const share = below / (history.length - 1 || 1);
    if (share >= 2 / 3) return 'high';
    if (share <= 1 / 3) return 'low';
    return 'mid';
}

/** The game's compact number format (MaelstromTools FormatNumbersCompact), else Shockr's. */
export function compact(v) {
    try { return webfrontend.phe.cnc.gui.util.Numbers.formatNumbersCompact(v); } catch { /* older client */ }
    try { return webfrontend.gui.Util.formatNumbersCompact(v); } catch { /* none */ }
    return fmtNumber(v);
}

export class LootSummary {
    /** Short description for `/st help`. */
    get description() { return t('descLootSummary'); }

    constructor(config) {
        this.name = 'LootSummary';
        this.config = config;
        this.running = false;
        this._listeners = [];          // {widget, id}
        this._citiesHooked = false;
        this._grid = null;             // qx Grid container
        this._icons = null;            // key -> physical image path
        this._timer = null;            // fallback re-check while calculating
        this._shown = null;            // {widget, sel, tries} of the open panel
        this._history = { total: [], ratio: [] };
        this._seen = new Set();        // "x:y" already in the history
        this._warned = false;
        this._mtNoted = false;         // MaelstromTools loot table seen (logged once)
    }

    async start() {
        this.running = true;
        this._hookPanels();
        try {
            webfrontend.phe.cnc.Util.attachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(),
                'Change', ClientLib.Data.CitiesChange, this, this._onCitiesChange);
            this._citiesHooked = true;
        } catch (e) {
            this._warn('could not listen to city changes', e);
        }
        console.log('[ST] LootSummary: started');
    }

    stop() {
        this.running = false;
        if (this._citiesHooked) {
            try {
                webfrontend.phe.cnc.Util.detachNetEvent(ClientLib.Data.MainData.GetInstance().get_Cities(),
                    'Change', ClientLib.Data.CitiesChange, this, this._onCitiesChange);
            } catch { /* ignore */ }
            this._citiesHooked = false;
        }
        for (const { widget, id } of this._listeners) {
            try { widget.removeListenerById(id); } catch { /* ignore */ }
        }
        this._listeners = [];
        if (this._grid) {
            try {
                const parent = this._grid.getLayoutParent();
                if (parent) parent.remove(this._grid);
                this._grid.dispose();
            } catch { /* ignore */ }
            this._grid = null;
        }
        this._shown = null;
        this._clearTimer();
    }

    _clearTimer() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('lootStatus', { n: this._seen.size });
    }

    _warn(msg, e) {
        if (this._warned) return;
        this._warned = true;
        console.warn(`[ST] LootSummary: ${msg}`, e && e.message ? e.message : '');
    }

    // ─── Info panel ──────────────────────────────────────────────────

    _hookPanels() {
        let region;
        try {
            region = webfrontend.gui.region;
        } catch (e) {
            this._warn('region info widgets not available — panel disabled', e);
            return;
        }
        for (const name of STATUS_INFOS) {
            try {
                const cls = region && region[name];
                if (!cls || typeof cls.getInstance !== 'function') continue;
                const widget = cls.getInstance();
                const appear = widget.addListener('appear', () => this._onAppear(widget), this);
                const disappear = widget.addListener('disappear', () => this._onDisappear(widget), this);
                this._listeners.push({ widget, id: appear }, { widget, id: disappear });
            } catch (e) {
                this._warn(`could not hook ${name}`, e);
            }
        }
    }

    /** MaelstromTools' loot widget: Composite with Grid(5, 5), white text. */
    _ensureGrid() {
        if (this._grid) return this._grid;
        try {
            this._grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(5, 5)).set({ marginTop: 6 });
            this._grid.setTextColor('white');
        } catch (e) {
            this._warn('could not build the panel', e);
        }
        return this._grid;
    }

    /** MaelstromTools Util.addLabel. */
    _label(grid, row, column, value, { width, align, bold, color, colSpan } = {}) {
        const label = new qx.ui.basic.Label().set({ value: String(value) });
        if (width) label.setWidth(width);
        if (align) label.setTextAlign(align);
        if (color) label.setTextColor(color);
        if (bold) label.setFont('bold');
        grid.add(label, { row, column, colSpan: colSpan || 1 });
        return label;
    }

    /** MaelstromTools Util.getImage + addImage: 20x20, scaled. */
    _image(grid, row, column, key) {
        if (!this._icons) {
            this._icons = {};
            try {
                const fm = ClientLib.File.FileManager.GetInstance();
                for (const c of COLUMNS) this._icons[c.key] = fm.GetPhysicalPath(c.icon);
            } catch { /* no icons */ }
        }
        if (!this._icons[key]) return;
        const image = new qx.ui.basic.Image(this._icons[key]);
        image.setScale(true);
        image.setWidth(20);
        image.setHeight(20);
        grid.add(image, { row, column });
    }

    /** The selected vis object's position, or null. */
    _selected() {
        try {
            const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
            if (sel && typeof sel.get_RawX === 'function') return { x: sel.get_RawX(), y: sel.get_RawY() };
        } catch { /* nothing selected */ }
        return null;
    }

    /**
     * MaelstromTools with "Show lootable resources" wraps onCitiesChange of
     * these widgets (__MTCity_NPCCamp / __MTCity_NPCBase) and draws the same
     * table in the same panel - ours would show it twice, so we step aside.
     */
    _maelstromLoot() {
        try {
            const region = webfrontend.gui.region;
            return !!(region.RegionNPCBaseStatusInfo.prototype.__MTCity_NPCBase
                || region.RegionNPCCampStatusInfo.prototype.__MTCity_NPCCamp);
        } catch {
            return false;
        }
    }

    _onAppear(widget) {
        if (!this.running) return;
        if (this._maelstromLoot()) {
            if (!this._mtNoted) {
                this._mtNoted = true;
                console.log('[ST] LootSummary: MaelstromTools loot table active — Shockr panel skipped (turn off "Show lootable resources" in MaelstromTools to use this one)');
            }
            if (this._grid && this._grid.getLayoutParent()) this._grid.getLayoutParent().remove(this._grid);
            this._shown = null;
            this._clearTimer();
            return;
        }
        const sel = this._selected();
        this._shown = sel ? { widget, sel, tries: 0 } : null;
        if (sel) this._render();
    }

    _onDisappear(widget) {
        if (this._shown && this._shown.widget === widget) {
            this._shown = null;
            this._clearTimer();
        }
    }

    /** MHTools recomputes on every city change; the target's data arrives that way. */
    _onCitiesChange() {
        if (this.running && this._shown) this._render();
    }

    _render() {
        this._clearTimer();
        const shown = this._shown;
        const { widget, sel } = shown;
        try {
            const grid = this._ensureGrid();
            if (!grid) return;
            grid.removeAll();
            const own = this._ownCity();
            if (own && !this._inRange(own, sel)) {
                this._label(grid, 1, 1, t('lootOutOfRange'), { bold: true, colSpan: 11 });
            } else {
                const target = this._target(sel);
                if (target) {
                    this._fill(grid, sel, target, own);
                } else {
                    this._label(grid, 1, 1, t('lootCalculating'), { bold: true, colSpan: 11 });
                    // fallback when no Cities Change event follows: re-check every RETRY_MS, max RETRY_MAX times
                    if (shown.tries++ < RETRY_MAX) {
                        this._timer = setTimeout(() => {
                            this._timer = null;
                            if (this.running && this._shown === shown) this._render();
                        }, RETRY_MS);
                    }
                }
            }
            widget.add(grid);   // a qx widget has one parent: this moves it
        } catch (e) {
            this._warn('panel update failed', e);
        }
    }

    _ownCity() {
        try { return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity() || null; } catch { return null; }
    }

    /** MaelstromTools: distance from the current own base <= get_MaxAttackDistance(). */
    _inRange(own, sel) {
        try {
            const dist = Math.hypot(own.get_PosX() - sel.x, own.get_PosY() - sel.y);
            return dist <= Number(ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance());
        } catch {
            return true;
        }
    }

    /** Loot of the selected target, or null while it is not loaded. */
    _target(sel) {
        const ec = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCity();   // null until loaded
        if (!ec) return null;
        try {
            // still the previous target: wait for the selected one
            if (ec.get_PosX() !== sel.x || ec.get_PosY() !== sel.y) return null;
        } catch { /* no position getters: trust the current city */ }
        if (!ec.get_CityBuildingsData() || !ec.get_CityUnitsData()) return null;
        const buildings = buildingList(ec);
        const defences = defenceUnits(ec);
        if (!buildings && !defences) return null;       // data not there yet
        const loot = calcLoot(buildings, defences);
        return loot.total > 0 ? loot : null;            // MaelstromTools LoadState: Factor > 0
    }

    _fill(grid, sel, loot, own) {
        let cp = null;
        try {
            cp = Number(own.CalculateAttackCommandPointCostToCoord(sel.x, sel.y));
            if (!Number.isFinite(cp)) cp = null;
        } catch { cp = null; }

        const ratio = cp > 0 ? loot.total / cp : null;
        const key = `${sel.x}:${sel.y}`;
        if (!this._seen.has(key)) {
            this._seen.add(key);
            this._history.total.push(loot.total);
            if (ratio !== null) this._history.ratio.push(ratio);
            for (const k of ['total', 'ratio']) {
                if (this._history[k].length > HISTORY_MAX) this._history[k].shift();
            }
        }

        let row = 1;
        let available = NaN;
        try { available = Number(ClientLib.Data.MainData.GetInstance().get_Player().GetCommandPointCount()); } catch { /* unknown */ }
        const attacks = possibleAttacks(available, cp);
        if (attacks !== null) {
            this._label(grid, ++row, 1, `${t('lootPossibleAttacks')}: ${attacks}`, { align: 'left', bold: true, colSpan: 9 });
        }
        for (const [labelKey, div, bold] of lootRows(cp)) {
            row++;
            let col = 1;
            this._label(grid, row, col++, `${t(labelKey)}:`, { bold });
            for (const c of COLUMNS) {
                this._image(grid, row, col++, c.key);
                let color;
                if (c.key === 'total' && div === 1) color = COLORS[rankColor(loot.total, this._history.total)];
                if (c.key === 'total' && div === cp) color = COLORS[rankColor(ratio, this._history.ratio)];
                this._label(grid, row, col++, compact(loot[c.key] / div), { width: 50, align: 'right', bold, color });
            }
        }
        if (cp !== null) {
            let base = '';
            try { base = own.get_Name(); } catch { /* unnamed */ }
            this._label(grid, ++row, 1, t('lootCpFrom', { cp, base }), { color: COLORS.muted, colSpan: 11 });
        }
    }
}
