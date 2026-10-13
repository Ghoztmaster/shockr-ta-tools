/**
 * map-labels.js — who is looking at / has claimed / has attacked an FG target,
 * as labels under that target on the world map.
 *
 *   👁 Name  (yellow) — viewing: Target Watcher
 *   📌 Name  (orange) — claimed: WatchList
 *   ⚔ Name   (red)    — attacked: won attacks of every alliance member
 *
 * One line per player, stacked; per player only the highest status shows
 * (attacked > claimed > viewing). Only on Forgotten targets (world object
 * Type 2 NPC base, Type 3 NPC camp with $CampType !== 0) — never on player
 * bases. A label exists only while that object is on the map: a defeated
 * camp/outpost/base that disappears takes its labels with it.
 *
 * Data (existing routes only, read-only use of the other plugins):
 *   - 👁  GET /api/target-watch/{worldId} (member auth), every 10 s.
 *         LIMITATION: TargetWatcher posts once per target view (no heartbeat)
 *         and the server keeps a watch for 10 min (server/target_watch.py
 *         TTL), so ANOTHER player's 👁 can stay up to 10 min after they left
 *         the base. A faster "stopped looking" needs a server/heartbeat change,
 *         which the work order excluded. The OWN 👁 is exact: it only shows
 *         while the local TargetWatcher's current target is that target.
 *   - 📌  POST /api/watchlist {action: "list"} (member auth), every 60 s. The
 *         server already ends a claim after 24 h, on unclaim or a won attack.
 *   - ⚔   (5.17.0) every alliance member's won attacks of the last 24 h from
 *         GET /api/attacks/alliance?worldId= (member auth, name + target +
 *         time only, no loot), every 60 s. Plus, as before, the OWN won
 *         attacks from the own combat report headers (the same read-only
 *         GetReportHeaderAll route and filter as AttackTracker: NPCRaid + won
 *         + camp/outpost/base), last 7 days, every 60 s - so the own ⚔ also
 *         shows without a server key or before AttackTracker sent it. Never
 *         MarkReportsAsRead/DeleteReports. The server list carries no
 *         playerId: an entry with the own name is matched to the own id, so
 *         the two sources give one ⚔ line, not two.
 *
 * Polling and rendering only while the world map is shown. Label font: the
 * CampTracker font, at 0.6 × its fontsize (min 11 px) — CampTracker's size is
 * meant for the one-glyph "#n" marker; full size would make names unreadably
 * wide. Placed centred just below the target cell, so it never overlaps the
 * CampTracker marker (top-left of the cell).
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, addToMap,
    attachMapEvents, detachMapEvents,
} from '../lib/map-overlay.js';
import { isLoggable } from './attack-tracker.js';

const WATCH_POLL_MS = 10 * 1000;
const CLAIM_POLL_MS = 60 * 1000;
const ATTACK_POLL_MS = 60 * 1000;
const ALLIANCE_ATTACK_POLL_MS = 60 * 1000;
const RENDER_MS = 2000;
const ATTACK_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const NAME_MAX = 10;

export const STATUS = {
    attacked: { rank: 3, icon: '⚔', color: '#f44336' },
    claimed: { rank: 2, icon: '📌', color: '#ff9800' },
    viewing: { rank: 1, icon: '👁', color: '#ffeb3b' },
};

/** "GhoztMasters" → "GhoztMast…" (names longer than NAME_MAX). */
export function truncateName(name) {
    const s = String(name || '?');
    return s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1) + '…' : s;
}

/**
 * Merge the three sources into labels per coordinate.
 * @param {{watches?: Array, claims?: Array, attacks?: Array}} data
 *   watches: [{x, y, playerId, playerName, targetId}]
 *   claims:  [{x, y, playerId, playerName}]
 *   attacks: [{x, y, playerId, playerName}]
 * @param {{ownId?: number, ownCurrentTargetId?: number|null}} own
 * @returns {Map<string, {x, y, lines: Array<{status, playerId, playerName}>}>}
 */
export function mergeLabels(data, own = {}) {
    const out = new Map();
    const add = (entry, status) => {
        const x = Math.round(Number(entry.x));
        const y = Math.round(Number(entry.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const key = `${x}:${y}`;
        if (!out.has(key)) out.set(key, { x, y, players: new Map() });
        const players = out.get(key).players;
        const pid = String(entry.playerId ?? entry.playerName);
        const known = players.get(pid);
        if (!known || STATUS[status].rank > STATUS[known.status].rank) {
            players.set(pid, { status, playerId: entry.playerId, playerName: entry.playerName || '?' });
        }
    };
    for (const w of data.watches || []) {
        const isOwn = own.ownId != null && Number(w.playerId) === Number(own.ownId);
        if (isOwn && Number(own.ownCurrentTargetId) !== Number(w.targetId)) continue;
        add(w, 'viewing');
    }
    for (const c of data.claims || []) add(c, 'claimed');
    for (const a of data.attacks || []) add(a, 'attacked');

    const result = new Map();
    for (const [key, { x, y, players }] of out) {
        const lines = [...players.values()].sort((a, b) =>
            STATUS[b.status].rank - STATUS[a.status].rank
            || String(a.playerName).localeCompare(String(b.playerName)));
        result.set(key, { x, y, lines });
    }
    return result;
}

/** True when the world object at (x, y) is a live Forgotten target (Type 2, or Type 3 not destroyed). */
export function isFgTarget(world, x, y) {
    try {
        const obj = world.GetObjectFromPosition(x, y);
        if (!obj) return false;
        if (obj.Type === 2) return true;
        if (obj.Type === 3) return obj.$CampType !== 0;
        return false;
    } catch {
        return false;
    }
}

function ownPlayer() {
    try {
        const p = ClientLib.Data.MainData.GetInstance().get_Player();
        const id = Number(typeof p.get_Id === 'function' ? p.get_Id() : p.id) || null;
        const name = String((typeof p.get_Name === 'function' ? p.get_Name() : p.name) || '');
        return { id, name };
    } catch {
        return { id: null, name: '' };
    }
}

function worldId() {
    try {
        return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId()) || null;
    } catch {
        return null;
    }
}

function gameUtil() {
    if (typeof webfrontend !== 'undefined' && webfrontend.phe && webfrontend.phe.cnc && webfrontend.phe.cnc.Util) return webfrontend.phe.cnc.Util;
    if (typeof phe !== 'undefined' && phe.cnc && phe.cnc.Util) return phe.cnc.Util;
    return null;
}

/** A report-header request without an answer is retried after this long. */
const ANSWER_TIMEOUT_MS = 15 * 1000;

export class MapLabels {
    /** Short description for `/st help`. */
    get description() { return t('descMapLabels'); }

    constructor(config, apiClient, plugins = {}) {
        this.name = 'MapLabels';
        this.config = config;
        this.api = apiClient;
        this.plugins = plugins || {};
        this.running = false;
        this.watches = [];
        this.claims = [];
        this.attacks = [];          // own won attacks (report headers)
        this.allianceAttacks = [];  // every member's won attacks (server, 24 h)
        this._last = { watch: 0, claim: 0, attack: 0, alliance: 0 };
        this._busy = { watch: false, claim: false, attack: false, alliance: false };
        this.labels = new Map();   // "x:y" -> { el, x, y }
        this._events = [];
        this._timer = null;
        this._renderTimer = null;
    }

    async start() {
        this.running = true;
        try {
            this._events = attachMapEvents(this, () => this._reposition(), () => this.render());
        } catch { this._events = []; }
        this._timer = setInterval(() => this.poll(), 1000);
        this._renderTimer = setInterval(() => this.render(), RENDER_MS);
        this.poll();
        console.log('[ST] MapLabels: started');
    }

    stop() {
        this.running = false;
        detachMapEvents(this, this._events);
        this._events = [];
        if (this._timer) clearInterval(this._timer);
        if (this._renderTimer) clearInterval(this._renderTimer);
        this._timer = this._renderTimer = null;
        this._clear();
    }

    /** One-line status for `/st status`. */
    statusText() {
        return `👁 ${this.watches.length} · 📌 ${this.claims.length} · ⚔ ${new Set(this._allAttacks().map(a => `${a.x}:${a.y}:${a.playerId ?? a.playerName}`)).size}`;
    }

    /** Called every second: fires each source when its interval is due. Only on the world map. */
    poll(now = Date.now()) {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) return;
            const configured = !!(this.api && this.api.isConfigured);
            if (configured && now - this._last.watch >= WATCH_POLL_MS) this._fetchWatches(now);
            if (configured && now - this._last.claim >= CLAIM_POLL_MS) this._fetchClaims(now);
            if (configured && now - this._last.alliance >= ALLIANCE_ATTACK_POLL_MS) this._fetchAllianceAttacks(now);
            if (now - this._last.attack >= ATTACK_POLL_MS) this._readAttacks(now);
        } catch (e) {
            console.warn('[ST] MapLabels: poll failed', e && e.message);
        }
    }

    async _fetchWatches(now) {
        if (this._busy.watch) return;
        const wid = worldId();
        if (!wid) return;
        this._busy.watch = true;
        this._last.watch = now;
        try {
            const data = await this.api.request('GET', `/api/target-watch/${wid}`);
            if (data && Array.isArray(data.targets)) {
                const list = [];
                for (const tg of data.targets) {
                    for (const w of tg.watchers || []) {
                        list.push({ x: tg.targetX, y: tg.targetY, targetId: tg.targetId, playerId: w.playerId, playerName: w.playerName });
                    }
                }
                this.watches = list;
                this.render();
            }
        } catch { /* keep the last list */ } finally {
            this._busy.watch = false;
        }
    }

    async _fetchClaims(now) {
        if (this._busy.claim) return;
        const wid = worldId();
        if (!wid) return;
        this._busy.claim = true;
        this._last.claim = now;
        try {
            const data = await this.api.request('POST', '/api/watchlist', { action: 'list', worldId: wid });
            if (data && Array.isArray(data.claims)) {
                this.claims = data.claims.map(c => ({ x: c.targetX, y: c.targetY, playerId: c.playerId, playerName: c.playerName }));
                this.render();
            }
        } catch { /* keep the last list */ } finally {
            this._busy.claim = false;
        }
    }

    /** Every alliance member's won attacks of the last 24 h (GET /api/attacks/alliance). */
    async _fetchAllianceAttacks(now) {
        if (this._busy.alliance) return;
        const wid = worldId();
        if (!wid) return;
        this._busy.alliance = true;
        this._last.alliance = now;
        try {
            const data = await this.api.request('GET', `/api/attacks/alliance?worldId=${wid}`);
            if (data && Array.isArray(data.attacks)) {
                const me = ownPlayer();
                this.allianceAttacks = data.attacks.map(a => ({
                    x: a.targetX, y: a.targetY, playerName: a.playerName,
                    // No playerId from the server: the own name -> the own id, so it merges with the report-based ⚔
                    playerId: me.id != null && a.playerName === me.name ? me.id : undefined,
                }));
                this.render();
            }
        } catch { /* keep the last list */ } finally {
            this._busy.alliance = false;
        }
    }

    /** Own (report headers) + alliance (server) attacks, for mergeLabels. */
    _allAttacks() {
        return [...this.attacks, ...this.allianceAttacks];
    }

    /** Own won FG attacks from the report headers (read-only, same route/filter as AttackTracker). */
    _readAttacks(now) {
        // An unanswered request must not block the read forever: retry after ANSWER_TIMEOUT_MS
        if (this._busy.attack && now - this._last.attack < ANSWER_TIMEOUT_MS) return;
        const util = gameUtil();
        if (!util) return;
        let net;
        try {
            net = ClientLib.Net.CommunicationManager.GetInstance();
        } catch {
            return;
        }
        this._busy.attack = true;
        this._last.attack = now;
        try {
            net.SendSimpleCommand('GetReportHeaderAll',
                { type: 1, skip: 0, take: 50, sort: 1, ascending: false },
                util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
                    this._busy.attack = false;
                    this._onHeaders(Array.isArray(data) ? data : []);
                }), null);
        } catch (e) {
            this._busy.attack = false;
            console.warn('[ST] MapLabels: GetReportHeaderAll failed', e && e.message);
        }
    }

    _onHeaders(headers, now = Date.now()) {
        const me = ownPlayer();
        this.attacks = headers
            .filter(h => isLoggable(h) && now - h.t <= ATTACK_MAX_AGE_MS)
            .map(h => ({ x: Number(h.ad.dbx), y: Number(h.ad.dby), playerId: me.id, playerName: me.name }));
        this.render();
    }

    _clear() {
        for (const { el } of this.labels.values()) el.remove();
        this.labels.clear();
    }

    /** Rebuild the labels from the current data; never throws. */
    render() {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            const me = ownPlayer();
            const tw = this.plugins.targetWatcher;
            const merged = mergeLabels(
                { watches: this.watches, claims: this.claims, attacks: this._allAttacks() },
                { ownId: me.id, ownCurrentTargetId: tw && tw.running ? tw._currentId : null },
            );
            const world = ClientLib.Data.MainData.GetInstance().get_World();
            const keep = new Set();
            for (const [key, entry] of merged) {
                if (!entry.lines.length || !isFgTarget(world, entry.x, entry.y)) continue;
                keep.add(key);
                let label = this.labels.get(key);
                if (!label) {
                    label = { el: this._createElement(), x: entry.x, y: entry.y };
                    this.labels.set(key, label);
                }
                this._fill(label.el, entry.lines);
                this._place(label);
            }
            for (const [key, label] of this.labels) {
                if (!keep.has(key)) {
                    label.el.remove();
                    this.labels.delete(key);
                }
            }
        } catch (e) {
            console.warn('[ST] MapLabels: render failed', e && e.message);
        }
    }

    _fill(el, lines) {
        el.textContent = '';
        for (const line of lines) {
            const st = STATUS[line.status];
            const row = document.createElement('div');
            row.textContent = `${st.icon} ${truncateName(line.playerName)}`;
            row.style.color = st.color;
            el.appendChild(row);
        }
        el.title = lines.map(l => `${STATUS[l.status].icon} ${l.playerName}`).join('\n');
    }

    _reposition() {
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            for (const label of this.labels.values()) this._place(label);
        } catch { /* ignore */ }
    }

    _place(label) {
        const { left, top } = cellToScreen(label.x, label.y, 0.5, 0.95);
        const view = viewSize();
        if (top < 0 || left < 0 || top > view.height || left > view.width) {
            if (label.el.parentElement) label.el.remove();
            return;
        }
        label.el.style.left = left + 'px';
        label.el.style.top = top + 'px';
        addToMap(label.el);
    }

    _createElement() {
        const size = Math.max(11, Math.round(Number(this.config ? this.config.get('camptracker.fontsize', 20) : 20) * 0.6));
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: '10',
            fontFamily: this.config ? this.config.get('camptracker.font', 'Iosevka Term') : 'Iosevka Term',
            fontWeight: 'bold',
            fontSize: size + 'px',
            lineHeight: '1.15',
            padding: '1px 4px',
            borderRadius: '3px',
            background: 'rgba(0,0,0,0.7)',
            whiteSpace: 'nowrap',
        });
        el.setAttribute('data-st-maplabel', '1');
        return el;
    }
}
