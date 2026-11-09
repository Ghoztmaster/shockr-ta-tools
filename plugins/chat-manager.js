// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * chat-manager.js — close the chat at start, and keep a longer chat history.
 *
 * Off by default — `/st plugin enable chat-manager`. Settings:
 *   chatmanager.closeOnStart  (default false) — close the chat window when the game loads
 *                             (not when the plugin is enabled later in a session)
 *   chatmanager.historyLength (default 512, 64..512) — messages kept per chat channel
 *
 * Game API (the MaelstromTools ChatClose / "Chat history length" route; own implementation):
 *   close:   app.getChat().isVisible() → app.toggleChat(false), app.triggerDesktopResize()
 *   history: webfrontend.gui.chat.ChatWidget.recvbufsize (game default 64): the capacity
 *            a channel buffer (webfrontend.phe.cnc.RingArray) gets when it is created.
 * Buffers created before we run keep 64, so RingArray.prototype.push is wrapped
 * as well: a buffer that still has the old default capacity is grown with its own
 * resize(n) (which keeps the messages) the next time a message arrives in it.
 * Only buffers of exactly the old recvbufsize grow - the global channel
 * (recvbufsizeGlobal, 1000) and the sent-history (sentbufsize, 32) are left alone.
 * On stop: recvbufsize and push are put back; grown buffers keep their size.
 * VERIFIED LIVE (2026-11-09): toggleChat, recvbufsize (64), recvbufsizeGlobal (1000),
 * RingArray.resize / push (capacity = length of its internal array).
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';

export const DEFAULT_HISTORY = 512;
export const MIN_HISTORY = 64;
export const MAX_HISTORY = 512;
const STARTUP_WINDOW_MS = 3 * 60 * 1000;   // "at start" = within 3 min after the page loaded

/** chatmanager.historyLength, clamped to 64..512. */
export function historyLength(config) {
    const v = Math.round(Number(config.get('chatmanager.historyLength', DEFAULT_HISTORY)));
    if (!Number.isFinite(v)) return DEFAULT_HISTORY;
    return Math.min(MAX_HISTORY, Math.max(MIN_HISTORY, v));
}

/** Capacity of a RingArray: the length of its one internal array (-1 unknown). */
export function capacity(ring) {
    try {
        for (const k of Object.keys(ring)) if (Array.isArray(ring[k])) return ring[k].length;
    } catch { /* not readable */ }
    return -1;
}

export class ChatManager {
    /** Short description for `/st help`. */
    get description() { return t('descChatManager'); }

    constructor(config) {
        this.name = 'ChatManager';
        this.defaultEnabled = false;
        this.config = config;
        this.running = false;
        this._oldSize = null;      // recvbufsize before we changed it
        this._push = null;         // original RingArray.prototype.push
        this._wrapper = null;
        this._grown = 0;
    }

    async start() {
        this.running = true;
        this.applyHistory();
        // only when the game (re)loads, not when the plugin is enabled later in the session
        const atStartup = typeof performance === 'undefined' || performance.now() < STARTUP_WINDOW_MS;
        if (atStartup && this.config.get('chatmanager.closeOnStart', false) === true) this.closeChat();
        chatMessage(`[ST] ${t('chatManagerEnabled', { n: historyLength(this.config) })}`);
    }

    stop() {
        this.running = false;
        const W = this._widgetClass();
        if (W && this._oldSize !== null) W.recvbufsize = this._oldSize;
        const P = this._ringProto();
        if (P && this._wrapper && P.push === this._wrapper) P.push = this._push;
        this._oldSize = this._push = this._wrapper = null;
        console.log('[ST] ChatManager: stopped (chat history back to the game default for new channels)');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return t('chatManagerStatusOff');
        return t('chatManagerStatusOn', { n: historyLength(this.config), grown: this._grown });
    }

    _widgetClass() {
        try { return webfrontend.gui.chat.ChatWidget; } catch { return null; }
    }

    _ringProto() {
        try { return webfrontend.phe.cnc.RingArray.prototype; } catch { return null; }
    }

    /** Set recvbufsize for new channels and grow the existing ones lazily. */
    applyHistory() {
        const W = this._widgetClass();
        if (!W || typeof W.recvbufsize !== 'number') {
            console.warn('[ST] ChatManager: ChatWidget.recvbufsize not found - client changed?');
            return;
        }
        if (this._oldSize === null) this._oldSize = W.recvbufsize;
        const size = historyLength(this.config);
        W.recvbufsize = size;
        const P = this._ringProto();
        if (!P || typeof P.push !== 'function' || typeof P.resize !== 'function' || this._wrapper) return;
        const plugin = this;
        const original = P.push;
        const old = this._oldSize;
        this._push = original;
        this._wrapper = function () {
            try {
                if (plugin.running) {
                    const target = historyLength(plugin.config);
                    const cap = capacity(this);
                    if (cap === old && target > cap) {
                        this.resize(target);
                        plugin._grown++;
                    }
                }
            } catch (err) {
                console.warn('[ST] ChatManager: grow failed', err && err.message);
            }
            return original.apply(this, arguments);
        };
        P.push = this._wrapper;
        console.log(`[ST] ChatManager: chat history ${old} -> ${size}`);
    }

    /** Close the chat window (as MaelstromTools' "Chat closed at start"). */
    closeChat() {
        try {
            const app = qx.core.Init.getApplication();
            if (app.getChat().isVisible()) {
                app.toggleChat(false);
                if (typeof app.triggerDesktopResize === 'function') app.triggerDesktopResize();
                console.log('[ST] ChatManager: chat closed at start');
                return true;
            }
        } catch (err) {
            console.warn('[ST] ChatManager: close chat failed', err && err.message);
        }
        return false;
    }
}
