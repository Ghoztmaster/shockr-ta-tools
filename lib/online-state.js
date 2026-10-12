/**
 * online-state.js — pause the background scanners while the player is "Online".
 *
 * Polls the player's own OnlineState (0=Offline, 1=Online, 2=Away, 3=Hidden,
 * same codes player-status.js colours the map with). State 1 pauses the
 * LayoutScanner and AllianceScanner; any other known state resumes them.
 * One shared instance for both scanners, so the console line appears once
 * per transition. The TargetWatcher does not use this.
 *
 * Pausing blocks new automatic scans AND stops a running automatic batch at
 * its next base (the scanners check isPaused per base). Manual scans
 * (/st scan, /st scanalliance) are not blocked.
 *
 * Source of the own state, first that answers:
 *   1. alliance.get_MemberData().d[ownId].OnlineState — the field
 *      player-status.js reads for every member (verified 2026-09-30)
 *   2. player.get_OnlineState() — fallback for a player without alliance,
 *      NOT verified live
 * Neither readable → state unknown → never paused (same behaviour as before
 * this feature), one console warning.
 */

const POLL_MS = 10000;
const ONLINE = 1;

const STATE_NAMES = { 0: 'offline', 1: 'online', 2: 'away', 3: 'hidden' };

/** Own player id: get_Id() where the client has it, else the plain .id field. */
function ownPlayerId(player) {
    if (!player) return null;
    try {
        if (typeof player.get_Id === 'function') {
            const id = Number(player.get_Id());
            if (id > 0) return id;
        }
    } catch { /* fall back to .id */ }
    const id = Number(player.id);
    return id > 0 ? id : null;
}

/** @returns {number|null} the player's own OnlineState, or null if unreadable */
export function readOwnOnlineState() {
    let md;
    try {
        md = ClientLib.Data.MainData.GetInstance();
    } catch {
        return null;
    }
    try {
        const alliance = md.get_Alliance();
        if (alliance && alliance.get_Id() > 0) {
            const id = ownPlayerId(md.get_Player());
            const member = id === null ? null : alliance.get_MemberData().d[id];
            if (member && typeof member.OnlineState === 'number') return member.OnlineState;
        }
    } catch { /* try the player getter */ }
    try {
        const player = md.get_Player();
        if (typeof player.get_OnlineState === 'function') {
            const s = player.get_OnlineState();
            if (typeof s === 'number') return s;
        }
    } catch { /* unknown */ }
    return null;
}

export class OnlineStateWatch {
    constructor(read = readOwnOnlineState) {
        this._read = read;
        this.state = null;
        this.paused = false;
        this._interval = null;
        this._warned = false;
        this.listeners = { pause: [], resume: [] };
    }

    start() {
        if (this._interval) return;
        this.check();
        this._interval = setInterval(() => this.check(), POLL_MS);
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    /** Register a callback for 'pause' or 'resume'. */
    on(event, fn) {
        if (this.listeners[event]) this.listeners[event].push(fn);
    }

    /** True while the player is Online — scanners start no new scan. */
    get isPaused() { return this.paused; }

    check() {
        const state = this._read();
        if (state === null) {
            if (!this._warned) {
                console.warn('[ST] Scanner: online state not readable — scanners not paused');
                this._warned = true;
            }
            this.state = null;
            this._set(false, null);
            return;
        }
        this._warned = false;
        this.state = state;
        this._set(state === ONLINE, state);
    }

    _set(paused, state) {
        if (paused === this.paused) return;
        this.paused = paused;
        if (paused) {
            console.log('[ST] Scanner paused (player online)');
            this.listeners.pause.forEach(fn => fn());
        } else {
            const why = state === null ? 'state unknown' : `player ${STATE_NAMES[state] || state}`;
            console.log(`[ST] Scanner resumed (${why})`);
            this.listeners.resume.forEach(fn => fn());
        }
    }
}
