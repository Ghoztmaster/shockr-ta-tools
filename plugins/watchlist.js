/**
 * watchlist.js — claim Forgotten targets you intend to attack, visible to the alliance.
 *
 * On by default; needs api.url + `/st register` (same config as the scanner).
 * Off: `/st plugin disable watchlist`. Not the same as TargetWatcher: that one
 * reports automatically what you LOOK at (10 min); a claim is set by hand and
 * stays until you remove it, win an attack on the target, or 24 h pass
 * (server/watchlist.py).
 *
 * Commands:
 *   /st watch          claim the selected target (world map selection, or the
 *                      base in view). Claimed by someone else already → a
 *                      warning, nothing stored.
 *   /st watch force    claim it anyway (your claim is added next to theirs)
 *   /st unwatch        remove your claim on the selected target
 *   /st unwatch all    remove all your claims in this world
 *
 * Warning while viewing: a 2.5 s timer (local only) reads the selected / viewed
 * target; when it changes, the alliance's claims are checked and a target
 * claimed by another player gives ONE chat line per target view. The claims
 * list comes from POST /api/watchlist {action: "list"}, at most once per
 * LIST_REFRESH_MS and only while an FG target is in view. Ticks are skipped
 * while a scanner holds the scan lock (the scanners switch the current city).
 *
 * Defeated: the server removes your claim when AttackTracker posts a won
 * attack on it and returns it as `unclaimed`; main.js wires that to
 * notifyDefeated() for the chat line.
 *
 * Data paths:
 *   vis.get_Mode()                          — base view (City / CombatSetup / Battleground) vs world map
 *   vis.get_SelectedObject()                — world map: get_VisObjectType, get_RawX/Y, get_Id
 *   cities.get_CurrentCity()                — base view: IsOwnBase, get_CityFaction, get_PosX/Y, get_LvlBase
 *   world.GetObjectFromPosition(x, y)       — .Type 2 = NPC base, 3 = NPC camp ($CampType, $Level patched)
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { scanLockHolder } from '../lib/scanner-util.js';

const POLL_INTERVAL_MS = 2500;
const LIST_REFRESH_MS = 60 * 1000;

/** Player factions (GDI / Nod); everything else is a Forgotten variant. */
const PLAYER_FACTIONS = [1, 2];

/** Vis modes in which a single base is shown (world map = Region → the selection counts). */
const BASE_VIEW_MODES = ['City', 'CombatSetup', 'Battleground'];

/** World object $CampType (ENPCCampType) → target type, as AttackTracker maps the report's dbn. 0 = destroyed. */
const CAMP_TYPES = { 1: 'camp', 2: 'camp', 3: 'outpost', 4: 'base' };

export class WatchList {
    /** Short description for `/st help`. */
    get description() { return t('descWatchList'); }

    constructor(config, cli, apiClient) {
        this.name = 'WatchList';
        this.config = config;
        this.cli = cli;
        this.api = apiClient;
        this.running = false;
        this._timer = null;
        this._viewKey = null;      // "x:y" of the target in view at the previous tick
        this._warned = false;      // warning check done for the current target view
        this._claims = null;       // last list from the server (this world, own scope)
        this._claimsAt = 0;
        this._refreshing = null;
    }

    async start() {
        this.running = true;
        this.cli.register('watch', (args) => this.watch(args));
        this.cli.register('unwatch', (args) => this.unwatch(args));
        this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this._viewKey = null;
        this._claims = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.api.isConfigured) return t('watchStatusNoServer');
        const me = myPlayerId();
        const own = (this._claims || []).filter(c => c.playerId === me).length;
        return t('watchStatus', { own, total: (this._claims || []).length });
    }

    // ─── Commands ────────────────────────────────────────────────────

    /** `/st watch [force]` */
    async watch(args = []) {
        if (!this._ready()) return;
        const target = readSelectedTarget();
        if (!this._usable(target)) return;
        const force = String(args[0] || '').toLowerCase() === 'force';

        const result = await this.api.request('POST', '/api/watchlist', {
            action: 'claim',
            targetType: target.targetType,
            targetLevel: target.targetLevel,
            targetX: target.targetX,
            targetY: target.targetY,
            worldId: target.worldId,
            force,
        });
        if (!result) {
            say(t('watchFailed'));
            return;
        }
        const others = Array.isArray(result.others) ? result.others : [];
        if (result.status === 'conflict') {
            say(`⚠ ${t('watchConflict', { players: names(others) })}`);
            this._remember(others, result.serverTime);
            this._markWarned(target);   // the conflict line already said who claims it
            return;
        }
        const vars = { type: target.targetType, level: Math.floor(target.targetLevel), x: target.targetX, y: target.targetY };
        say(t(result.status === 'refreshed' ? 'watchRefreshed' : 'watchClaimed', vars)
            + (others.length ? ` ${t('watchAlsoClaimedBy', { players: names(others) })}` : ''));
        this._remember([result.claim, ...others], result.serverTime);
        this._markWarned(target);   // no "claimed by" warning right after your own claim
    }

    /** `/st unwatch [all]` */
    async unwatch(args = []) {
        if (!this._ready()) return;
        if (String(args[0] || '').toLowerCase() === 'all') {
            const worldId = currentWorldId();
            const result = worldId && await this.api.request('POST', '/api/watchlist', { action: 'unclaim_all', worldId });
            if (!result) { say(t('watchFailed')); return; }
            const removed = result.removed || [];
            this._forget(removed);
            say(t('watchUnclaimedAll', { count: removed.length }));
            return;
        }
        const target = readSelectedTarget();
        if (!this._usable(target)) return;
        const result = await this.api.request('POST', '/api/watchlist', {
            action: 'unclaim', targetX: target.targetX, targetY: target.targetY, worldId: target.worldId,
        });
        if (!result) { say(t('watchFailed')); return; }
        const removed = result.removed || [];
        this._forget(removed);
        say(removed.length
            ? t('watchUnclaimed', { type: target.targetType, x: target.targetX, y: target.targetY })
            : t('watchNothingToRemove', { x: target.targetX, y: target.targetY }));
    }

    /** AttackTracker hook: the server removed this claim because the attack on it was won. */
    notifyDefeated(claim) {
        if (!claim) return;
        this._forget([claim]);
        say(t('watchDefeated', { type: claim.targetType, x: claim.targetX, y: claim.targetY }));
    }

    // ─── Warning while viewing ───────────────────────────────────────

    _tick() {
        if (!this.running || !this.api.isConfigured || scanLockHolder()) return;
        const target = readSelectedTarget();
        const key = target && target.targetType ? `${target.worldId}:${target.targetX}:${target.targetY}` : null;
        if (key !== this._viewKey) {
            this._viewKey = key;
            this._warned = false;
        }
        if (!key || this._warned) return;

        if (this._claims && Date.now() - this._claimsAt < LIST_REFRESH_MS) {
            this._warned = true;
            this._warnIfClaimed(target);
            return;
        }
        if (this._refreshing) return;
        this._refreshing = this._refresh(target.worldId).finally(() => { this._refreshing = null; });
    }

    async _refresh(worldId) {
        const result = await this.api.request('POST', '/api/watchlist', { action: 'list', worldId });
        // Failed: keep the old list, but mark it fresh so a down server is not asked every tick
        this._claimsAt = Date.now();
        if (result && Array.isArray(result.claims)) {
            this._claims = result.claims;
            this._serverOffset = Number(result.serverTime) ? Number(result.serverTime) - Date.now() : 0;
        } else if (!this._claims) {
            this._claims = [];
        }
    }

    _markWarned(target) {
        this._viewKey = `${target.worldId}:${target.targetX}:${target.targetY}`;
        this._warned = true;
    }

    _warnIfClaimed(target) {
        const me = myPlayerId();
        const others = claimsAt(this._claims, target.targetX, target.targetY).filter(c => c.playerId !== me);
        if (!others.length) return;
        const now = Date.now() + (this._serverOffset || 0);
        const list = others.map(c => `${escapeHtml(c.playerName || '?')} (${ago(now - c.claimedAt)})`).join(', ');
        say(`⚠ ${t('watchClaimedBy', { players: list })}`, false);
    }

    // ─── Local claims cache ──────────────────────────────────────────

    /** Merge claims the server just returned into the cached list (by id, or by player + coordinate). */
    _remember(claims, serverTime) {
        if (!this._claims) return;
        for (const c of claims) {
            if (!c) continue;
            this._claims = this._claims.filter(k => k.id !== c.id
                && !(k.playerId === c.playerId && k.targetX === c.targetX && k.targetY === c.targetY));
            this._claims.push(c);
        }
        if (Number(serverTime)) this._serverOffset = Number(serverTime) - Date.now();
    }

    _forget(claims) {
        if (!this._claims) return;
        const ids = new Set(claims.map(c => c && c.id));
        this._claims = this._claims.filter(c => !ids.has(c.id));
    }

    // ─── Checks ──────────────────────────────────────────────────────

    _ready() {
        if (!this.running) return false;
        if (!this.api.isConfigured) { say(t('watchNoServer')); return false; }
        return true;
    }

    _usable(target) {
        if (!target) { say(t('watchSelectFirst')); return false; }
        if (target.notForgotten) { say(t('watchOnlyForgotten')); return false; }
        if (!target.targetType) { say(t('watchSelectFirst')); return false; }
        return true;
    }
}

// ─── Target reading (exported for the tests) ─────────────────────────

/**
 * The target the player has selected: in the base view the base on screen,
 * on the world map the selected object. Returns
 *   {targetType, targetLevel, targetX, targetY, worldId}  — a Forgotten camp/outpost/base
 *   {notForgotten: true}                                  — a player base
 *   null                                                  — nothing usable selected / data not ready
 */
export function readSelectedTarget() {
    try {
        const md = ClientLib.Data.MainData.GetInstance();
        const vis = ClientLib.Vis.VisMain.GetInstance();
        const baseModes = BASE_VIEW_MODES.map(m => ClientLib.Vis.Mode[m]).filter(m => m !== undefined);
        let x, y, cityLevel = null, inBaseView = false;

        if (baseModes.includes(vis.get_Mode())) {
            const city = md.get_Cities().get_CurrentCity();
            if (!city || city.get_IsGhostMode() || city.IsOwnBase()) return null;
            if (PLAYER_FACTIONS.includes(city.get_CityFaction())) return { notForgotten: true };
            x = city.get_PosX();
            y = city.get_PosY();
            cityLevel = city.get_LvlBase();
            inBaseView = true;
        } else {
            const sel = vis.get_SelectedObject();
            if (!sel || typeof sel.get_VisObjectType !== 'function') return null;
            const types = ClientLib.Vis.VisObject.EObjectType;
            const type = sel.get_VisObjectType();
            if (type === types.RegionCityType) return { notForgotten: true };
            if (type !== types.RegionNPCBase && type !== types.RegionNPCCamp) return null;
            x = sel.get_RawX();
            y = sel.get_RawY();
            try {
                const city = md.get_Cities().GetCity(sel.get_Id());
                if (city && !city.get_IsGhostMode()) cityLevel = city.get_LvlBase();
            } catch { /* not loaded — the world object has the level */ }
        }
        if (!(x >= 0 && y >= 0)) return null;

        const obj = md.get_World().GetObjectFromPosition(x, y);
        let targetType = null;
        let level = null;
        if (obj && obj.Type === 3) {
            targetType = CAMP_TYPES[obj.$CampType] || null;   // 0 = destroyed camp → nothing to claim
            level = obj.$Level;
        } else if (obj && obj.Type === 2) {
            targetType = 'base';
            level = obj.$Level;
        } else if (inBaseView) {
            targetType = 'base';     // a Forgotten base in view whose world object is not loaded
        }
        if (!targetType) return null;
        if (level === null || level === undefined || !Number.isFinite(Number(level))) level = cityLevel;
        level = Number(level);

        return {
            targetType,
            targetLevel: Number.isFinite(level) && level >= 0 ? Math.min(level, 100) : 0,
            targetX: Math.round(Number(x)),
            targetY: Math.round(Number(y)),
            worldId: Number(md.get_Server().get_WorldId()),
        };
    } catch {
        return null;
    }
}

/** Claims on coordinate x:y. */
export function claimsAt(claims, x, y) {
    return (claims || []).filter(c => c && c.targetX === x && c.targetY === y);
}

/** "45 min ago" / "2 hours ago" (translated) from an age in ms. */
export function ago(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 1) return t('watchAgoNow');
    if (min < 60) return t('watchAgoMin', { n: min });
    const h = Math.round(min / 60);
    return t(h === 1 ? 'watchAgoHour' : 'watchAgoHours', { n: h });
}

function names(claims) {
    return claims.map(c => escapeHtml((c && c.playerName) || '?')).join(', ');
}

function myPlayerId() {
    try {
        const player = ClientLib.Data.MainData.GetInstance().get_Player();
        return Number(typeof player.get_Id === 'function' ? player.get_Id() : player.id) || 0;
    } catch {
        return 0;
    }
}

function currentWorldId() {
    try {
        return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId()) || 0;
    } catch {
        return 0;
    }
}

/** Chat line (local, only the player sees it) + the same text in the console. */
function say(msg, withPrefix = true) {
    const text = `[ST] ${withPrefix ? 'WatchList: ' : ''}${msg}`;
    chatMessage(text);
    console.log(text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}
