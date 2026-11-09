// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * overview-panel.js — shared panel + table for the per-base overviews (5.39.0).
 *
 * ProductionOverview (5.39.0), and later ResourceOverview and ArmyOverview, all
 * show one row per own base, a total row and "click the base name to open it".
 * This module holds that once:
 *
 *   new OverviewPanel(config, { id, prefix, width, title, read, render, onRowClick })
 *     read()      — the data (or null = no data); re-read on open and every
 *                   REFRESH_MS while open, re-rendered only when it changed
 *     render(d)   — HTML for the content
 *     onRowClick  — called with the row's data-id (a base id) on a click on
 *                   an element with [data-id]
 *   renderTable({ columns, rows, total }) — the shared table markup
 *   ownBases()   — own, non-ghost bases in the game's order
 *   openBase(id) — open that base in the main window
 *   compact(n)   — 1234567 → "1.23M"
 *
 * Same DOM look as the MarkerNav / TargetBoard panels (not qooxdoo windows):
 * draggable header (position in <prefix>.x / .y), ✕ and Escape close.
 */
import { t, escapeHtml } from './i18n.js';
import { makeDraggable, loadPosition, clampPosition } from './drag.js';

const REFRESH_MS = 5000;

/** Own, non-ghost bases, as ClientLib city objects, in the game's order. */
export function ownBases() {
    const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
    const out = [];
    for (const city of Object.values(all)) {
        try {
            if (city && city.IsOwnBase() && !city.get_IsGhostMode()) out.push(city);
        } catch { /* half-loaded city: skip */ }
    }
    return out;
}

/**
 * Open an own base in the main window (base view).
 * NOT VERIFIED LIVE: webfrontend.gui.UtilView.openCityInMainWindow (MaelstromTools'
 * route); fallback: make it the current own city and switch the play area to it.
 */
export function openBase(id) {
    try {
        const uv = webfrontend.gui.UtilView;
        if (uv && typeof uv.openCityInMainWindow === 'function') {
            uv.openCityInMainWindow(id);
            return true;
        }
    } catch { /* fallback below */ }
    try {
        const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
        cities.set_CurrentCityId(id);
        cities.set_CurrentOwnCityId(id);
        qx.core.Init.getApplication().getPlayArea().setView(ClientLib.Data.PlayerAreaViewMode.pavmPlayerBase, id, 0, 0);
        return true;
    } catch (err) {
        console.warn('[ST] Overview: open base failed', err && err.message);
        return false;
    }
}

/** Short number: 950 → "950", 12345 → "12.3k", 1234567 → "1.23M", 2.5e9 → "2.50G"; null → "—". */
export function compact(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}G`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(1)}k`;
    return `${sign}${Math.round(a)}`;
}

/**
 * The shared table: a name column plus `columns`, optionally grouped under a
 * second header row (`group`), and a total row.
 * @param {object} spec
 * @param {Array<{key: string, label: string, group?: string, format?: Function, style?: Function}>} spec.columns
 *   format(value, row) → text (default compact); style(value, row) → extra CSS for the cell
 * @param {Array<{id: number, name: string, values: object}>} spec.rows
 * @param {?{name?: string, values: object}} spec.total
 * @param {string} [spec.jumpHint] — tooltip on the base name
 */
export function renderTable({ columns, rows, total = null, jumpHint = '' }) {
    const th = 'padding:3px 5px;font-weight:normal;color:#999;white-space:nowrap;';
    const td = 'padding:3px 5px;text-align:right;white-space:nowrap;';
    const sep = 'border-left:1px solid #333;';
    const groupStart = (i) => i > 0 && columns[i].group !== columns[i - 1].group;
    const cell = (c, i, v, row) => {
        const text = c.format ? c.format(v, row) : compact(v);
        const extra = c.style ? (c.style(v, row) || '') : '';
        return `<td style="${td}${groupStart(i) || i === 0 ? sep : ''}${extra}">${escapeHtml(String(text))}</td>`;
    };

    let html = '<table style="border-collapse:collapse;width:100%;">';
    if (columns.some(c => c.group)) {
        html += `<tr><th style="${th}"></th>`;
        for (let i = 0; i < columns.length;) {
            let span = 1;
            while (i + span < columns.length && columns[i + span].group === columns[i].group) span++;
            html += `<th colspan="${span}" style="${th}${sep}text-align:center;color:#ccc;">${escapeHtml(columns[i].group || '')}</th>`;
            i += span;
        }
        html += '</tr>';
    }
    html += `<tr style="border-bottom:1px solid #444;"><th style="${th}text-align:left;">${escapeHtml(t('ovColBase'))}</th>`;
    columns.forEach((c, i) => {
        html += `<th style="${th}text-align:right;${groupStart(i) || i === 0 ? sep : ''}">${escapeHtml(c.label)}</th>`;
    });
    html += '</tr>';

    for (const row of rows) {
        html += '<tr style="border-bottom:1px solid #2a2a2a;">'
            + `<td data-id="${escapeHtml(String(row.id))}" title="${escapeHtml(jumpHint)}" style="padding:3px 5px;color:#4fc3f7;cursor:pointer;white-space:nowrap;">${escapeHtml(row.name)}</td>`;
        columns.forEach((c, i) => { html += cell(c, i, row.values[c.key], row); });
        html += '</tr>';
    }
    if (total) {
        html += `<tr style="border-top:2px solid #555;font-weight:bold;"><td style="padding:3px 5px;color:#fff;">${escapeHtml(total.name || t('ovTotal'))}</td>`;
        columns.forEach((c, i) => { html += cell(c, i, total.values[c.key], total); });
        html += '</tr>';
    }
    return html + '</table>';
}

export class OverviewPanel {
    constructor(config, { id, prefix, width = 600, defaultPosition = { x: 140, y: 90 }, title, read, render, onRowClick }) {
        this.config = config;
        this._opts = { id, prefix, width, defaultPosition, title, read, render, onRowClick };
        this._panel = null;
        this._title = null;
        this._content = null;
        this._timer = null;
        this._shown = null;
        this.data = null;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        this._ensurePanel();
        this._shown = null;
        this._panel.style.display = 'block';
        document.addEventListener('keydown', this._onKeyDown);
        this.refresh();
        this._timer = setInterval(() => this.refresh(), REFRESH_MS);
    }

    close() {
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._panel) this._panel.style.display = 'none';
    }

    /** Close and remove the DOM (the plugin's stop()). */
    destroy() {
        this.close();
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    refresh() {
        if (!this.isOpen()) return;
        let data = null;
        try {
            data = this._opts.read();
        } catch (err) {
            console.error(`[ST] ${this._opts.prefix}: read failed`, err);
        }
        this.data = data;
        const key = JSON.stringify(data);
        if (key === this._shown) return;
        this._shown = key;
        this._title.innerHTML = `<b style="color:#fff;">${escapeHtml(this._opts.title())}</b>`;
        if (!data) {
            this._content.innerHTML = `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('ovNoData'))}</div>`;
            return;
        }
        this._content.innerHTML = this._opts.render(data);
        if (this._opts.onRowClick) {
            this._content.querySelectorAll('[data-id]').forEach((el) => {
                el.addEventListener('click', () => this._opts.onRowClick(Number(el.dataset.id)));
            });
        }
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;
        const { id, prefix, width, defaultPosition } = this._opts;
        const pos = clampPosition(loadPosition(this.config, prefix, defaultPosition),
            { w: Math.min(width, window.innerWidth), h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = id;
        panel.style.cssText = `
            display: none; position: fixed; left: ${pos.x}px; top: ${pos.y}px; z-index: 10000;
            width: ${width}px; max-width: calc(100vw - 16px); box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92); color: #ddd;
            border: 1px solid #444; border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; pointer-events: auto;`;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:8px 10px 6px;cursor:move;user-select:none;border-bottom:1px solid #333;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1;min-width:0;';
        const close = document.createElement('div');
        close.textContent = '✕';
        close.title = t('close');
        close.style.cssText = 'cursor:pointer;color:#999;font-size:14px;line-height:1;';
        close.addEventListener('mousedown', (e) => e.stopPropagation());   // not a drag
        close.addEventListener('click', () => this.close());
        close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
        close.addEventListener('mouseleave', () => { close.style.color = '#999'; });
        header.append(title, close);

        const content = document.createElement('div');
        content.style.cssText = 'max-height:65vh;overflow:auto;padding:4px 10px 8px;';

        panel.append(header, content);
        document.body.appendChild(panel);
        makeDraggable(panel, header, { config: this.config, prefix });
        this._panel = panel;
        this._title = title;
        this._content = content;
    }
}
