// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
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
 *
 * 5.13.0 fix ("scanners do not pause while online"): two gaps closed.
 *   - The member data's OnlineState is only as fresh as the last
 *     alliance.RefreshMemberData(); that refresh used to come solely from
 *     PlayerStatus (every 30 s). With PlayerStatus off the own state froze at
 *     its login value. The watch now refreshes it itself every
 *     REFRESH_EVERY_POLLS polls (30 s).
 *   - main.js started the watch at the very END of startup, after every plugin
 *     and CLI command, so anything that threw on the way left it unstarted
 *     (never paused). It now starts right after it is created, before the
 *     plugins.
 * `/st status` shows the watch's own state (describe()) for a live check.
 */

const POLL_MS = 10000;
const ONLINE = 1;
const REFRESH_EVERY_POLLS = 3;  // member-data refresh every 30 s

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

/** Ask the client to re-fetch the alliance member data (OnlineState lives there). */
export function refreshMemberData() {
    try {
        const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
        if (alliance && alliance.get_Id() > 0 && typeof alliance.RefreshMemberData === 'function') {
            alliance.RefreshMemberData();
        }
    } catch { /* not available — the read below still works on whatever is loaded */ }
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
    constructor(read = readOwnOnlineState, refresh = refreshMemberData) {
        this._read = read;
        this._refresh = refresh;
        this._polls = 0;
        this.state = null;
        this.paused = false;
        this._interval = null;
        this._warned = false;
        this.listeners = { pause: [], resume: [] };
    }

    start() {
        if (this._interval) return;
        this._refresh();
        this.check();
        this._interval = setInterval(() => this._tick(), POLL_MS);
    }

    _tick() {
        this._polls++;
        if (this._polls % REFRESH_EVERY_POLLS === 0) this._refresh();
        this.check();
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

    /** True once start() ran (for /st status). */
    get started() { return this._interval !== null; }

    /** 'paused' | 'active' | 'unknown' | 'stopped' — for /st status. */
    describe() {
        if (!this.started) return 'stopped';
        if (this.state === null) return 'unknown';
        return this.paused ? 'paused' : 'active';
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
