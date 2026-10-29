// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * tunnel-poi-analyzer.js — Tunnel & POI Analyzer: per tunnel exit who helps
 * activate it and which low bases are a spawn risk; per own POI whether it is worth anything and
 * which bases near it could move. A panel in the Shockr toolbar (Target Watch /
 * Marker Nav style), `/st tunnels`. Click on a row centres the map.
 *
 * Rules (werkorder 5.31.0; the counts are config, defaults in brackets):
 *   - A tunnel exit is active when ≥ `tpa.players` (5) different alliance
 *     players each have a base within `tpa.range` (5) fields of the exit
 *     (Euclidean, as Tunnel Info's circle).
 *   - Spawn risk: an alliance base in that zone whose BASE level is
 *     more than `tpa.spawnmargin` (5) below the tunnel's required offense
 *     level (Tunnel Info's level − POIActivationLevelDifference): required 30
 *     -> below 25. Low bases spawn low camps that fill the zone. (Without the
 *     margin almost every base was a spawn risk, seen live 2026-10-29.) Base level, not offense: another player's offense level is not
 *     readable client-side. A spawn-risk base still counts as a player (the rule above).
 *   - POI: the own alliance's REAL loss of that POI (PoiAnalyser's
 *     calculation, lib/poi-util.js). 0 = worthless: the bases within
 *     `tpa.guardrange` (5) fields can move; a worthless POI without such a base
 *     is left out (nothing to move). > 0 = keep. A guard that is also a
 *     tunnel spawn risk is flagged.
 *
 * Data (ClientLib, read only while the panel is open, every 3 s; checked live
 * 2026-10-29 with docs/probes/tunnel-poi-probe.js):
 *   world.GetObjectFromPosition(x, y)  .Type City = a player base
 *   region.GetObjectFromPosition(x * gw, y * gh)
 *     tunnel: RegionPointOfInterest with get_Type() === 0 (Tunnel Info), get_RawX/Y, get_Level
 *     POI:    poiFromVisObject (type, level, owner)
 *     base:   RegionCityType, get_AllianceId / get_PlayerId / get_PlayerName / get_BaseLevel.
 *             NOT the world object's patched $AllianceId / $PlayerId: live they hold
 *             other values ($AllianceId was the player id, $PlayerId a small index).
 *             No get_BaseLevelFloat on a player base.
 *   alliance.get_OwnedPOIs()  own POIs, also off-screen; `t` is already the EPOIType
 *             (t 4 = PowerBonus at a POI whose vis world type 3 converts to PowerBonus)
 *
 * Only the visible map area is scanned (no tunnel list exists client-side).
 * What was scanned is remembered for the session, so panning builds up the
 * picture; rows outside the current view are dimmed with their last-seen time.
 */
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';
import { isWorldMapVisible, visibleCellRange, cityObjectType } from '../lib/map-overlay.js';
import {
    ownAlliance, ownedPois, poiFromVisObject, poiKey, poiScore, fmtBonus,
    realPoiDelta, rankedPoiDelta, poiDeltaContext, fetchPoiRanking,
} from '../lib/poi-util.js';
import { requiredOffense } from './tunnel-info.js';
import { centerMap } from './target-board.js';

const PANEL_ID = 'st-tpa-panel';
const TOOLBAR_ID = 'tunnelpoi';
const REFRESH_INTERVAL_MS = 3000;
const PANEL_WIDTH = 620;
const DEFAULT_POSITION = { x: 150, y: 110 };
export const DEFAULTS = { players: 5, range: 5, guardRange: 5, spawnMargin: 5 };
const STATUS_COLORS = { active: '#66bb6a', inactive: '#ef5350', worthless: '#ffa726', valuable: '#66bb6a', unknown: '#999' };

/** Integer config value in [min, max], else `def`. */
export function cfgInt(value, def, min, max) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

export function inRange(a, b, range) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= range * range;
}

const baseKey = (b) => `${b.x}:${b.y}`;
const byName = (a, b) => String(a).localeCompare(String(b));

/**
 * One tunnel exit against the alliance bases [{x, y, playerId, name, level}].
 * @returns {{count, players: string[], needed, active, spawnRisks: object[]}}
 */
export function analyzeTunnel(tunnel, bases, { players = DEFAULTS.players, range = DEFAULTS.range, required, margin = DEFAULTS.spawnMargin }) {
    const threshold = required - margin;
    const names = new Map();
    const spawnRisks = [];
    for (const b of bases) {
        if (!inRange(b, tunnel, range)) continue;
        if (!names.has(b.playerId)) names.set(b.playerId, b.name);
        if (Number.isFinite(b.level) && Number.isFinite(threshold) && b.level < threshold) spawnRisks.push(b);
    }
    const list = [...names.values()].sort(byName);
    return {
        count: list.length,
        players: list,
        needed: Math.max(0, players - list.length),
        threshold,
        active: list.length >= players,
        spawnRisks: spawnRisks.sort((a, b) => a.level - b.level),
    };
}

/** 'worthless' (real loss 0), 'valuable' (> 0) or 'unknown' (not computed). */
export function poiStatus(loss) {
    if (typeof loss !== 'number' || !Number.isFinite(loss)) return 'unknown';
    return Math.round(loss * 10) / 10 <= 0 ? 'worthless' : 'valuable';
}

/** Alliance bases within `range` of the POI, each with `spawnRisk` (a tunnel spawn risk). */
export function poiGuards(poi, bases, range, spawnRiskKeys) {
    return bases
        .filter(b => inRange(b, poi, range))
        .map(b => ({ ...b, spawnRisk: spawnRiskKeys.has(baseKey(b)) }))
        .sort((a, b) => byName(a.name, b.name));
}

/** POI type from get_OwnedPOIs' raw `t` (already an EPOIType), null if not a bonus type. */
export function poiTypeFromOwned(t) {
    return t != null && poiKey(t) ? t : null;
}

/**
 * Panel rows: tunnels (inactive first, fewest missing first), then POIs
 * (worthless first). A worthless POI without an alliance base within
 * `guardRange` is left out: nothing to move. `inView(x, y)` false -> row is stale.
 */
export function buildRows({ tunnels, pois, bases, opts, diff, inView }) {
    const rows = [];
    const spawnRiskKeys = new Set();
    for (const tn of tunnels) {
        const required = requiredOffense(tn.level, diff);
        const a = analyzeTunnel(tn, bases, { players: opts.players, range: opts.range, required, margin: opts.spawnMargin });
        for (const b of a.spawnRisks) spawnRiskKeys.add(baseKey(b));
        rows.push({ kind: 'tunnel', x: tn.x, y: tn.y, level: tn.level, required, ...a,
            status: a.active ? 'active' : 'inactive', stale: !inView(tn.x, tn.y), seen: tn.seen });
    }
    for (const p of pois) {
        const status = poiStatus(p.loss);
        const guards = poiGuards(p, bases, opts.guardRange, spawnRiskKeys);
        if (status === 'worthless' && !guards.length) continue;
        rows.push({ kind: 'poi', x: p.x, y: p.y, level: p.level, key: p.key, loss: p.loss, status,
            guards, stale: !inView(p.x, p.y), seen: p.seen });
    }
    const tunnelOrder = (r) => (r.active ? 1 : 0);
    const poiOrder = { worthless: 0, unknown: 1, valuable: 2 };
    return rows.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'tunnel' ? -1 : 1;
        if (a.kind === 'tunnel') return tunnelOrder(a) - tunnelOrder(b) || a.needed - b.needed || b.level - a.level;
        return poiOrder[a.status] - poiOrder[b.status] || b.level - a.level;
    });
}

function fmtLevel(n) {
    return Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
}

function baseText(b) {
    return `${b.name} (L${fmtLevel(b.level)} ${b.x}:${b.y})`;
}

/** Name, players and advice cells for one row (plain text, escaped by the caller). */
export function rowTexts(r, opts) {
    if (r.kind === 'tunnel') {
        const advice = [];
        if (r.needed > 0) advice.push(t('tpaAdviceNeed', { n: r.needed, range: opts.range }));
        if (r.spawnRisks.length) advice.push(t('tpaAdviceSpawnRisk', { threshold: fmtLevel(r.threshold), list: r.spawnRisks.map(baseText).join(', ') }));
        if (!advice.length) advice.push(t('tpaAdviceActive'));
        return {
            name: t('tpaTunnelName', { level: fmtLevel(r.level) }),
            status: t(r.active ? 'tpaStatusActive' : 'tpaStatusInactive'),
            count: t('tpaPlayersCount', { n: r.count, need: opts.players }),
            players: r.players,
            advice,
        };
    }
    let advice;
    if (r.status === 'worthless') {
        advice = t('tpaAdviceMovable', { list: r.guards.map(g => g.name + (g.spawnRisk ? ` ${t('tpaAlsoSpawnRisk')}` : '')).join(', ') });
    } else if (r.status === 'valuable') {
        advice = t('tpaAdviceKeep');
    } else {
        advice = t('tpaAdviceUnknown');
    }
    const risky = r.guards.filter(g => g.spawnRisk);
    return {
        name: `${t(`poiShort_${r.key}`)} ${Math.floor(r.level)}`,
        status: r.status === 'unknown' ? t('tpaStatusUnknown') : `${t(r.status === 'worthless' ? 'tpaStatusWorthless' : 'tpaStatusValuable')} · ${fmtBonus(r.key, r.loss)}`,
        count: '',
        players: [...new Set(r.guards.map(g => g.name + (g.spawnRisk ? ' ⚠' : '')))],
        advice: risky.length && r.status !== 'worthless'
            ? [advice, t('tpaGuardSpawnRisk', { list: risky.map(baseText).join(', ') })]
            : [advice],
    };
}

function seenText(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function renderTable(rows, opts) {
    if (!rows.length) {
        return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('tpaEmpty'))}</div>`;
    }
    const th = 'padding:3px 4px;text-align:left;font-weight:normal;color:#999;border-bottom:1px solid #444;';
    const td = 'padding:3px 4px;vertical-align:top;';
    const cols = ['tpaColName', 'tpaColCoords', 'tpaColStatus', 'tpaColPlayers', 'tpaColAdvice'];
    let html = '<table style="width:100%;border-collapse:collapse;"><tr>'
        + cols.map(c => `<th style="${th}">${escapeHtml(t(c))}</th>`).join('') + '</tr>';
    let section = null;
    for (const r of rows) {
        if (r.kind !== section) {
            section = r.kind;
            html += `<tr><td colspan="5" style="${td}padding-top:8px;color:#fff;font-weight:bold;">`
                + `${escapeHtml(t(section === 'tunnel' ? 'tpaSectionTunnels' : 'tpaSectionPois'))}</td></tr>`;
        }
        const x = rowTexts(r, opts);
        const color = STATUS_COLORS[r.status];
        const hint = !r.stale ? t('tpaCenterHint') : r.seen ? t('tpaNotInView', { time: seenText(r.seen) }) : t('tpaNeverInView');
        html += `<tr data-x="${r.x}" data-y="${r.y}" title="${escapeHtml(hint)}" style="box-shadow:inset 3px 0 0 ${color};cursor:pointer;border-bottom:1px solid #2a2a2a;${r.stale ? 'opacity:0.55;' : ''}">`
            + `<td style="${td}padding-left:8px;white-space:nowrap;color:#e0e0e0;">${escapeHtml(x.name)}</td>`
            + `<td style="${td}white-space:nowrap;color:#4fc3f7;">${r.x}:${r.y}</td>`
            + `<td style="${td}white-space:nowrap;color:${color};">${escapeHtml(x.status)}`
            + (x.count ? `<div style="color:#aaa;">${escapeHtml(x.count)}</div>` : '') + '</td>'
            + `<td style="${td}color:#ccc;">${x.players.length ? x.players.map(escapeHtml).join(', ') : '<span style="color:#666;">–</span>'}</td>`
            + `<td style="${td}color:#aaa;">${x.advice.map(escapeHtml).join('<br>')}</td></tr>`;
    }
    return html + '</table>';
}

export class TunnelPoiAnalyzer {
    /** Short description for `/st help`. */
    get description() { return t('descTunnelPoi'); }

    constructor(config, toolbar, cli) {
        this.name = 'TunnelPoiAnalyzer';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._title = null;
        this._content = null;
        this._timer = null;
        this._shown = null;        // what the panel shows (no re-render, no hover flicker)
        this._rows = [];
        this._bases = new Map();   // "x:y" -> {x, y, playerId, name, level}
        this._tunnels = new Map(); // "x:y" -> {x, y, level, seen}
        this._pois = new Map();    // "x:y" -> {x, y, level, poiType, key, seen} (own alliance, seen on the map)
        this._view = null;         // cell range of the last scan
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.tunnel,
            label: () => t('toolbarTunnelPoi'),
            onClick: () => this.toggle(),
        });
        this.cli.register('tunnels', () => this.toggle());
    }

    stop() {
        this.running = false;
        this.close();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('tunnels');
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.isOpen()) return t('tpaStatusClosed');
        return t('tpaStatusOpen', { t: this._tunnels.size, p: this._rows.filter(r => r.kind === 'poi').length });
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

    _opts() {
        const get = (k) => {
            try { return this.config.get(k); } catch { return undefined; }
        };
        return {
            players: cfgInt(get('tpa.players'), DEFAULTS.players, 1, 50),
            range: cfgInt(get('tpa.range'), DEFAULTS.range, 1, 30),
            guardRange: cfgInt(get('tpa.guardrange'), DEFAULTS.guardRange, 1, 30),
            spawnMargin: cfgInt(get('tpa.spawnmargin'), DEFAULTS.spawnMargin, 0, 50),
        };
    }

    /**
     * Scan the visible map (+ a margin so bases around an edge tunnel count) into
     * the remembered maps. Entries inside the view that are gone now are dropped.
     */
    _scan(own, opts) {
        const md = ClientLib.Data.MainData.GetInstance();
        const world = md.get_World();
        const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
        const gw = region.get_GridWidth();
        const gh = region.get_GridHeight();
        const visTypes = ClientLib.Vis.VisObject.EObjectType;
        const cityType = cityObjectType();
        let members = {};
        try { members = md.get_Alliance().get_MemberData().d || {}; } catch { /* names from the map */ }

        const view = visibleCellRange();
        const scan = visibleCellRange(Math.max(opts.range, opts.guardRange) + 1);
        const inside = (o) => o.x >= view.minX && o.x <= view.maxX && o.y >= view.minY && o.y <= view.maxY;
        for (const m of [this._bases, this._tunnels, this._pois]) {
            for (const [k, o] of m) if (inside(o)) m.delete(k);
        }
        const now = Date.now();
        for (let y = scan.minY; y <= scan.maxY; y++) {
            for (let x = scan.minX; x <= scan.maxX; x++) {
                try {
                    const w = world.GetObjectFromPosition(x, y);
                    const vis = region.GetObjectFromPosition(x * gw, y * gh);
                    if (w && w.Type === cityType) {
                        const base = this._readBase(vis, x, y, own.id, members, visTypes);
                        if (base) this._bases.set(baseKey(base), base);
                        continue;
                    }
                    if (!vis || vis.get_VisObjectType() !== visTypes.RegionPointOfInterest) continue;
                    if (vis.get_Type() === 0) {
                        const tx = vis.get_RawX();
                        const ty = vis.get_RawY();
                        this._tunnels.set(`${tx}:${ty}`, { x: tx, y: ty, level: Number(vis.get_Level()), seen: now });
                        continue;
                    }
                    const poi = poiFromVisObject(vis);
                    if (poi && poi.ownerId === own.id) {
                        this._pois.set(`${x}:${y}`, { x, y, level: poi.level, poiType: poi.poiType, key: poi.key, seen: now });
                    }
                } catch { /* skip this cell */ }
            }
        }
        this._view = view;
    }

    /** Alliance base at (x, y) from its map object, or null (another alliance, not loaded). */
    _readBase(vis, x, y, ownId, members, visTypes) {
        if (!vis || vis.get_VisObjectType() !== visTypes.RegionCityType) return null;
        if (Number(vis.get_AllianceId()) !== ownId) return null;
        const playerId = Number(vis.get_PlayerId());
        let level = NaN;
        try { level = Number(vis.get_BaseLevel()); } catch { /* unknown: never a spawn risk */ }
        let name = '';
        try { name = String(vis.get_PlayerName() || ''); } catch { /* member data */ }
        const member = members[playerId];
        if (!name && member && member.Name) name = String(member.Name);
        return { x, y, playerId, name: name || `#${playerId}`, level: level > 0 ? level : NaN };
    }

    /** Own POIs (world-wide list + the ones seen on the map), each with its real loss or undefined. */
    _ownPois(own) {
        const out = new Map();
        for (const p of ownedPois()) {
            const poiType = poiTypeFromOwned(p.worldType);
            out.set(`${p.x}:${p.y}`, { x: p.x, y: p.y, level: p.level, poiType, key: poiType == null ? null : poiKey(poiType), seen: null });
        }
        for (const [k, p] of this._pois) out.set(k, { ...out.get(k), ...p });
        const list = [];
        for (const p of out.values()) {
            if (!p.key) continue;
            list.push({ ...p, loss: this._loss(p, own.id) });
        }
        return list;
    }

    /** Real loss of an own POI; a ranking that is still on its way re-renders when it arrives. */
    _loss(p, ownId) {
        const ctx = poiDeltaContext(p.poiType, ownId, ownId, poiScore(p.level));
        if (!ctx) return undefined;
        const direct = realPoiDelta(ctx, ctx.total);
        if (direct.value !== null) return direct.value;
        let value;
        let sync = true;
        fetchPoiRanking(p.poiType, ownId, (rows) => {
            if (sync) {
                value = rankedPoiDelta({ ...ctx, poiOwnerId: ownId }, rows, ctx.total).value;
            } else if (this.isOpen()) {
                this._shown = null;
                this._refresh();
            }
        });
        sync = false;
        return value;
    }

    _readDiff() {
        try {
            return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_POIActivationLevelDifference()) || 0;
        } catch {
            return 0;
        }
    }

    _refresh() {
        if (!this.isOpen()) return;
        const own = ownAlliance();
        const onMap = isWorldMapVisible();
        let html;
        if (!own) {
            this._rows = [];
            html = `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('tpaNoAlliance'))}</div>`;
        } else {
            const opts = this._opts();
            if (onMap) {
                try { this._scan(own, opts); } catch (e) { console.warn('[ST] TunnelPoiAnalyzer: scan failed', e && e.message); }
            }
            const view = onMap ? this._view : null;
            const inView = (x, y) => !!view && x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
            this._rows = buildRows({
                tunnels: [...this._tunnels.values()],
                pois: this._ownPois(own),
                bases: [...this._bases.values()],
                opts, diff: this._readDiff(), inView,
            });
            html = (onMap ? '' : `<div style="color:#ffb74d;padding:4px 0;">${escapeHtml(t('tpaMapHint'))}</div>`)
                + renderTable(this._rows, opts);
        }
        if (html === this._shown) return;
        this._shown = html;
        const tunnels = this._rows.filter(r => r.kind === 'tunnel');
        const count = own ? ` <span style="color:#aaa;">(${t('tpaTitleCount', {
            active: tunnels.filter(r => r.active).length, tunnels: tunnels.length,
            worthless: this._rows.filter(r => r.status === 'worthless').length,
        })})</span>` : '';
        this._title.innerHTML = `<b style="color:#fff;">${escapeHtml(t('tpaTitle'))}</b>${count}`;
        this._content.innerHTML = html;
        this._content.querySelectorAll('tr[data-x]').forEach((tr) => {
            tr.addEventListener('click', () => centerMap(Number(tr.dataset.x), Number(tr.dataset.y)));
        });
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;

        const pos = clampPosition(loadPosition(this.config, 'TunnelPoiAnalyzer', DEFAULT_POSITION),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        // Same look as the TargetBoard / MarkerNav panels
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
        makeDraggable(panel, header, { config: this.config, prefix: 'TunnelPoiAnalyzer' });
        this._panel = panel;
        this._title = title;
        this._content = content;
    }
}

