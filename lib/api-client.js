/**
 * api-client.js — POST scans to the Shockr Alliance Server.
 *
 * Handles:
 * - Configurable server URL and API key
 * - Batching (collect scans, flush every 30s or when 25 are queued)
 * - Pacing: at most one /api/scan request per 2 s (all flushes share one slot)
 * - 429: backoff 5 s, 10 s, 20 s; still 429 → the rest of the batch goes back
 *   in the queue for the next flush (no retry storm)
 * - Network errors: retry with exponential backoff
 * - Chat feedback on success/failure
 * - Player identity on every request (X-Player-Id / X-Player-Name /
 *   X-Alliance-Id) for the server's alliance membership check
 * - Auth: personal key (X-Player-Key, from `/st register`) when it belongs to
 *   the logged-in player, else the shared alliance key (X-Alliance-Key,
 *   api.key) during the transition period
 */
import { chatMessage } from './main.js';
import { t } from './i18n.js';

const MAX_BATCH = 25;
const FLUSH_INTERVAL_MS = 30000;
const MAX_RETRIES = 3;
/** Min. time between two /api/scan requests (server rate limit). */
const SCAN_MIN_INTERVAL_MS = 2000;
/** Waits after a 429: 5 s, 10 s, 20 s (MAX_RETRIES attempts). */
const RATE_LIMIT_BACKOFF_MS = 5000;
/** Min. time between "rejected" chat messages (403 can repeat per scan / per target). */
const REJECT_NOTIFY_INTERVAL_MS = 60000;
/** Server 403 detail prefixes → chat message key (anything else: wrong shared key). */
const REJECT_MESSAGES = [
    ['Not a recognized alliance member', 'notAMember'],
    ['Not registered', 'notRegistered'],
    ['Invalid player key', 'playerKeyRejected'],
];
/** Server 403 details of POST /api/enroll → popup message key. */
const ENROLL_ERRORS = {
    'Invalid enrollment code': 'registerInvalidCode',
    'Alliance not authorized': 'registerNotAuthorized',
};

export class ApiClient {
    constructor(config) {
        this.config = config;
        this.queue = [];
        this._flushTimer = null;
        this._lastRejectNotify = 0;
        this._nextScanAt = 0;      // earliest moment the next /api/scan may go out
        this._flushing = null;     // running flush (concurrent flush() calls wait for it)
    }

    /** Check if the API is configured (URL + personal or shared key set). */
    get isConfigured() {
        return !!(this._url && (this._playerKey || this._key));
    }

    /** 'player' (personal key active), 'shared' (only the alliance key) or 'none'. */
    get registration() {
        if (this._playerKey) return 'player';
        return this._key ? 'shared' : 'none';
    }

    get _url() {
        return this.config.get('api.url', '');
    }

    get _key() {
        return this.config.get('api.key', '');
    }

    /**
     * Personal key — only when it was issued to the logged-in player (several
     * accounts/worlds can share this browser's localStorage).
     */
    get _playerKey() {
        const key = this.config.get('api.playerKey', '');
        if (!key) return '';
        const owner = this.config.get('api.playerKeyId', 0);
        return owner && owner === readPlayer()?.id ? key : '';
    }

    /**
     * POST /api/enroll with the enrollment code and the player's identity; on
     * success the personal key is stored in api.playerKey (never shown).
     * @param {string} code
     * @returns {Promise<{ok: boolean, message: string, vars?: object}>} message = i18n key
     */
    async enroll(code) {
        if (!this._url) return { ok: false, message: 'registerNoServer' };
        const player = readPlayer();
        if (!player || !player.id || !player.name || !player.worldId) {
            return { ok: false, message: 'registerNoGameData' };
        }
        if (!player.allianceId) return { ok: false, message: 'registerNoAlliance' };

        try {
            const resp = await fetch(this._url.replace(/\/$/, '') + '/api/enroll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerId: player.id,
                    playerName: player.name,
                    allianceId: player.allianceId,
                    worldId: player.worldId,
                    enrollmentCode: code,
                }),
            });
            let data = {};
            try { data = await resp.json(); } catch { /* no JSON body */ }

            if (resp.ok && data.playerKey) {
                this.config.set('api.playerKey', String(data.playerKey));
                this.config.set('api.playerKeyId', player.id);
                return { ok: true, message: 'registerSuccess' };
            }
            if (resp.status === 403 && ENROLL_ERRORS[data.detail]) {
                return { ok: false, message: ENROLL_ERRORS[data.detail] };
            }
            if (resp.status === 429) return { ok: false, message: 'registerRateLimited' };
            return { ok: false, message: 'registerFailed', vars: { error: `HTTP ${resp.status}` } };
        } catch (e) {
            console.warn('[ST] API: enroll network error', e.message);
            return { ok: false, message: 'registerFailed', vars: { error: e.message } };
        }
    }

    /** Queue a scan payload for sending. */
    send(payload) {
        if (!this.isConfigured) return;

        this.queue.push(payload);

        if (this.queue.length >= MAX_BATCH) {
            this.flush();
        } else if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
        }
    }

    /**
     * Flush all queued scans to the server. Only one flush runs at a time: a
     * call during a running flush waits for it and then sends what is left.
     */
    async flush() {
        while (this._flushing) await this._flushing;
        this._flushing = this._flush();
        try {
            await this._flushing;
        } finally {
            this._flushing = null;
        }
    }

    async _flush() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        if (this.queue.length === 0 || !this.isConfigured) return;

        const batch = this.queue.splice(0, MAX_BATCH);
        let success = 0;
        let failed = 0;

        for (let i = 0; i < batch.length; i++) {
            const result = await this._sendOne(batch[i]);
            if (result === true) {
                success++;
            } else if (result === 'rateLimited') {
                // Server still says 429 after the full backoff: stop here and
                // keep this scan + the rest for the next flush.
                const rest = batch.slice(i);
                this.queue.unshift(...rest);
                console.warn(`[ST] API: rate limited — ${rest.length} scan(s) kept for the next flush`);
                if (!this._flushTimer) {
                    this._flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
                }
                break;
            } else {
                failed++;
            }
        }

        if (success > 0) {
            console.log(`[ST] API: ${success} scan(s) sent`);
        }
        if (failed > 0) {
            chatMessage(`[ST] ${t('scansFailed', { count: failed })}`);
        }
    }

    /** Wait until the scan slot is free (>= SCAN_MIN_INTERVAL_MS since the previous request). */
    async _paceScan() {
        const wait = this._nextScanAt - Date.now();
        if (wait > 0) await sleep(wait);
        this._nextScanAt = Date.now() + SCAN_MIN_INTERVAL_MS;
    }

    /**
     * Send a single scan with retry.
     * @returns {Promise<true|false|'rateLimited'>} 'rateLimited' = still 429 after all backoffs
     */
    async _sendOne(payload, attempt = 0) {
        const url = this._url.replace(/\/$/, '') + '/api/scan';

        try {
            await this._paceScan();
            const resp = await fetch(url, {
                method: 'POST',
                headers: this._headers(true),
                body: JSON.stringify(payload),
            });

            if (resp.ok) {
                const data = await resp.json();
                return true;
            }

            if (resp.status === 403) {
                await this._notifyRejected(resp);
                return false;
            }

            if (resp.status === 429) {
                // Rate limited — back off 5 s, 10 s, 20 s, then give up for this flush
                if (attempt < MAX_RETRIES) {
                    const backoff = RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
                    console.warn(`[ST] API: 429 rate limited — retry in ${backoff / 1000}s`);
                    await sleep(backoff);
                    return this._sendOne(payload, attempt + 1);
                }
                return 'rateLimited';
            }

            // Other error
            console.warn(`[ST] API: ${resp.status} ${resp.statusText}`);
            return false;

        } catch (e) {
            // Network error — retry
            if (attempt < MAX_RETRIES) {
                await sleep(1000 * Math.pow(2, attempt));
                return this._sendOne(payload, attempt + 1);
            }
            console.warn('[ST] API: network error', e.message);
            return false;
        }
    }

    /**
     * One-off JSON request without queue/batching/retry (e.g. target-watch).
     * @param {string} method — 'GET' | 'POST'
     * @param {string} path — e.g. '/api/target-watch'
     * @param {object} [body] — sent as JSON when given
     * @returns {Promise<object|null>} parsed response ({} if empty), or null on failure
     */
    async request(method, path, body) {
        if (!this.isConfigured) return null;
        const url = this._url.replace(/\/$/, '') + path;
        const headers = this._headers(body !== undefined);

        try {
            const resp = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });

            if (resp.status === 403) {
                await this._notifyRejected(resp);
                return null;
            }
            if (!resp.ok) {
                // 5.6.1: a 422 says which field the server rejected - show it
                let detail = '';
                if (resp.status === 422) {
                    try { detail = ' ' + JSON.stringify((await resp.json()).detail); } catch { /* no JSON body */ }
                }
                console.warn(`[ST] API: ${method} ${path} → ${resp.status} ${resp.statusText}${detail}`);
                return null;
            }
            return await resp.json().catch(() => ({}));
        } catch (e) {
            console.warn(`[ST] API: ${method} ${path} network error`, e.message);
            return null;
        }
    }

    /** Auth + player identity headers (the name is URI-encoded: headers must be Latin-1). */
    _headers(json) {
        const playerKey = this._playerKey;
        const headers = playerKey ? { 'X-Player-Key': playerKey } : { 'X-Alliance-Key': this._key };
        Object.assign(headers, getPlayerIdentity());
        if (json) headers['Content-Type'] = 'application/json';
        return headers;
    }

    /** Chat message for a 403: not a member / not registered / wrong key (at most once per minute). */
    async _notifyRejected(resp) {
        let detail = '';
        try { detail = String((await resp.json()).detail || ''); } catch { /* no JSON body */ }
        const now = Date.now();
        if (now - this._lastRejectNotify < REJECT_NOTIFY_INTERVAL_MS) return;
        this._lastRejectNotify = now;
        const match = REJECT_MESSAGES.find(([prefix]) => detail.startsWith(prefix));
        chatMessage(`[ST] ${t(match ? match[1] : 'apiKeyRejected')}`);
    }

    /** Stop the flush timer. */
    stop() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        // Try to flush remaining
        this.flush();
    }
}

/**
 * The logged-in player from ClientLib, or null when game data isn't ready.
 * @returns {{id: number, name: string, allianceId: number, worldId: number}|null}
 */
function readPlayer() {
    try {
        const md = ClientLib.Data.MainData.GetInstance();
        const player = md.get_Player();
        const id = typeof player.get_Id === 'function' ? player.get_Id() : player.id;
        const name = typeof player.get_Name === 'function' ? player.get_Name() : player.name;
        let allianceId = typeof player.get_AllianceId === 'function' ? player.get_AllianceId() : 0;
        if (!allianceId) {
            const alliance = md.get_Alliance();
            allianceId = alliance ? alliance.get_Id() : 0;
        }
        let worldId = 0;
        try { worldId = md.get_Server().get_WorldId(); } catch { /* fall back to the URL */ }
        if (!worldId) {
            const m = location.pathname.match(/\/(\d+)\/index\.aspx/i);
            worldId = m ? Number(m[1]) : 0;
        }
        return { id: id || 0, name: name || '', allianceId: allianceId || 0, worldId };
    } catch {
        return null;
    }
}

/** X-Player-Id / X-Player-Name / X-Alliance-Id of the logged-in player ({} fields left out if unknown). */
function getPlayerIdentity() {
    const out = {};
    const player = readPlayer();
    if (!player) return out; // game data not ready — server answers 403
    if (player.id) out['X-Player-Id'] = String(player.id);
    if (player.name) out['X-Player-Name'] = encodeURIComponent(player.name);
    out['X-Alliance-Id'] = String(player.allianceId);
    return out;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
