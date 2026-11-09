// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * production-overview.js — production per own base, per hour, in one panel.
 *
 * On by default. Opened from the Shockr toolbar (factory icon) or
 * `/st production`. Per base and per resource (Tiberium, Crystal, Power,
 * Credits): Continuous, Bonus (packages), POI and Total/h; a total row below.
 * Click a base name: that base opens in the main window.
 *
 * Game API (the same calls as MaelstromTools' Production window; own implementation):
 *   continuous: city.GetResourceGrowPerHour(type, false, false)
 *   bonus:      city.GetResourceBonusGrowPerHour(type)
 *   POI:        alliance.GetPOIBonusFromResourceType(type)  (alliance-wide; every base gets it; 0 without alliance)
 *   credits:    ClientLib.Base.Resource.GetResourceGrowPerHour(city.get_CityCreditsProduction(), false)
 *               ClientLib.Base.Resource.GetResourceBonusGrowPerHour(city.get_CityCreditsProduction(), false)
 *               (no POI for credits)
 * A value whose getter is missing or throws is null ("—") and left out of the total.
 * NOT VERIFIED LIVE: all of these on the current client (UpgradeCalc only uses
 * GetResourceGrowPerHour(type, true, true)).
 */
import { t } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { OverviewPanel, renderTable, ownBases, openBase } from '../lib/overview-panel.js';

const TOOLBAR_ID = 'production';
export const RESOURCES = ['tib', 'cry', 'power', 'credits'];
export const PARTS = ['cont', 'bonus', 'poi', 'total'];
const RES_KEY = { tib: 'resTiberium', cry: 'resCrystal', power: 'resPower', credits: 'resCredits' };
const PART_KEY = { cont: 'prodColContinuous', bonus: 'prodColBonus', poi: 'prodColPoi', total: 'prodColTotal' };

/** Call fn, a finite number or null. */
function num(fn) {
    try {
        const v = Number(fn());
        return Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

/** Sum of the non-null values; null when all are null. */
function sum(values) {
    let s = null;
    for (const v of values) if (v !== null && v !== undefined) s = (s || 0) + v;
    return s;
}

/**
 * Production of one base: { tib: {cont, bonus, poi, total}, cry, power, credits }.
 * @param {object} city — ClientLib city
 * @param {?object} alliance — ClientLib alliance (null = no alliance: POI 0)
 */
export function readCity(city, alliance) {
    const R = ClientLib.Base.EResourceType;
    const out = {};
    for (const [key, type] of [['tib', R.Tiberium], ['cry', R.Crystal], ['power', R.Power]]) {
        const cont = num(() => city.GetResourceGrowPerHour(type, false, false));
        const bonus = num(() => city.GetResourceBonusGrowPerHour(type));
        const poi = alliance ? num(() => alliance.GetPOIBonusFromResourceType(type)) : 0;
        out[key] = { cont, bonus, poi, total: sum([cont, bonus, poi]) };
    }
    const res = ClientLib.Base.Resource;
    const cont = num(() => res.GetResourceGrowPerHour(city.get_CityCreditsProduction(), false));
    const bonus = num(() => res.GetResourceBonusGrowPerHour(city.get_CityCreditsProduction(), false));
    out.credits = { cont, bonus, poi: 0, total: sum([cont, bonus]) };
    return out;
}

/** Flatten to table values: { tib_cont, tib_bonus, ..., credits_total }. */
export function flatten(prod) {
    const v = {};
    for (const r of RESOURCES) for (const p of PARTS) v[`${r}_${p}`] = prod[r][p];
    return v;
}

/** Column-wise total over the rows' values. */
export function totals(rows) {
    const v = {};
    for (const r of RESOURCES) for (const p of PARTS) {
        const k = `${r}_${p}`;
        v[k] = sum(rows.map(row => row.values[k]));
    }
    return v;
}

export function columns() {
    const cols = [];
    for (const r of RESOURCES) {
        for (const p of PARTS) {
            if (r === 'credits' && p === 'poi') continue;   // credits have no POI
            cols.push({
                key: `${r}_${p}`,
                group: t(RES_KEY[r]),
                label: t(PART_KEY[p]),
                style: p === 'total' ? () => 'color:#fff;font-weight:bold;' : null,
            });
        }
    }
    return cols;
}

export class ProductionOverview {
    /** Short description for `/st help`. */
    get description() { return t('descProductionOverview'); }

    constructor(config, toolbar, cli) {
        this.name = 'ProductionOverview';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.panel = new OverviewPanel(config, {
            id: 'st-production-panel',
            prefix: 'ProductionOverview',
            width: 860,
            title: () => t('prodTitle'),
            read: () => this.read(),
            render: (data) => renderTable({ columns: columns(), rows: data.rows, total: data.total, jumpHint: t('ovJumpHint') }),
            onRowClick: (id) => openBase(id),
        });
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.factory,
            label: () => t('toolbarProduction'),
            onClick: () => this.panel.toggle(),
        });
        this.cli.register('production', () => this.panel.toggle());
    }

    stop() {
        this.running = false;
        this.panel.destroy();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('production');
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t(this.panel.isOpen() ? 'prodStatusOpen' : 'prodStatusClosed');
    }

    /** { rows: [{id, name, values}], total: {values} }, or null without city data. */
    read() {
        let alliance = null;
        try {
            const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
            if (a && (typeof a.get_Exists !== 'function' || a.get_Exists())) alliance = a;
        } catch { alliance = null; }
        const rows = ownBases().map(city => ({
            id: city.get_Id(),
            name: city.get_Name(),
            values: flatten(readCity(city, alliance)),
        }));
        if (!rows.length) return null;
        return { rows, total: { values: totals(rows) } };
    }
}
