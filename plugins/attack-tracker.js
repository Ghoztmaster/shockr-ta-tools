/**
 * attack-tracker.js — log your own WON attacks on Forgotten targets to the alliance server.
 *
 * On by default; needs api.url + `/st register` (same config as the scanner).
 * Off: `/st plugin disable attack-tracker`.
 *
 * Source: the player's own combat reports, read-only (same route as the
 * MehrStrom ReportLogger; GAME_CLIENT_API §12, verified live 2026-09-10):
 *   GetReportHeaderAll {type: 1}            — own attacks (EPlayerReportType.CombatOffense), newest first
 *     h.i report id · h.t time (ms) · h.tp EReportType (2 = NPCRaid = Forgotten, 1 = PvP)
 *     h.s won · h.ad.dbl target level · h.ad.dbn ENPCCampType as text · h.ad.dbx/dby target coords
 *   reports.RequestReportData(id) + ReportDelivered event
 *     rep.GetAttackerTotalResourceReceived(EResourceType.Tiberium/Crystal/Gold) — loot
 * Never MarkReportsAsRead / DeleteReports / set_IsRead: the inbox is not touched.
 *
 * Logged only when tp = NPCRaid (no PvP) AND h.s = won, and the target is a
 * camp / outpost / base (dbn 1-2 camp, 3 outpost, 4 base; fortress/event are
 * skipped). Lost attacks never leave the browser.
 *
 * Flow: a poll every POLL_INTERVAL_MS → new won FG reports are fetched one at
 * a time (REQUEST_SPACING_MS apart, ANSWER_TIMEOUT_MS each, MAX_ATTEMPTS, then
 * sent without loot) → the attack goes into a localStorage outbox → flushed
 * as one POST /api/attack with up to POST_BATCH attacks, at most one POST per
 * POST_MIN_INTERVAL_MS. A failed POST keeps the outbox for the next flush.
 *
 * Dedup (localStorage, per world): the last DONE_MAX report ids already put in
 * the outbox; when one is dropped from that list, its time becomes the
 * cutoff and older reports are ignored from then on. A fresh install starts
 * BACKFILL_DAYS back (the server keeps 7 days). The server dedups as well
 * (playerId + target + ±60 s, and the report id), so a re-send is harmless.
 */
import { t } from '../lib/i18n.js';

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const FIRST_POLL_DELAY_MS = 15 * 1000;
const HEADER_TAKE = 50;
const REQUEST_SPACING_MS = 1000;
const ANSWER_TIMEOUT_MS = 15 * 1000;
const MAX_ATTEMPTS = 3;
const POST_MIN_INTERVAL_MS = 5000;
const POST_BATCH = 20;
const MAX_POST_FAILURES = 5;
const OUTBOX_MAX = 200;
const DONE_MAX = 100;
const BACKFILL_DAYS = 7;

const OUTBOX_KEY = 'st-attacks-outbox';
const DONE_KEY_PREFIX = 'st-attacks-done-';     // + worldId → {cutoff, done: [[id, t], ...]}

/** EReportType.NPCRaid — attack on a Forgotten target (1 = Combat = PvP). */
const REPORT_TYPE_NPC_RAID = 2;
/** ENPCCampType (h.ad.dbn, as text) → target type; anything else is not logged. */
const CAMP_TYPES = { 1: 'camp', 2: 'camp', 3: 'outpost', 4: 'base' };

export class AttackTracker {
    /** Short description for `/st help`. */
    get description() { return t('descAttackTracker'); }

    constructor(config, apiClient) {
        this.name = 'AttackTracker';
        this.config = config;
        this.api = apiClient;
        this.running = false;
        this._pollTimer = null;
        this._firstTimer = null;
        this._flushTimer = null;
        this._listener = false;
        this._pollBusy = false;
        this._pending = [];       // headers still to request, oldest first
        this._inFlight = null;    // {header, attempts, timer}
        this._lastRequestAt = 0;
        this._nextRequestTimer = null;
        this._lastPostAt = 0;
        this._posting = false;
        this._logged = 0;
    }

    async start() {
        this.running = true;
        this._firstTimer = setTimeout(() => this.poll(), FIRST_POLL_DELAY_MS);
        this._pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    }

    stop() {
        this.running = false;
        for (const timer of [this._firstTimer, this._flushTimer, this._nextRequestTimer]) {
            if (timer) clearTimeout(timer);
        }
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._inFlight && this._inFlight.timer) clearTimeout(this._inFlight.timer);
        this._pollTimer = this._firstTimer = this._flushTimer = this._nextRequestTimer = null;
        this._pending = [];
        this._inFlight = null;
        this._pollBusy = false;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.api.isConfigured) return t('attackTrackerStatusNoServer');
        return t('attackTrackerStatus', { count: this._logged, queued: loadOutbox().length });
    }

    // ─── Reports ─────────────────────────────────────────────────────

    /** Read the newest report headers and queue the new won FG attacks. */
    poll() {
        if (!this.running || this._pollBusy || !this.api.isConfigured) return;
        const util = gameUtil();
        let md, net, worldId;
        try {
            md = ClientLib.Data.MainData.GetInstance();
            net = ClientLib.Net.CommunicationManager.GetInstance();
            worldId = Number(md.get_Server().get_WorldId());
        } catch {
            return;
        }
        if (!util || !worldId || !this._ensureListener(md, util)) return;

        this._pollBusy = true;
        try {
            net.SendSimpleCommand('GetReportHeaderAll',
                { type: 1, skip: 0, take: HEADER_TAKE, sort: 1, ascending: false },
                util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
                    this._pollBusy = false;
                    this._onHeaders(worldId, Array.isArray(data) ? data : []);
                }), null);
        } catch (e) {
            this._pollBusy = false;
            console.warn('[ST] AttackTracker: GetReportHeaderAll failed', e && e.message);
        }
        this.flush();
    }

    _onHeaders(worldId, headers) {
        if (!this.running) return;
        const state = loadDone(worldId);
        const fresh = headers
            .filter(h => isLoggable(h)
                && h.t > state.cutoff
                && !state.done.some(([id]) => id === h.i)
                && !(this._inFlight && this._inFlight.header.i === h.i)
                && !this._pending.some(p => p.header.i === h.i))
            .reverse();   // oldest first
        for (const h of fresh) this._pending.push({ header: h, worldId, attempts: 0 });
        this._processNext();
    }

    _ensureListener(md, util) {
        if (this._listener) return true;
        try {
            util.attachNetEvent(md.get_Reports(), 'ReportDelivered', ClientLib.Data.Reports.ReportDelivered,
                this, (rep) => this._onDelivered(rep));
            this._listener = true;
            return true;
        } catch (e) {
            console.warn('[ST] AttackTracker: ReportDelivered listener not attached', e && e.message);
            return false;
        }
    }

    /** Request the next report: one at a time, REQUEST_SPACING_MS apart. */
    _processNext() {
        if (!this.running || this._inFlight || this._nextRequestTimer || !this._pending.length) return;
        const wait = REQUEST_SPACING_MS - (Date.now() - this._lastRequestAt);
        if (wait > 0) {
            this._nextRequestTimer = setTimeout(() => { this._nextRequestTimer = null; this._processNext(); }, wait);
            return;
        }
        const item = this._pending.shift();
        item.attempts++;
        this._inFlight = item;
        this._lastRequestAt = Date.now();
        item.timer = setTimeout(() => this._onTimeout(), ANSWER_TIMEOUT_MS);
        try {
            ClientLib.Data.MainData.GetInstance().get_Reports().RequestReportData(item.header.i);
        } catch (e) {
            clearTimeout(item.timer);
            this._onTimeout();
        }
    }

    /** ReportDelivered also fires when the player opens a report — only ours counts. */
    _onDelivered(rep) {
        const item = this._inFlight;
        let id;
        try { id = rep.get_Id(); } catch { return; }
        if (!item || item.header.i !== id) return;
        clearTimeout(item.timer);
        this._inFlight = null;
        this._commit(item, readLoot(rep));
        this._processNext();
    }

    _onTimeout() {
        const item = this._inFlight;
        this._inFlight = null;
        if (!item) return;
        if (item.attempts < MAX_ATTEMPTS) {
            this._pending.push(item);
        } else {
            console.warn(`[ST] AttackTracker: report ${item.header.i} not delivered after ${item.attempts} attempts — logged without loot`);
            this._commit(item, { tib: 0, cry: 0, credits: 0 });
        }
        this._processNext();
    }

    /** Outbox first, then the done list: a crash in between can only re-send (server dedups), never lose. */
    _commit(item, loot) {
        const attack = buildAttack(item.header, item.worldId, loot);
        if (!attack) return;
        const outbox = loadOutbox();
        outbox.push({ attack, failures: 0 });
        saveOutbox(outbox.slice(-OUTBOX_MAX));
        markDone(item.worldId, item.header.i, item.header.t);
        this._scheduleFlush();
    }

    // ─── POST ────────────────────────────────────────────────────────

    _scheduleFlush() {
        if (this._flushTimer) return;
        const wait = Math.max(0, POST_MIN_INTERVAL_MS - (Date.now() - this._lastPostAt));
        this._flushTimer = setTimeout(() => { this._flushTimer = null; this.flush(); }, wait);
    }

    /** Send what the outbox holds — one POST, at most one per POST_MIN_INTERVAL_MS. */
    async flush() {
        if (!this.running || this._posting || !this.api.isConfigured) return;
        if (Date.now() - this._lastPostAt < POST_MIN_INTERVAL_MS) {
            this._scheduleFlush();
            return;
        }
        const batch = loadOutbox().slice(0, POST_BATCH);
        if (!batch.length) return;

        this._posting = true;
        this._lastPostAt = Date.now();
        let result = null;
        try {
            result = await this.api.request('POST', '/api/attack', batch.map(e => e.attack));
        } finally {
            this._posting = false;
        }

        const sent = new Set(batch.map(e => attackKey(e.attack)));
        let outbox = loadOutbox();
        if (result) {
            outbox = outbox.filter(e => !sent.has(attackKey(e.attack)));
            for (const { attack: a } of batch) {
                console.log(`[ST] Attack logged: ${a.targetType} lvl ${a.targetLevel} @ ${a.targetX}:${a.targetY}`);
            }
            this._logged += batch.length;
        } else {
            // Rejected or unreachable: keep for the next flush; a batch that keeps failing is dropped
            outbox = outbox
                .map(e => (sent.has(attackKey(e.attack)) ? { ...e, failures: (e.failures || 0) + 1 } : e))
                .filter(e => {
                    if ((e.failures || 0) < MAX_POST_FAILURES) return true;
                    console.warn(`[ST] AttackTracker: dropped after ${e.failures} failed POSTs`, e.attack);
                    return false;
                });
        }
        saveOutbox(outbox);
        if (result && outbox.length) this._scheduleFlush();
    }
}

// ─── Pure helpers (exported for the tests) ───────────────────────────

/** Won attack (h.s) on a Forgotten camp/outpost/base (tp NPCRaid) with coordinates. */
export function isLoggable(h) {
    if (!h || h.i === undefined || h.tp !== REPORT_TYPE_NPC_RAID || h.s !== true) return false;
    const ad = h.ad || {};
    return !!CAMP_TYPES[parseInt(ad.dbn, 10)] && Number.isFinite(Number(ad.dbx)) && Number.isFinite(Number(ad.dby))
        && typeof h.t === 'number';
}

/** POST body for one attack (AttackPayload in server/attacks.py), or null when the header is not loggable. */
export function buildAttack(h, worldId, loot) {
    if (!isLoggable(h)) return null;
    const ad = h.ad;
    const level = Number(ad.dbl);
    return {
        targetType: CAMP_TYPES[parseInt(ad.dbn, 10)],
        targetLevel: Number.isFinite(level) && level >= 0 ? level : 0,
        targetX: Math.round(Number(ad.dbx)),
        targetY: Math.round(Number(ad.dby)),
        lootTib: nonNeg(loot.tib),
        lootCrystal: nonNeg(loot.cry),
        lootCredits: nonNeg(loot.credits),
        worldId: Number(worldId),
        timestamp: h.t,
        reportId: h.i,
    };
}

function readLoot(rep) {
    const E = ClientLib.Base.EResourceType;
    const get = (name) => {
        try { return E[name] === undefined ? 0 : rep.GetAttackerTotalResourceReceived(E[name]); } catch { return 0; }
    };
    return { tib: get('Tiberium'), cry: get('Crystal'), credits: get('Gold') };
}

function nonNeg(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function attackKey(a) {
    return `${a.worldId}:${a.reportId}:${a.targetX}:${a.targetY}:${a.timestamp}`;
}

function gameUtil() {
    if (typeof webfrontend !== 'undefined' && webfrontend.phe && webfrontend.phe.cnc && webfrontend.phe.cnc.Util) return webfrontend.phe.cnc.Util;
    if (typeof phe !== 'undefined' && phe.cnc && phe.cnc.Util) return phe.cnc.Util;
    return null;
}

function loadOutbox() {
    try {
        const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch { return []; }
}

function saveOutbox(outbox) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* full / private mode */ }
}

/** {cutoff, done} for a world; a fresh install starts BACKFILL_DAYS back. */
export function loadDone(worldId) {
    try {
        const v = JSON.parse(localStorage.getItem(DONE_KEY_PREFIX + worldId) || 'null');
        if (v && Array.isArray(v.done) && typeof v.cutoff === 'number') return v;
    } catch { /* fall through */ }
    return { cutoff: Date.now() - BACKFILL_DAYS * 86400 * 1000, done: [] };
}

/** Remember a report id; past DONE_MAX the oldest goes and its time becomes the cutoff. */
export function markDone(worldId, id, time) {
    const state = loadDone(worldId);
    if (!state.done.some(([d]) => d === id)) state.done.push([id, time]);
    state.done.sort((a, b) => a[1] - b[1]);
    while (state.done.length > DONE_MAX) {
        const [, dropped] = state.done.shift();
        state.cutoff = Math.max(state.cutoff, dropped);
    }
    try { localStorage.setItem(DONE_KEY_PREFIX + worldId, JSON.stringify(state)); } catch { /* not remembered */ }
}
