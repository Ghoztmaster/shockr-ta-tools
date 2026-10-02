/**
 * target-watcher.js — tell the alliance which enemy/Forgotten base you are looking at.
 *
 * Off by default — `/st plugin enable target-watcher`. Needs api.url + api.key
 * (same config as the scanner).
 *
 * The game has no watchlist API, so a 2.5 s timer reads which city is in view.
 * When that is a base that is not yours (and not an alliance mate's), it is a
 * target:
 *   - target changed since the previous tick → POST /api/target-watch
 *     (at most one POST per 5 s; while rate-limited the newest target simply
 *     waits for the next tick, so fast click-through only posts where you stop)
 *   - after the POST, GET /api/target-watch/{worldId}/{targetId}; if other
 *     players watch it too → one chat line per target view
 * Back to your own base or the world map → nothing is sent (the backend
 * expires watches by TTL).
 *
 * Ticks are skipped while a scanner holds the scan lock: the scanners switch
 * the current city in the background, which is not the player looking.
 *
 * No document-wide listeners, no DOM — one poll timer.
 *
 * Data paths (same as UpgradeCalc / scanner):
 *   vis.get_Mode()                         — base view (City / CombatSetup / Battleground)
 *   cities.get_CurrentCity()               — the city in view
 *   city.IsOwnBase(), city.get_OwnerAllianceId()
 *   city.get_PosX/Y, get_Name, get_LvlBase, get_CityFaction
 *   world.GetObjectFromPosition(x, y)      — .Type 2 = NPC base, 3 = NPC camp ($CampType 2 = camp)
 *
 * Expected GET response (backend order): an array, or { watchers: [...] }, of
 *   { playerId, playerName, timestamp }   — timestamp in unix seconds (ms also accepted)
 */
import { chatMessage } from '../lib/main.js';
import { scanLockHolder } from '../lib/scanner-util.js';

const POLL_INTERVAL_MS = 2500;
const POST_MIN_INTERVAL_MS = 5000;

/** Player factions (GDI / Nod); everything else is a Forgotten variant. */
const PLAYER_FACTIONS = [1, 2];

/** Vis modes in which a single base is shown (world map = Region → ignored). */
const BASE_VIEW_MODES = ['City', 'CombatSetup', 'Battleground'];

export class TargetWatcher {
    constructor(config, apiClient) {
        this.name = 'TargetWatcher';
        this.defaultEnabled = false;
        this.config = config;
        this.api = apiClient;
        this.running = false;
        this._timer = null;
        this._currentId = null;   // target in view at the previous tick (null = no target)
        this._current = null;     // its details
        this._posted = false;     // POST done for the current target view
        this._lastPostAt = 0;
        this._postCount = 0;
    }

    async start() {
        this.running = true;
        if (!this.api.isConfigured) {
            chatMessage('[ST] TargetWatcher enabled but no server configured. Set api.url and api.key first.');
        }
        this._tick();
        this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
        console.log('[ST] TargetWatcher: started');
    }

    stop() {
        this.running = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._currentId = null;
        this._current = null;
        this._posted = false;
        console.log('[ST] TargetWatcher: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return '/st plugin enable target-watcher';
        if (!this.api.isConfigured) return 'geen server geconfigureerd (api.url / api.key)';
        const watching = this._current
            ? `kijkt naar ${this._current.targetName} (${this._current.targetX}:${this._current.targetY})`
            : 'geen target in beeld';
        return `${watching}, ${this._postCount} melding(en) verstuurd`;
    }

    _tick() {
        if (!this.running || !this.api.isConfigured) return;
        if (scanLockHolder()) return;

        const target = getViewedTarget();
        const id = target ? target.targetId : null;

        if (id !== this._currentId) {
            this._currentId = id;
            this._current = target;
            this._posted = false;
        }

        if (!target || this._posted) return;
        if (Date.now() - this._lastPostAt < POST_MIN_INTERVAL_MS) return;

        this._posted = true;
        this._lastPostAt = Date.now();
        this._report(target);
    }

    /** POST the watch, then show who else is watching this target. */
    async _report(target) {
        const ok = await this.api.request('POST', '/api/target-watch', target);
        if (ok) this._postCount++;

        const data = await this.api.request('GET', `/api/target-watch/${target.worldId}/${target.targetId}`);
        if (!data || this._currentId !== target.targetId) return;

        const others = toWatcherList(data).filter(w => w && Number(w.playerId) !== target.playerId);
        if (!others.length) return;

        const name = (w) => escapeHtml(w.playerName || '?');
        const targetName = escapeHtml(target.targetName);
        if (others.length === 1) {
            chatMessage(`[ST] ⚠️ ${name(others[0])} kijkt ook naar ${targetName}${since(others[0].timestamp)}`);
        } else {
            const names = others.map(w => `${name(w)}${since(w.timestamp)}`).join(', ');
            chatMessage(`[ST] ⚠️ ${names} kijken ook naar ${targetName}`);
        }
    }
}

/**
 * Watch payload for the base currently in view, or null when the player is on
 * the world map, on an own/alliance base, or the city is not loaded yet.
 */
function getViewedTarget() {
    try {
        const vis = ClientLib.Vis.VisMain.GetInstance();
        const modes = BASE_VIEW_MODES.map(m => ClientLib.Vis.Mode[m]).filter(m => m !== undefined);
        if (!modes.includes(vis.get_Mode())) return null;

        const md = ClientLib.Data.MainData.GetInstance();
        const city = md.get_Cities().get_CurrentCity();
        if (!city || city.get_IsGhostMode()) return null;
        if (city.IsOwnBase()) return null;

        const player = md.get_Player();
        if (city.get_OwnerId() === player.id) return null;

        const faction = city.get_CityFaction();
        const alliance = md.get_Alliance();
        const myAllianceId = alliance ? alliance.get_Id() : 0;
        if (PLAYER_FACTIONS.includes(faction) && myAllianceId && city.get_OwnerAllianceId() === myAllianceId) {
            return null;
        }

        const x = city.get_PosX();
        const y = city.get_PosY();
        const level = Math.floor(city.get_LvlBase());
        const type = getTargetType(x, y, faction);
        const label = { camp: 'Camp', outpost: 'Outpost', base: 'FG Base', player: 'Base' }[type];

        return {
            playerId: player.id,
            playerName: player.name,
            targetId: city.get_Id(),
            targetName: city.get_Name() || `${label} L${level}`,
            targetX: x,
            targetY: y,
            targetLevel: level,
            targetType: type,
            worldId: md.get_Server().get_WorldId(),
            timestamp: Math.floor(Date.now() / 1000),
        };
    } catch {
        return null;
    }
}

/** 'camp' | 'outpost' | 'base' (Forgotten) | 'player' — from the world object at (x, y). */
function getTargetType(x, y, faction) {
    if (PLAYER_FACTIONS.includes(faction)) return 'player';
    try {
        const obj = ClientLib.Data.MainData.GetInstance().get_World().GetObjectFromPosition(x, y);
        if (obj && obj.Type === 3) return obj.$CampType === 2 ? 'camp' : 'outpost';
    } catch { /* fall through */ }
    return 'base';
}

/** GET response → watcher array (accepts a bare array or { watchers: [...] }). */
function toWatcherList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.watchers)) return data.watchers;
    return [];
}

/** " (sinds 3 min)" from a unix timestamp in seconds or ms; '' if unknown. */
function since(ts) {
    const n = Number(ts);
    if (!n) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return min < 1 ? ' (net)' : ` (sinds ${min} min)`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
