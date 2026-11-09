// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * chat-manager.js — close the chat at start, keep a longer chat history, and
 * enrich the chat (own name highlighted, urls clickable, text kept selectable).
 *
 * Off by default — `/st plugin enable chat-manager`. Settings:
 *   chatmanager.closeOnStart  (default false) — close the chat window when the game loads
 *                             (not when the plugin is enabled later in a session)
 *   chatmanager.historyLength (default 512, 64..512) — messages kept per chat channel
 *   chatmanager.mentionColor  (default #ffff00; 'none' = off) — your player name in chat messages
 *   chatmanager.linkify       (default true) — plain http(s) urls become links (new tab)
 * Without a setting: the chat Labels are kept selectable (safety net; the current
 * client already allows selecting and copying). Enrichment details and the
 * "coordinates in whispers" finding: lib/chat-enrich.js.
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
import { enrich, keepSelectable, mentionColor } from '../lib/chat-enrich.js';

export const DEFAULT_HISTORY = 512;
export const MIN_HISTORY = 64;
export const MAX_HISTORY = 512;
const STARTUP_WINDOW_MS = 3 * 60 * 1000;   // "at start" = within 3 min after the page loaded
const FIND_CHAT_MS = 2000;                  // retry while the chat window has no DOM yet

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
        this._observer = null;
        this._chatRoot = null;
        this._findTimer = null;
        this._pending = false;
        this._enriched = 0;
    }

    async start() {
        this.running = true;
        this.applyHistory();
        // only when the game (re)loads, not when the plugin is enabled later in the session
        const atStartup = typeof performance === 'undefined' || performance.now() < STARTUP_WINDOW_MS;
        if (atStartup && this.config.get('chatmanager.closeOnStart', false) === true) this.closeChat();
        this._startEnrich();
        chatMessage(`[ST] ${t('chatManagerEnabled', { n: historyLength(this.config) })}`);
    }

    stop() {
        this.running = false;
        const W = this._widgetClass();
        if (W && this._oldSize !== null) W.recvbufsize = this._oldSize;
        const P = this._ringProto();
        if (P && this._wrapper && P.push === this._wrapper) P.push = this._push;
        this._oldSize = this._push = this._wrapper = null;
        this._stopEnrich();
        console.log('[ST] ChatManager: stopped (chat history back to the game default for new channels)');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return t('chatManagerStatusOff');
        return t('chatManagerStatusOn', { n: historyLength(this.config), grown: this._grown, enriched: this._enriched });
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

    // ─── Enrichment (5.48.0) ──────────────────────────────────────────

    _chatDom() {
        try { return qx.core.Init.getApplication().getChat().getContentElement().getDomElement(); } catch { return null; }
    }

    _playerName() {
        try { return String(ClientLib.Data.MainData.GetInstance().get_Player().get_Name() || ''); } catch { return ''; }
    }

    _enrichOptions() {
        return {
            name: this._playerName(),
            linkify: this.config.get('chatmanager.linkify', true) !== false,
            color: mentionColor(this.config.get('chatmanager.mentionColor', undefined)),
        };
    }

    /** Observe the chat window; every change (a new message re-renders the pane) is enriched. */
    _startEnrich() {
        const root = this._chatDom();
        if (!root || typeof MutationObserver === 'undefined') {
            if (this.running && !this._findTimer) {
                this._findTimer = setTimeout(() => { this._findTimer = null; if (this.running) this._startEnrich(); }, FIND_CHAT_MS);
            }
            return;
        }
        this._chatRoot = root;
        this._observer = new MutationObserver(() => this._schedule());
        this.enrichNow();
    }

    _stopEnrich() {
        if (this._findTimer) clearTimeout(this._findTimer);
        this._findTimer = null;
        if (this._observer) this._observer.disconnect();
        this._observer = null;
        this._chatRoot = null;
        // what was added stays until the game re-renders the pane (next message)
    }

    _schedule() {
        if (this._pending) return;
        this._pending = true;
        setTimeout(() => { this._pending = false; if (this.running) this.enrichNow(); }, 0);
    }

    /** One pass: enrich + selection safety net, with our own changes not observed. */
    enrichNow() {
        const root = this._chatRoot;
        if (!root) return 0;
        let added = 0;
        if (this._observer) this._observer.disconnect();
        try {
            added = enrich(root, this._enrichOptions());
            this._enriched += added;
            if (keepSelectable(root)) console.log('[ST] ChatManager: chat text made selectable again');
        } catch (err) {
            console.warn('[ST] ChatManager: enrich failed', err && err.message);
        }
        if (this._observer && this.running) this._observer.observe(root, { childList: true, subtree: true, characterData: true });
        return added;
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
