// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * resource-overview.js — storage per own base: how full, and when it is full.
 *
 * On by default. Opened from the Shockr toolbar (silo icon) or `/st resources`.
 * Per base and per resource (Tiberium, Crystal, Power): current stock, max
 * storage, fill % and "full at" (clock time; with the date when not today).
 * Red = full, yellow = more than 75 %. Total row: summed stock and storage,
 * with the overall %.
 *
 * Game API:
 *   city.GetResourceCount(type), city.GetResourceMaxStorage(type)   (TransferAll uses these)
 *   city.GetResourceGrowPerHour(type, true, true)                   (UpgradeCalc: incl. packages + POI)
 * full at = now + (max - current) / rate hours; rate <= 0 or unknown → "—".
 * A value whose getter is missing or throws is null ("—").
 */
import { t } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { OverviewPanel, renderTable, ownBases, openBase } from '../lib/overview-panel.js';

const TOOLBAR_ID = 'resources';
export const RESOURCES = ['tib', 'cry', 'power'];
const RES_KEY = { tib: 'resTiberium', cry: 'resCrystal', power: 'resPower' };
export const WARN_PCT = 75;
const RED = 'color:#ff5252;font-weight:bold;';
const YELLOW = 'color:#ffd740;';

function num(fn) {
    try {
        const v = Number(fn());
        return Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

/** Fill % (0-100+), or null. */
export function pct(cur, max) {
    if (cur === null || max === null || !(max > 0)) return null;
    return (cur / max) * 100;
}

/**
 * When the storage is full: a timestamp (ms), `now` when already full, or null
 * (unknown, or not filling).
 */
export function fullAt(cur, max, ratePerHour, now) {
    if (cur === null || max === null || !(max > 0)) return null;
    if (cur >= max) return now;
    if (ratePerHour === null || !(ratePerHour > 0)) return null;
    return now + ((max - cur) / ratePerHour) * 3600 * 1000;
}

/** "14:05" today, "12.11. 14:05" on another day; "full" when already full; null → "—". */
export function formatFullAt(ts, now) {
    if (ts === null || ts === undefined) return '—';
    if (ts <= now) return t('resFull');
    const d = new Date(ts);
    const n = new Date(now);
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (d.toDateString() === n.toDateString()) return time;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${time}`;
}

/** Colour for a fill %: red when full, yellow above 75 %. */
export function levelStyle(p) {
    if (p === null || p === undefined) return '';
    if (p >= 100) return RED;
    if (p > WARN_PCT) return YELLOW;
    return '';
}

/** Table values of one base: { tib_cur, tib_max, tib_pct, tib_full, ... }. */
export function readCity(city, now) {
    const R = ClientLib.Base.EResourceType;
    const v = {};
    for (const [key, type] of [['tib', R.Tiberium], ['cry', R.Crystal], ['power', R.Power]]) {
        const cur = num(() => city.GetResourceCount(type));
        const max = num(() => city.GetResourceMaxStorage(type));
        const rate = num(() => city.GetResourceGrowPerHour(type, true, true));
        v[`${key}_cur`] = cur;
        v[`${key}_max`] = max;
        v[`${key}_pct`] = pct(cur, max);
        const full = fullAt(cur, max, rate, now);
        v[`${key}_full`] = full === null ? null : Math.round(full / 60000) * 60000;   // minutes: no redraw every 5 s
    }
    return v;
}

/** Total row: summed stock and storage, overall %, no "full at". */
export function totals(rows) {
    const v = {};
    for (const r of RESOURCES) {
        let cur = null;
        let max = null;
        for (const row of rows) {
            const c = row.values[`${r}_cur`];
            const m = row.values[`${r}_max`];
            if (c !== null && m !== null) {
                cur = (cur || 0) + c;
                max = (max || 0) + m;
            }
        }
        v[`${r}_cur`] = cur;
        v[`${r}_max`] = max;
        v[`${r}_pct`] = pct(cur, max);
        v[`${r}_full`] = null;
    }
    return v;
}

export function columns(now) {
    const cols = [];
    for (const r of RESOURCES) {
        const group = t(RES_KEY[r]);
        const rowPct = (row) => row.values[`${r}_pct`];
        cols.push({ key: `${r}_cur`, group, label: t('resColCurrent'), style: (v, row) => levelStyle(rowPct(row)) });
        cols.push({ key: `${r}_max`, group, label: t('resColMax') });
        cols.push({
            key: `${r}_pct`, group, label: '%',
            format: (v) => (v === null || v === undefined ? '—' : `${Math.floor(v)}%`),
            style: (v) => levelStyle(v),
        });
        cols.push({
            key: `${r}_full`, group, label: t('resColFullAt'),
            format: (v, row) => (row.id === undefined ? '' : formatFullAt(v, now)),
            style: (v, row) => levelStyle(rowPct(row)),
        });
    }
    return cols;
}

export class ResourceOverview {
    /** Short description for `/st help`. */
    get description() { return t('descResourceOverview'); }

    constructor(config, toolbar, cli) {
        this.name = 'ResourceOverview';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.panel = new OverviewPanel(config, {
            id: 'st-resource-panel',
            prefix: 'ResourceOverview',
            width: 760,
            title: () => t('resTitle'),
            read: () => this.read(),
            render: (data) => renderTable({ columns: columns(data.now), rows: data.rows, total: data.total, jumpHint: t('ovJumpHint') }),
            onRowClick: (id) => openBase(id),
        });
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.silo,
            label: () => t('toolbarResources'),
            onClick: () => this.panel.toggle(),
        });
        this.cli.register('resources', () => this.panel.toggle());
    }

    stop() {
        this.running = false;
        this.panel.destroy();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('resources');
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t(this.panel.isOpen() ? 'resStatusOpen' : 'resStatusClosed');
    }

    /** { now, rows: [{id, name, values}], total: {values} }, or null without city data. */
    read(now = Date.now()) {
        // Round to the minute: "full at" shows minutes, and the panel only re-renders on a change
        now = Math.floor(now / 60000) * 60000;
        const rows = ownBases().map(city => ({
            id: city.get_Id(),
            name: city.get_Name(),
            values: readCity(city, now),
        }));
        if (!rows.length) return null;
        // stock rounded so the 5 s refresh does not redraw for every unit produced
        for (const row of rows) for (const r of RESOURCES) {
            const k = `${r}_cur`;
            if (row.values[k] !== null) row.values[k] = Math.floor(row.values[k]);
        }
        return { now, rows, total: { values: totals(rows) } };
    }
}

