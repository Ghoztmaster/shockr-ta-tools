// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * marker-nav.js — Marker Navigator: the own map markers in a panel, click to jump.
 *
 * The markers players put on the map ("Set marker", e.g. a Layout reservation)
 * are alliance markers: alliance.get_Markers().l, each with get_Type(),
 * get_NamePlayerCreated(), get_CoordX(), get_CoordY() (seen live 2026-10-20).
 * The panel lists the ones placed by the current player. Name / description
 * getters are not confirmed, so markerText() tries a few likely names and the
 * first open logs the marker's get_* methods to the console once.
 *
 * Re-read on open and every 2 s while open; no AllianceMarkerChange listener
 * (a handler on that event crashed the game when a marker was deleted). A
 * marker whose getters throw (half-deleted) is skipped.
 *
 * Opened from the Shockr toolbar (pin icon) or `/st markers`. Click on a row:
 * world map, centred on that marker (target-board's centerMap).
 */
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';
import { centerMap } from './target-board.js';

const PANEL_ID = 'st-markernav-panel';
const TOOLBAR_ID = 'markernav';
const REFRESH_INTERVAL_MS = 2000;
const PANEL_WIDTH = 340;
const DEFAULT_POSITION = { x: 130, y: 90 };

/** Alliance marker type of a reservation (seen live 2026-10-20; the game has no named enum for it). */
export const RESERVE_MARKER_TYPE = 5;

/** Candidate getters for the marker's own text; the first non-empty string wins. */
const TEXT_GETTERS = ['get_Name', 'get_Title', 'get_Caption', 'get_Description', 'get_Text', 'get_Comment', 'get_Message'];

/** The marker's own text (name or description), or ''. */
export function markerText(m) {
    for (const g of TEXT_GETTERS) {
        try {
            if (typeof m[g] !== 'function') continue;
            const v = m[g]();
            if (typeof v === 'string' && v.trim()) return v.trim();
        } catch { /* getter not usable: next */ }
    }
    return '';
}

/**
 * Markers placed by `playerName`, as [{x, y, type, text}], in the game's order.
 * A marker whose getters throw (seen right after a marker is deleted) is skipped.
 */
export function ownMarkers(markers, playerName) {
    if (!playerName) return [];
    const out = [];
    for (const m of markers || []) {
        try {
            if (m.get_NamePlayerCreated() !== playerName) continue;
            const x = m.get_CoordX();
            const y = m.get_CoordY();
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            out.push({ x, y, type: m.get_Type(), text: markerText(m) });
        } catch { /* broken marker object: skip */ }
    }
    return out;
}

export function typeLabel(type) {
    return type === RESERVE_MARKER_TYPE ? t('markerNavTypeReserve') : t('markerNavTypeOther', { n: type });
}

export function renderList(rows) {
    if (!rows.length) {
        return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('markerNavEmpty'))}</div>`;
    }
    const th = 'padding:3px 4px;text-align:left;font-weight:normal;color:#999;border-bottom:1px solid #444;';
    const td = 'padding:3px 4px;vertical-align:top;';
    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr><th style="${th}">${escapeHtml(t('markerNavColMarker'))}</th><th style="${th}">${escapeHtml(t('markerNavColCoords'))}</th></tr>`;
    for (const m of rows) {
        html += `<tr data-x="${m.x}" data-y="${m.y}" title="${escapeHtml(t('markerNavCenterHint'))}" style="box-shadow:inset 3px 0 0 #555;cursor:pointer;border-bottom:1px solid #2a2a2a;">`
            + `<td style="${td}padding-left:8px;"><div style="color:#e0e0e0;">${escapeHtml(typeLabel(m.type))}</div>`
            + (m.text ? `<div style="color:#aaa;">${escapeHtml(m.text)}</div>` : '')
            + `</td><td style="${td}white-space:nowrap;color:#4fc3f7;">${m.x}:${m.y}</td></tr>`;
    }
    return html + '</table>';
}

export class MarkerNav {
    /** Short description for `/st help`. */
    get description() { return t('descMarkerNav'); }

    constructor(config, toolbar, cli) {
        this.name = 'MarkerNav';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._title = null;
        this._content = null;
        this._timer = null;
        this._rows = null;        // last read, null = no marker data
        this._shown = null;       // JSON of what the panel shows (no re-render, no hover flicker)
        this._logged = false;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.pin,
            label: () => t('toolbarMarkerNav'),
            onClick: () => this.toggle(),
        });
        this.cli.register('markers', () => this.toggle());
    }

    stop() {
        this.running = false;
        this.close();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('markers');
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.isOpen()) return t('markerNavStatusClosed');
        return t('markerNavStatusOpen', { n: this._rows ? this._rows.length : 0 });
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
        this._refresh();
        this._timer = setInterval(() => this._refresh(), REFRESH_INTERVAL_MS);
    }

    close() {
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._panel) this._panel.style.display = 'none';
    }

    /** Own markers from the client, or null when there is no alliance / player data. */
    _read() {
        try {
            const md = ClientLib.Data.MainData.GetInstance();
            const list = md.get_Alliance().get_Markers().l;
            if (!this._logged && list && list.length) {
                this._logged = true;
                logGetters(list[0]);
            }
            return ownMarkers(list, md.get_Player().get_Name());
        } catch {
            return null;
        }
    }

    _refresh() {
        if (!this.isOpen()) return;
        this._rows = this._read();
        const key = JSON.stringify(this._rows);
        if (key === this._shown) return;
        this._shown = key;
        const count = this._rows ? ` <span style="color:#aaa;">(${this._rows.length})</span>` : '';
        this._title.innerHTML = `<b style="color:#fff;">${escapeHtml(t('markerNavTitle'))}</b>${count}`;
        if (!this._rows) {
            this._content.innerHTML = `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('markerNavNoData'))}</div>`;
            return;
        }
        this._content.innerHTML = renderList(this._rows);
        this._content.querySelectorAll('tr[data-x]').forEach((tr) => {
            tr.addEventListener('click', () => centerMap(Number(tr.dataset.x), Number(tr.dataset.y)));
        });
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;

        const pos = clampPosition(loadPosition(this.config, 'MarkerNav', DEFAULT_POSITION),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        // Same look as the TargetBoard panel
        panel.style.cssText = `
            display: none;
            position: fixed;
            left: ${pos.x}px;
            top: ${pos.y}px;
            z-index: 10000;
            width: ${PANEL_WIDTH}px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;

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
        content.style.cssText = 'max-height:60vh;overflow-y:auto;padding:4px 10px 8px;';

        panel.append(header, content);
        document.body.appendChild(panel);
        makeDraggable(panel, header, { config: this.config, prefix: 'MarkerNav' });
        this._panel = panel;
        this._title = title;
        this._content = content;
    }
}

/** One console line with a marker's get_* methods, to find its name/description getter live. */
function logGetters(m) {
    try {
        const names = new Set();
        for (let o = m; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
            for (const k of Object.getOwnPropertyNames(o)) if (k.startsWith('get_')) names.add(k);
        }
        console.log('[ST] MarkerNav: marker getters', [...names].sort().join(', '));
    } catch { /* informational only */ }
}
