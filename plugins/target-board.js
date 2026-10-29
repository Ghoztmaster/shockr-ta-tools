// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * target-board.js — the alliance's Target Watch overview in-game (5.26.0).
 *
 * The same overview as the website's Target Watch page (server/static/targets.html):
 * which targets alliance members are looking at right now, who, and since when.
 * Opened from the Shockr toolbar or `/st targets`.
 *
 * Data: GET /api/target-watch/{worldId} with the personal key (the endpoint
 * TargetWatcher's game-page calls already use, with its CORS). The website's
 * /api/targets needs a website login, which the game page does not have; this
 * one gives the caller's own alliance for the current world.
 *   → { targets: [{ targetId, targetName, targetX, targetY, targetLevel, targetType,
 *                   watchers: [{ playerId, playerName, timestamp }] }] }   — timestamp unix s
 *
 * Requests only while the panel is open: one on open, then every 20 s; closing
 * stops the timer. Needs a server + key (api.isConfigured, the TargetWatcher
 * check) — without them the toolbar item is hidden.
 *
 * Click on a row: world map, centred on that target (centerMap, also used by
 * plugins/marker-nav.js).
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';
import { formatLevel } from './target-watcher.js';

const PANEL_ID = 'st-targetboard-panel';
const TOOLBAR_ID = 'targetboard';
const REFRESH_INTERVAL_MS = 20000;
const PANEL_WIDTH = 400;
const DEFAULT_POSITION = { x: 130, y: 46 };

/** ≥ this many watchers = possible double attack (orange row, as on the website). */
const DOUBLE_WATCHERS = 2;

export class TargetBoard {
    /** Short description for `/st help`. */
    get description() { return t('descTargetBoard'); }

    constructor(config, api, toolbar, cli) {
        this.name = 'TargetBoard';
        this.config = config;
        this.api = api;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._title = null;
        this._content = null;
        this._timer = null;
        this._targets = null;     // last good response (kept when a refresh fails)
        this._updatedAt = null;
        this._error = false;
        this._loading = false;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.radar,
            label: () => t('toolbarTargetBoard'),
            onClick: () => this.toggle(),
            isAvailable: () => this.api.isConfigured,
        });
        this.cli.register('targets', () => this.toggle());
    }

    stop() {
        this.running = false;
        this.close();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('targets');
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return '/st plugin enable target-board';
        if (!this.api.isConfigured) return t('targetBoardNoServer');
        return t(this.isOpen() ? 'targetBoardStatusOpen' : 'targetBoardStatusClosed');
    }

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        if (!this.api.isConfigured) {
            chatMessage(`[ST] ${t('targetBoardNoServer')}`);
            return;
        }
        this._ensurePanel();
        this._targets = null;
        this._error = false;
        this._render();
        this._panel.style.display = 'block';
        document.addEventListener('keydown', this._onKeyDown);
        this._load();
        this._timer = setInterval(() => this._load(), REFRESH_INTERVAL_MS);
    }

    close() {
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._panel) this._panel.style.display = 'none';
    }

    async _load() {
        if (this._loading) return;
        const worldId = currentWorldId();
        if (worldId === null) return;
        this._loading = true;
        let data = null;
        try {
            data = await this.api.request('GET', `/api/target-watch/${worldId}`);
        } finally {
            this._loading = false;
        }
        if (!this.isOpen()) return;   // closed while the request ran
        if (data && Array.isArray(data.targets)) {
            this._targets = data.targets;
            this._updatedAt = new Date();
            this._error = false;
        } else {
            this._error = true;
        }
        this._render();
    }

    _render() {
        const rows = this._targets ? sortTargets(this._targets) : null;
        this._title.innerHTML = renderTitle(rows, this._updatedAt, this._error);
        if (!rows) {
            this._content.innerHTML = `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t(this._error ? 'targetBoardFailed' : 'targetBoardLoading'))}</div>`;
            return;
        }
        this._content.innerHTML = renderTable(rows, Date.now());
        this._content.querySelectorAll('tr[data-x]').forEach((tr) => {
            tr.addEventListener('click', () => centerMap(Number(tr.dataset.x), Number(tr.dataset.y)));
        });
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;

        const pos = clampPosition(loadPosition(this.config, 'TargetBoard', DEFAULT_POSITION),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        // Same look as the help / UpgradeCalc panels
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
        makeDraggable(panel, header, { config: this.config, prefix: 'TargetBoard' });
        this._panel = panel;
        this._title = title;
        this._content = content;
    }
}

/** Most watchers first, then most recently seen (the website's order). */
export function sortTargets(targets) {
    return targets
        .filter(tg => tg && Array.isArray(tg.watchers) && tg.watchers.length)
        .sort((a, b) => (b.watchers.length - a.watchers.length) || (latest(b) - latest(a)));
}

function latest(target) {
    return Math.max(...target.watchers.map(w => toMs(w.timestamp)));
}

/** Unix seconds or ms → ms. */
function toMs(ts) {
    const n = Number(ts) || 0;
    return n < 1e12 ? n * 1000 : n;
}

/** "now", "2 min", "1 h" — rounded down. */
export function relativeTime(ms, now) {
    const min = Math.floor(Math.max(0, now - ms) / 60000);
    if (min < 1) return t('targetBoardAgoNow');
    if (min < 60) return t('targetBoardAgoMin', { n: min });
    return t('targetBoardAgoHour', { n: Math.floor(min / 60) });
}

function renderTitle(rows, updatedAt, error) {
    let html = `<b style="color:#fff;">🎯 Target Watch</b>`;
    if (rows) html += ` <span style="color:#aaa;">(${rows.length})</span>`;
    if (updatedAt) {
        const time = updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        html += ` <span style="color:#777;font-size:11px;">· ${escapeHtml(t('targetBoardUpdated', { time }))}</span>`;
    }
    if (error && rows) html += ` <span style="color:#e57373;font-size:11px;">· ${escapeHtml(t('targetBoardRefreshFailed'))}</span>`;
    return html;
}

export function renderTable(rows, now) {
    if (!rows.length) {
        return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('targetBoardEmpty'))}</div>`;
    }
    const th = 'padding:3px 4px;text-align:left;font-weight:normal;color:#999;border-bottom:1px solid #444;';
    const td = 'padding:3px 4px;vertical-align:top;';
    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr><th style="${th}">${escapeHtml(t('targetBoardColTarget'))}</th><th style="${th}">${escapeHtml(t('targetBoardColLevel'))}</th>`
        + `<th style="${th}">${escapeHtml(t('targetBoardColWatchers'))}</th><th style="${th}white-space:nowrap;">${escapeHtml(t('targetBoardColSeen'))}</th></tr>`;
    for (const tg of rows) {
        const double = tg.watchers.length >= DOUBLE_WATCHERS;
        const rowStyle = double
            ? 'background:#3a2e14;box-shadow:inset 3px 0 0 #ff9800;'
            : 'box-shadow:inset 3px 0 0 #555;';
        const x = Number(tg.targetX);
        const y = Number(tg.targetY);
        const names = tg.watchers.map(w => escapeHtml(w.playerName || '?')).join(', ');
        html += `<tr data-x="${x}" data-y="${y}" title="${escapeHtml(t('targetBoardCenterHint'))}" style="${rowStyle}cursor:pointer;border-bottom:1px solid #2a2a2a;">`
            + `<td style="${td}padding-left:8px;"><div style="color:#e0e0e0;">${escapeHtml(tg.targetName || '?')}</div>`
            + `<div style="color:#4fc3f7;">${x}:${y}</div></td>`
            + `<td style="${td}white-space:nowrap;">L${formatLevel(tg.targetLevel)}</td>`
            + `<td style="${td}"><span style="color:${double ? '#ffb74d' : '#aaa'};font-weight:${double ? 'bold' : 'normal'};">${tg.watchers.length}</span> · ${names}</td>`
            + `<td style="${td}white-space:nowrap;color:#888;">${escapeHtml(relativeTime(latest(tg), now))}</td></tr>`;
    }
    return html + '</table>';
}

function currentWorldId() {
    try {
        return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId());
    } catch {
        return null;
    }
}

/**
 * World map centred on (x, y). From a base view, first back to the world map
 * (setView pavmNone - what the game's own "World" button does), then centre.
 */
export function centerMap(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
        const vis = ClientLib.Vis.VisMain.GetInstance();
        if (vis.get_Mode() !== ClientLib.Vis.Mode.Region) {
            qx.core.Init.getApplication().getPlayArea().setView(ClientLib.Data.PlayerAreaViewMode.pavmNone, -1, 0, 0);
        }
        vis.CenterGridPosition(x, y);
    } catch (e) {
        console.warn('[ST] TargetBoard: centre map failed', e && e.message);
    }
}
