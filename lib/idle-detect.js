/**
 * idle-detect.js — track player activity.
 *
 * Fires callbacks when the player goes idle (20 min no input)
 * or becomes active again. Used by scanners to run background
 * work only when the player isn't actively playing.
 */

const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

export class IdleDetect {
    constructor() {
        this.lastActivity = Date.now();
        this.idle = false;
        this._interval = null;
        this._onActivity = this._onActivity.bind(this);
        this.listeners = { idle: [], active: [] };
    }

    start() {
        for (const evt of ACTIVITY_EVENTS) {
            document.addEventListener(evt, this._onActivity, true);
        }
        this._interval = setInterval(() => this._check(), 1000);
    }

    stop() {
        for (const evt of ACTIVITY_EVENTS) {
            document.removeEventListener(evt, this._onActivity, true);
        }
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    /** Register a callback for 'idle' or 'active' events. */
    on(event, fn) {
        if (this.listeners[event]) this.listeners[event].push(fn);
    }

    get isIdle() { return this.idle; }

    _onActivity() {
        this.lastActivity = Date.now();
        if (this.idle) {
            this.idle = false;
            this.listeners.active.forEach(fn => fn());
        }
    }

    _check() {
        if (this.idle) return;
        if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) {
            this.idle = true;
            this.listeners.idle.forEach(fn => fn());
        }
    }
}
