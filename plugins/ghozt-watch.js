// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * ghozt-watch.js — GhoztWatch: follow marked enemy players over time (5.53.0).
 *
 * Off by default — `/st plugin enable ghoztwatch`. Phase 1 = passive: no attack
 * range needed, only the public player info every player can open in the game.
 *
 *   /st ghoztwatch add <name> | remove <name> | list | clear   (bare: panel)
 *
 * Data (verified live on game 26.1, 2026-11-17):
 *   SendSimpleCommand('GetPublicPlayerInfoByName', {name}) and
 *   SendSimpleCommand('GetPublicPlayerInfo', {id}) both answer with
 *   { i: playerId, n: name, a/an: alliance id/name, f: faction (1 GDI, 2 NOD),
 *     r: rank, p: points, bd/bde: bases destroyed total/PvE (PvP = bd - bde),
 *     c: [{i: cityId, n, p, x, y}] }.
 *   One player per call; no rate limit documented — the poll waits GAP_MS
 *   between players (20 players = 20 calls per 5 min).
 *
 * There is NO online field for players outside the own alliance (OnlineState
 * only lives in the own alliance's member data). "Online" is therefore
 * activity: TA upgrades are instant, so rising points mean the player is
 * playing right now. 🟢 points rose < 15 min ago, 🟡 < 60 min, ⚫ otherwise.
 *
 * Events come from comparing each answer with the stored snapshot, so the same
 * state never alerts twice (also not after a reload: the snapshot is stored).
 *   active / inactive  — state transitions (active after growth, inactive after 60 min without)
 *   base_count         — number of bases changed (MCV placed or base lost)
 *   attack             — bd/bde rose (the player destroyed bases)
 *   alliance_change, name_change
 *   defense_changed, unit_upgrade — phase 2 (active scan in range), not produced yet
 *
 * Storage: localStorage `st-ghoztwatch-{worldId}` = {v: 1, players: [...]},
 * max 20 players, max 100 history entries per player. Client-only, no server.
 * Polls only while the game is open (the script runs in the browser).
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';
import { compact } from '../lib/overview-panel.js';

const PANEL_ID = 'st-ghoztwatch-panel';
const TOOLBAR_ID = 'ghoztwatch';
const CMD = 'ghoztwatch';
const PANEL_WIDTH = 560;
const DEFAULT_POSITION = { x: 140, y: 56 };

export const POLL_MS = 5 * 60 * 1000;
const GAP_MS = 500;
const TIMEOUT_MS = 5000;
export const MAX_PLAYERS = 20;
export const MAX_HISTORY = 100;
export const ACTIVE_MS = 15 * 60 * 1000;
export const RECENT_MS = 60 * 60 * 1000;

/** Every type the history accepts; the last two are produced by phase 2. */
export const EVENT_TYPES = ['active', 'inactive', 'base_count', 'attack', 'alliance_change', 'name_change', 'defense_changed', 'unit_upgrade'];
const EVENT_KEY = {
    active: 'gwEvActive', inactive: 'gwEvInactive', base_count: 'gwEvBaseCount', attack: 'gwEvAttack',
    alliance_change: 'gwEvAllianceChange', name_change: 'gwEvNameChange',
    defense_changed: 'gwEvDefenseChanged', unit_upgrade: 'gwEvUnitUpgrade',
};
const FACTION = { 1: 'GDI', 2: 'NOD' };
const STATUS_ICON = { green: '🟢', yellow: '🟡', grey: '⚫' };

/** A new, empty record for `playerId`; applyInfo() fills it on the first answer. */
export function newRecord(playerId, now) {
    return {
        playerId, name: '', alliance: '', allianceId: 0, faction: 0, rank: 0,
        points: null, bd: 0, bde: 0, baseCount: 0, bases: [],
        state: null, lastActive: null, lastPoll: null, addedAt: now,
        defense: null,   // phase 2: last defense scan
        history: [],
    };
}

/** Append an event, keeping the last MAX_HISTORY. */
export function pushEvent(rec, event) {
    if (!EVENT_TYPES.includes(event.event)) return;
    rec.history.push(event);
    if (rec.history.length > MAX_HISTORY) rec.history.splice(0, rec.history.length - MAX_HISTORY);
}

/**
 * Pure: compare a PublicPlayerInfo answer with the record, update the record
 * and return the new events. The first answer (points still null) is the
 * baseline and gives no events.
 * @returns {Array<{ts, event, detail}>}
 */
export function applyInfo(rec, info, now) {
    const events = [];
    const ev = (event, detail) => events.push({ ts: now, event, detail });
    const bases = Array.isArray(info.c) ? info.c.map(c => ({ i: c.i, n: String(c.n || ''), p: Number(c.p) || 0, x: c.x, y: c.y })) : [];
    const points = Number(info.p) || 0;
    const bd = Number(info.bd) || 0;
    const bde = Number(info.bde) || 0;
    const name = String(info.n || rec.name || '');
    const allianceId = Number(info.a) || 0;
    const alliance = String(info.an || '');

    if (rec.points !== null) {
        if (rec.name && name !== rec.name) ev('name_change', `${rec.name} → ${name}`);
        if (allianceId !== rec.allianceId) ev('alliance_change', `${rec.alliance || '-'} → ${alliance || '-'}`);
        if (bases.length !== rec.baseCount) ev('base_count', `${rec.baseCount} → ${bases.length}${baseDiff(rec.bases, bases)}`);
        const pvp = (bd - bde) - (rec.bd - rec.bde);
        const pve = bde - rec.bde;
        if (pvp > 0 || pve > 0) ev('attack', [pvp > 0 && `PvP +${pvp}`, pve > 0 && `PvE +${pve}`].filter(Boolean).join(' · '));
        if (points > rec.points) {
            rec.lastActive = now;
            if (rec.state !== 'active') {
                rec.state = 'active';
                ev('active', `+${compact(points - rec.points)}`);
            }
        } else if (rec.state === 'active' && rec.lastActive !== null && now - rec.lastActive >= RECENT_MS) {
            rec.state = 'inactive';
            ev('inactive', '');
        }
    }

    Object.assign(rec, {
        name, allianceId, alliance, points, bd, bde, bases, baseCount: bases.length,
        faction: Number(info.f) || 0, rank: Number(info.r) || 0, lastPoll: now,
    });
    for (const e of events) pushEvent(rec, e);
    return events;
}

/** " (+Name 3, -Name 1)" for the bases that came and went (by city id). */
function baseDiff(before, after) {
    const had = new Set(before.map(b => b.i));
    const has = new Set(after.map(b => b.i));
    const parts = [
        ...after.filter(b => !had.has(b.i)).map(b => `+${b.n}`),
        ...before.filter(b => !has.has(b.i)).map(b => `-${b.n}`),
    ];
    return parts.length ? ` (${parts.join(', ')})` : '';
}

/** 'green' | 'yellow' | 'grey' from the last points growth. */
export function statusOf(rec, now) {
    if (rec.lastActive === null) return 'grey';
    const age = now - rec.lastActive;
    if (age < ACTIVE_MS) return 'green';
    if (age < RECENT_MS) return 'yellow';
    return 'grey';
}

/** The chat/panel text of one event, without the player name. */
export function eventText(e) {
    return t(EVENT_KEY[e.event] || 'gwEvActive', { detail: e.detail || '' });
}

export function relativeTime(ms, now) {
    if (ms === null || ms === undefined) return t('gwNever');
    const min = Math.floor(Math.max(0, now - ms) / 60000);
    if (min < 1) return t('gwAgoNow');
    if (min < 60) return t('gwAgoMin', { n: min });
    if (min < 48 * 60) return t('gwAgoHour', { n: Math.floor(min / 60) });
    return t('gwAgoDay', { n: Math.floor(min / 1440) });
}

/** Promise wrapper around a read-only public-info server command; null on failure/timeout. */
function serverCommand(command, params) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
        try {
            ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand(
                command, params,
                webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, null, (ctx, data) => {
                    clearTimeout(timer);
                    resolve(data && typeof data === 'object' ? data : null);
                }),
                null,
            );
        } catch (e) {
            clearTimeout(timer);
            console.warn(`[ST] GhoztWatch: ${command} failed`, e && e.message);
            resolve(null);
        }
    });
}

export const fetchById = (id) => serverCommand('GetPublicPlayerInfo', { id });
export const fetchByName = (name) => serverCommand('GetPublicPlayerInfoByName', { name });

const say = (msg) => chatMessage(`[GW] 🔍 ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class GhoztWatch {
    /** Short description for `/st help`. */
    get description() { return t('descGhoztWatch'); }

    constructor(config, toolbar, cli) {
        this.name = 'GhoztWatch';
        this.defaultEnabled = false;
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.gapMs = GAP_MS;
        this.players = [];
        this._key = null;
        this._timer = null;
        this._polling = false;
        this._panel = null;
        this._title = null;
        this._content = null;
        this._expanded = new Set();
        this._onKeyDown = (e) => { if (e.key === 'Escape') this.close(); };
    }

    async start() {
        this.running = true;
        this._load();
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.eye,
            label: () => t('toolbarGhoztWatch'),
            onClick: () => this.toggle(),
        });
        this.cli.register(CMD, (args) => this.command(args));
        this._timer = setInterval(() => this.poll(), POLL_MS);
        if (this.players.length) this.poll();
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this.close();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister(CMD);
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('gwStatus', { n: this.players.length, max: MAX_PLAYERS });
    }

    // ── storage ──

    _storageKey() {
        if (this._key) return this._key;
        try {
            const world = ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId();
            if (world) this._key = `st-ghoztwatch-${world}`;
        } catch { /* game not ready */ }
        return this._key;
    }

    _load() {
        const key = this._storageKey();
        this.players = [];
        if (!key) return;
        try {
            const data = JSON.parse(localStorage.getItem(key) || 'null');
            if (data && Array.isArray(data.players)) this.players = data.players.slice(0, MAX_PLAYERS);
        } catch (e) {
            console.warn('[ST] GhoztWatch: stored list unreadable', e && e.message);
        }
    }

    _save() {
        const key = this._storageKey();
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify({ v: 1, players: this.players }));
        } catch (e) {
            console.warn('[ST] GhoztWatch: save failed', e && e.message);
        }
    }

    // ── commands ──

    async command(args) {
        const [action, ...rest] = args || [];
        const name = rest.join(' ').trim();
        switch ((action || '').toLowerCase()) {
            case '': return this.toggle();
            case 'add': return name ? this.add(name) : say(escapeHtml(t('gwUsage')));
            case 'remove': return name ? this.remove(name) : say(escapeHtml(t('gwUsage')));
            case 'list': return this.list();
            case 'clear': return this.clear();
            default: return say(escapeHtml(t('gwUsage')));
        }
    }

    _find(name) {
        const n = String(name).toLowerCase();
        return this.players.find(p => p.name.toLowerCase() === n || String(p.playerId) === n) || null;
    }

    async add(name) {
        if (this._find(name)) return say(escapeHtml(t('gwAlready', { name })));
        if (this.players.length >= MAX_PLAYERS) return say(escapeHtml(t('gwFull', { max: MAX_PLAYERS })));
        const info = await fetchByName(name);
        if (!info || !info.i) return say(escapeHtml(t('gwNotFound', { name })));
        if (this.players.some(p => p.playerId === info.i)) return say(escapeHtml(t('gwAlready', { name: info.n || name })));
        if (this.players.length >= MAX_PLAYERS) return say(escapeHtml(t('gwFull', { max: MAX_PLAYERS })));
        const rec = newRecord(info.i, Date.now());
        applyInfo(rec, info, Date.now());
        this.players.push(rec);
        this._save();
        say(escapeHtml(t('gwAdded', {
            name: rec.name, alliance: rec.alliance || '-', bases: rec.baseCount, points: compact(rec.points),
            n: this.players.length, max: MAX_PLAYERS,
        })));
        this._renderIfOpen();
    }

    remove(name) {
        const rec = this._find(name);
        if (!rec) return say(escapeHtml(t('gwNotWatched', { name })));
        this.players = this.players.filter(p => p !== rec);
        this._expanded.delete(rec.playerId);
        this._save();
        say(escapeHtml(t('gwRemoved', { name: rec.name })));
        this._renderIfOpen();
    }

    list() {
        if (!this.players.length) return say(escapeHtml(t('gwListEmpty')));
        const now = Date.now();
        say(escapeHtml(t('gwListHeader', { n: this.players.length, max: MAX_PLAYERS })));
        for (const p of this.players) {
            const last = p.history[p.history.length - 1];
            chatMessage(`[GW] ${STATUS_ICON[statusOf(p, now)]} ${escapeHtml(p.name)} [${escapeHtml(p.alliance || '-')}]`
                + ` · ${escapeHtml(compact(p.points))} · ${escapeHtml(t('gwBasesN', { n: p.baseCount }))}`
                + ` · ${escapeHtml(relativeTime(p.lastActive, now))}`
                + (last ? ` · ${escapeHtml(eventText(last))}` : ''));
        }
    }

    clear() {
        const n = this.players.length;
        this.players = [];
        this._expanded.clear();
        this._save();
        say(escapeHtml(t('gwCleared', { n })));
        this._renderIfOpen();
    }

    // ── polling ──

    /** Ask every watched player once, one after the other; alert on each new event. */
    async poll() {
        if (this._polling || !this.running) return;
        this._polling = true;
        try {
            for (const rec of [...this.players]) {
                if (!this.running) break;
                const info = await fetchById(rec.playerId);
                if (!this.players.includes(rec)) continue;   // removed meanwhile
                if (info && info.i === rec.playerId) {
                    for (const e of applyInfo(rec, info, Date.now())) say(`${escapeHtml(rec.name)}: ${escapeHtml(eventText(e))}`);
                }
                if (this.gapMs) await sleep(this.gapMs);
            }
            this._save();
        } finally {
            this._polling = false;
        }
        this._renderIfOpen();
    }

    // ── panel ──

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        this._ensurePanel();
        this._panel.style.display = 'block';
        document.addEventListener('keydown', this._onKeyDown);
        this._render();
    }

    close() {
        if (!this._panel) return;
        document.removeEventListener('keydown', this._onKeyDown);
        this._panel.style.display = 'none';
    }

    _renderIfOpen() {
        if (this.isOpen()) this._render();
    }

    _render() {
        this._title.innerHTML = `<b style="color:#fff;">👁 GhoztWatch</b> <span style="color:#aaa;">(${this.players.length}/${MAX_PLAYERS})</span>`
            + (this._polling ? ` <span style="color:#777;font-size:11px;">· ${escapeHtml(t('gwPolling'))}</span>` : '');
        this._content.innerHTML = renderTable(this.players, Date.now(), this._expanded);
        this._content.querySelectorAll('tr[data-pid]').forEach((tr) => {
            tr.addEventListener('click', () => {
                const pid = Number(tr.dataset.pid);
                if (this._expanded.has(pid)) this._expanded.delete(pid);
                else this._expanded.add(pid);
                this._render();
            });
        });
        this._content.querySelectorAll('[data-remove]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const rec = this.players.find(p => p.playerId === Number(el.dataset.remove));
                if (rec) this.remove(rec.name);
            });
        });
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;
        const pos = clampPosition(loadPosition(this.config, 'GhoztWatch', DEFAULT_POSITION),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            display: none; position: fixed; left: ${pos.x}px; top: ${pos.y}px; z-index: 10000;
            width: ${PANEL_WIDTH}px; max-width: calc(100vw - 16px); box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92); color: #ddd; border: 1px solid #444; border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; pointer-events: auto;`;
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:8px 10px 6px;cursor:move;user-select:none;border-bottom:1px solid #333;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1;min-width:0;';
        const button = (text, tip, fn) => {
            const b = document.createElement('div');
            b.textContent = text;
            b.title = tip;
            b.style.cssText = 'cursor:pointer;color:#999;font-size:14px;line-height:1;';
            b.addEventListener('mousedown', (e) => e.stopPropagation());   // not a drag
            b.addEventListener('click', fn);
            b.addEventListener('mouseenter', () => { b.style.color = '#fff'; });
            b.addEventListener('mouseleave', () => { b.style.color = '#999'; });
            return b;
        };
        header.append(title,
            button('↻', t('gwRefresh'), () => { this.poll(); this._render(); }),
            button('✕', t('close'), () => this.close()));
        const content = document.createElement('div');
        content.style.cssText = 'max-height:60vh;overflow-y:auto;padding:4px 10px 8px;';
        panel.append(header, content);
        document.body.appendChild(panel);
        makeDraggable(panel, header, { config: this.config, prefix: 'GhoztWatch' });
        this._panel = panel;
        this._title = title;
        this._content = content;
    }
}

/** Panel table: one row per player, an expanded row with the full history (newest first). */
export function renderTable(players, now, expanded = new Set()) {
    if (!players.length) {
        return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('gwEmpty'))}</div>`;
    }
    const th = 'padding:3px 4px;text-align:left;font-weight:normal;color:#999;border-bottom:1px solid #444;white-space:nowrap;';
    const td = 'padding:3px 4px;vertical-align:top;';
    const cols = ['gwColPlayer', 'gwColPoints', 'gwColBases', 'gwColStatus', 'gwColEvents', 'gwColDefense'];
    let html = '<table style="width:100%;border-collapse:collapse;"><tr>'
        + cols.map(k => `<th style="${th}">${escapeHtml(t(k))}</th>`).join('') + `<th style="${th}"></th></tr>`;
    for (const p of players) {
        const status = statusOf(p, now);
        const recent = p.history.slice(-3).reverse()
            .map(e => `<div style="color:#bbb;">${escapeHtml(eventText(e))} <span style="color:#666;">${escapeHtml(relativeTime(e.ts, now))}</span></div>`).join('');
        html += `<tr data-pid="${p.playerId}" title="${escapeHtml(t('gwExpandHint'))}" style="cursor:pointer;border-bottom:1px solid #2a2a2a;">`
            + `<td style="${td}"><div style="color:#e0e0e0;">${escapeHtml(p.name)}</div>`
            + `<div style="color:#888;font-size:11px;">${escapeHtml(p.alliance || '-')}${FACTION[p.faction] ? ` · ${FACTION[p.faction]}` : ''}${p.rank ? ` · #${p.rank}` : ''}</div></td>`
            + `<td style="${td}white-space:nowrap;">${escapeHtml(compact(p.points))}</td>`
            + `<td style="${td}">${p.baseCount}</td>`
            + `<td style="${td}white-space:nowrap;">${STATUS_ICON[status]} <span style="color:#888;">${escapeHtml(relativeTime(p.lastActive, now))}</span></td>`
            + `<td style="${td}font-size:11px;">${recent || '<span style="color:#666;">-</span>'}</td>`
            + `<td style="${td}color:#666;">${p.defense ? '' : '-'}</td>`
            + `<td style="${td}"><span data-remove="${p.playerId}" title="${escapeHtml(t('gwRemoveHint'))}" style="color:#777;cursor:pointer;">✕</span></td></tr>`;
        if (expanded.has(p.playerId)) {
            const rows = p.history.slice().reverse().map(e => {
                const when = new Date(e.ts).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
                return `<div><span style="color:#777;">${escapeHtml(when)}</span> ${escapeHtml(eventText(e))}</div>`;
            }).join('');
            html += `<tr><td colspan="7" style="${td}padding-left:14px;background:#1b1b1b;font-size:11px;max-height:200px;">`
                + (rows || `<span style="color:#777;">${escapeHtml(t('gwHistoryEmpty'))}</span>`) + '</td></tr>';
        }
    }
    return html + '</table>';
}
