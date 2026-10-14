/**
 * loot-summary.js — available loot of a Forgotten target in the region info
 * panel, before the attack (replaces MHTools Tiberium Alliances Available
 * Loot Summary + Info 1.8.3.9).
 *
 * In the info panel of a selected Forgotten camp / outpost / base on the world
 * map (RegionNPCCampStatusInfo / RegionNPCBaseStatusInfo - player bases use
 * other widgets, so they never get the section), appended at the bottom like
 * Wavy and POI Analyser:
 *
 *   Loot
 *   Tib 1.2M · Cry 640k · Credits 85k
 *   Total 1.9M  (+ Research 12k when > 0)
 *   Outpost level 31 · 9 CP from <own base> (7.2 fields)
 *   Loot/CP 211k
 *
 * Loot, taken over 1:1 from MHTools (getBypass / loadBase / getLoots /
 * calcResources):
 *   - target city = get_Cities().get_CurrentCity() (the game makes the
 *     selected target the current city); not loaded while it, its
 *     get_CityBuildingsData() or get_CityUnitsData() is null, or its building
 *     collection has c === 0
 *   - the building / defence / offence collections are found the MHTools way
 *     (the property names are obfuscated): in get_CityBuildingsData() and
 *     get_CityUnitsData() of an own base, the {c, d} object whose d has c
 *     entries and whose first entry has get_UnitLevelRepairRequirements();
 *     no GetUnitGroupType = buildings, GetUnitGroupType() truthy = offence,
 *     else defence. Keys found once (all three), then reused
 *   - per building and defence unit (offence is not counted):
 *       p = u.get_HitpointsPercent()                 (0-1)
 *       for c of u.get_UnitLevelRepairRequirements(): loot[c.Type] += p * c.Count
 *     EResourceType 1 = Tiberium, 2 = Crystal, 3 = Credits (Gold), 6 = Research
 * MHTools recomputes in the widget's onCitiesChange (it overrides that
 * method); Shockr listens to the same Cities Change event instead of
 * patching the widget, and shows "loading" until the data is there.
 *
 * Not in MHTools (from the work order): total = tib + cry + credits; CP from
 * the own base nearest to the target, city.CalculateAttackCommandPointCostToCoord;
 * loot/CP; colour of total and loot/CP compared with the targets inspected
 * this session (top third green, bottom third red, else neutral; neutral
 * until 3 targets are known).
 *
 * KillInfo (/st plunder) is untouched: that is the per-unit breakdown in its
 * own panel; this is the summary in the game's info panel.
 */
import { t } from '../lib/i18n.js';
import { fmtNumber } from '../lib/poi-util.js';

const STATUS_INFOS = ['RegionNPCBaseStatusInfo', 'RegionNPCCampStatusInfo'];
const HISTORY_MAX = 30;
export const COLORS = { high: '#8bc34a', low: '#ef5350', mid: '#ffffff', muted: '#bdbdbd' };
/** ENPCCampType (world object $CampType) → target type, as Map Labels. */
const CAMP_TYPES = { 1: 'camp', 2: 'camp', 3: 'outpost', 4: 'base' };
/** MHTools' EResourceType translation (getLoots): 1 Tiberium, 2 Crystal, 3 Gold (credits), 6 ResearchPoints. */
const LOOT_TYPES = { 1: 'tib', 2: 'cry', 3: 'cred', 6: 'rp' };

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

/** MHTools calcResources: loot of the buildings + defence units (offence not counted). */
export function calcLoot(buildings, defences) {
    const loot = { rp: 0, tib: 0, cry: 0, cred: 0 };
    getLoots(buildings, loot);
    if (defences) getLoots(defences, loot);
    loot.total = loot.tib + loot.cry + loot.cred;
    return loot;
}

/**
 * MHTools getBypass/getKeys: names of the buildings / defence / offence
 * collections in a city's get_CityBuildingsData() + get_CityUnitsData().
 */
export function findCollectionKeys(city, keys = {}) {
    const scan = (obj) => {
        for (const k in obj) {
            const o = obj[k];
            if (o === null || typeof o !== 'object') continue;
            if (typeof o.c === 'undefined') continue;       // count
            if (o.c === 0) continue;                        // empty
            if (typeof o.d === 'undefined') continue;       // data {}
            const ks = Object.keys(o.d);
            if (ks.length !== o.c) continue;
            const u = o.d[ks[0]];
            if (typeof u !== 'object') continue;
            if (typeof u.get_UnitLevelRepairRequirements !== 'function') continue;
            if (typeof u.GetUnitGroupType === 'undefined') keys.buildings = k;
            else if (u.GetUnitGroupType()) keys.offences = k;   // units 3-attack
            else keys.defences = k;                              // units 0-defend
        }
    };
    scan(city.get_CityBuildingsData());
    scan(city.get_CityUnitsData());
    return keys;
}

/** Loot per CP, null when the CP cost is unknown or 0. */
export function lootPerCp(total, cp) {
    return cp > 0 ? total / cp : null;
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

/** Nearest own base to (x, y): {city, name, dist}, or null. */
export function nearestOwnBase(x, y, cities) {
    let best = null;
    for (const c of cities) {
        try {
            const dist = Math.hypot(c.get_PosX() - x, c.get_PosY() - y);
            if (!best || dist < best.dist) best = { city: c, name: c.get_Name(), dist };
        } catch { /* skip */ }
    }
    return best;
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
        this._panel = null;            // qx container + labels
        this._keys = null;             // MHTools collection keys {buildings, defences, offences}
        this._shown = null;            // {widget, sel} of the open panel
        this._history = { total: [], ratio: [] };
        this._seen = new Set();        // "x:y" already in the history
        this._warned = false;
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
        if (this._panel) {
            try {
                const parent = this._panel.container.getLayoutParent();
                if (parent) parent.remove(this._panel.container);
                this._panel.container.dispose();
            } catch { /* ignore */ }
            this._panel = null;
        }
        this._shown = null;
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

    _ensurePanel() {
        if (this._panel) return this._panel;
        try {
            const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
                marginTop: 6, textColor: 'text-region-tooltip',
            });
            const title = new qx.ui.basic.Label('Loot').set({ font: 'font_size_14', textColor: 'text-region-value' });
            const res = new qx.ui.basic.Label('').set({ rich: true });
            const total = new qx.ui.basic.Label('').set({ rich: true });
            const info = new qx.ui.basic.Label('').set({ textColor: 'text-region-value' });
            const ratio = new qx.ui.basic.Label('').set({ rich: true });
            for (const w of [title, res, total, info, ratio]) box.add(w);
            this._panel = { container: box, title, res, total, info, ratio };
        } catch (e) {
            this._warn('could not build the panel', e);
        }
        return this._panel;
    }

    /** The selected vis object's position + id, or null. */
    _selected() {
        try {
            const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
            if (sel && typeof sel.get_RawX === 'function') {
                return { x: sel.get_RawX(), y: sel.get_RawY(), id: typeof sel.get_Id === 'function' ? sel.get_Id() : null };
            }
        } catch { /* nothing selected */ }
        return null;
    }

    _onAppear(widget) {
        if (!this.running) return;
        const sel = this._selected();
        this._shown = sel ? { widget, sel } : null;
        if (sel) this._render();
    }

    _onDisappear(widget) {
        if (this._shown && this._shown.widget === widget) this._shown = null;
    }

    /** MHTools recomputes on every city change; the target's data arrives that way. */
    _onCitiesChange() {
        if (this.running && this._shown) this._render();
    }

    _render() {
        const { widget, sel } = this._shown;
        try {
            const panel = this._ensurePanel();
            if (!panel) return;
            panel.title.setValue(t('lootTitle'));
            const target = this._target(sel);
            if (target) this._fill(panel, sel, target);
            else this._setLoading(panel);
            widget.add(panel.container);   // a qx widget has one parent: this moves it
        } catch (e) {
            this._warn('panel update failed', e);
        }
    }

    _setLoading(panel) {
        panel.res.setValue(escape(t('lootLoading')));
        panel.res.setTextColor(COLORS.muted);
        for (const l of [panel.total, panel.info, panel.ratio]) l.setValue('');
    }

    /** MHTools getBypass/loadBypass: collection keys from an own base, once all three are found. */
    _collectionKeys() {
        if (this._keys) return this._keys;
        try {
            for (const c of Object.values(ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d)) {
                const keys = findCollectionKeys(c);
                if (keys.buildings && keys.defences && keys.offences) {
                    this._keys = keys;
                    break;
                }
            }
        } catch (e) {
            this._warn('could not find the building/unit collections', e);
        }
        return this._keys;
    }

    /** Loot data of the selected target ({loot, level, type}), or null while it is not loaded (MHTools loadBase). */
    _target(sel) {
        const keys = this._collectionKeys();
        if (!keys) return null;
        const md = ClientLib.Data.MainData.GetInstance();
        const cities = md.get_Cities();
        const ec = cities.get_CurrentCity();
        if (ec === null || ec === undefined) return null;
        if (sel.id !== null && cities.get_CurrentCityId() !== sel.id) return null;   // still the previous target
        if (ec.get_CityBuildingsData() === null) return null;
        if (ec.get_CityUnitsData() === null) return null;
        const buildings = ec.get_CityBuildingsData()[keys.buildings];
        const defences = ec.get_CityUnitsData()[keys.defences];
        if (!buildings || buildings.c === 0) return null;
        const loot = calcLoot(buildings, defences);
        let level = null;
        try { level = Math.floor(ec.get_LvlBase()); } catch { /* from the world object */ }
        let type = 'base';
        try {
            const obj = md.get_World().GetObjectFromPosition(sel.x, sel.y);
            if (obj && obj.Type === 3) type = CAMP_TYPES[obj.$CampType] || 'camp';
            if (level === null && obj && typeof obj.$Level === 'number') level = Math.floor(obj.$Level);
        } catch { /* keep 'base' */ }
        return { loot, level, type };
    }

    _fill(panel, sel, { loot, level, type }) {
        const res = [
            `<span style="color:#8bc34a">${escape(t('lootTib'))} ${fmtNumber(loot.tib)}</span>`,
            `<span style="color:#42a5f5">${escape(t('lootCry'))} ${fmtNumber(loot.cry)}</span>`,
            `<span style="color:#ffc107">${escape(t('lootCred'))} ${fmtNumber(loot.cred)}</span>`,
        ].join(' · ');
        panel.res.setValue(res);
        panel.res.setTextColor(COLORS.mid);

        let cp = null;
        let from = null;
        try {
            const cities = Object.values(ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d);
            from = nearestOwnBase(sel.x, sel.y, cities);
            if (from) cp = Number(from.city.CalculateAttackCommandPointCostToCoord(sel.x, sel.y));
            if (!Number.isFinite(cp)) cp = null;
        } catch { cp = null; }
        const ratio = lootPerCp(loot.total, cp);

        const key = `${sel.x}:${sel.y}`;
        if (!this._seen.has(key)) {
            this._seen.add(key);
            this._history.total.push(loot.total);
            if (ratio !== null) this._history.ratio.push(ratio);
            for (const k of ['total', 'ratio']) {
                if (this._history[k].length > HISTORY_MAX) this._history[k].shift();
            }
        }

        let totalLine = escape(t('lootTotal', { total: fmtNumber(loot.total) }));
        if (loot.rp > 0) totalLine += ` · ${escape(t('lootRp', { rp: fmtNumber(loot.rp) }))}`;
        panel.total.setValue(`<b>${totalLine}</b>`);
        panel.total.setTextColor(COLORS[rankColor(loot.total, this._history.total)]);

        const typeName = t(`lootType_${type}`);
        const head = level !== null ? `${typeName} ${t('lootLevel', { level })}` : typeName;
        panel.info.setValue(from && cp !== null
            ? `${head} · ${t('lootCp', { cp, base: from.name, dist: from.dist.toFixed(1) })}`
            : head);

        panel.ratio.setValue(ratio !== null ? `<b>${escape(t('lootPerCp', { ratio: fmtNumber(ratio) }))}</b>` : '');
        panel.ratio.setTextColor(COLORS[rankColor(ratio, this._history.ratio)]);
    }
}

function escape(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
