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
 *   chatmanager.compact       (default false) — smaller chat text, tighter lines
 *   chatmanager.width         (default null = game default) — width of the docked chat in px,
 *                             200..50% of the screen; also set by dragging the chat's edge
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
 *
 * Layout (5.49.0), VERIFIED LIVE 2026-11-09:
 *   The chat (webfrontend.gui.chat.ChatWindow) is docked bottom-LEFT at left 0, so its
 *   free edge is the RIGHT one - that is where the drag handle sits (the work order
 *   said "left edge", written for a chat on the right). When docked, the game sizes it
 *   in app._onDesktopResize via chat.setWidthAvailable(left of the bottom bar):
 *   width = max(dimension.dock_width 122, widthAvailable), maxWidth dimension.dock_maxwidth
 *   (624). We shadow setWidthAvailable / setDocked on the chat INSTANCE (no obfuscated
 *   names): after the game's own call, our width is set again.
 *   The docked chat also GROWS ON HOVER: property focusedOrMoused → resetWidth() (natural
 *   width up to maxWidth 624), and on leave an animation back to widthAvailable. With a
 *   width of our own we set minWidth = maxWidth = width, so hover cannot move it; with
 *   chatmanager.width null that game behaviour is untouched (so the handle sits at the
 *   grown edge while you hover, and dragging it from there sets a fixed width).
 *   A wider chat overlaps the bottom bar; undocked, the game's window has its own resize
 *   and we leave it alone (only our minWidth is taken back).
 *   Compact: the message Label (rich, selectable, font "default" = 12px / 1.4) gets a
 *   qx.bom.Font of 10px / 1.15 through setFont, so qx re-measures its height (a CSS
 *   override would leave the old height). The message divs have no padding of their own;
 *   the line height is the spacing between lines.
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';
import { enrich, keepSelectable, mentionColor } from '../lib/chat-enrich.js';

export const DEFAULT_HISTORY = 512;
export const MIN_HISTORY = 64;
export const MAX_HISTORY = 512;
const STARTUP_WINDOW_MS = 3 * 60 * 1000;   // "at start" = within 3 min after the page loaded
const FIND_CHAT_MS = 2000;                  // retry while the chat window has no DOM yet
export const MIN_WIDTH = 200;
export const MAX_WIDTH_SHARE = 0.5;         // at most half the screen
const COMPACT_SIZE = 10;
const COMPACT_LINE_HEIGHT = 1.15;
const HANDLE_ATTR = 'data-st-cm-handle';
const DOCK_FALLBACK = { dock_width: 122, dock_maxwidth: 624 };

/**
 * chatmanager.width → px clamped to 200..50% of the screen, or null = game default
 * (null, '', 'null', 'reset', 'default', 'none', or not a number).
 */
export function chatWidth(value, screenWidth) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim().toLowerCase();
    if (['', 'null', 'reset', 'default', 'none'].includes(s)) return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    const max = Math.max(MIN_WIDTH, Math.floor(screenWidth * MAX_WIDTH_SHARE));
    return Math.min(max, Math.max(MIN_WIDTH, n));
}

function screenWidth() {
    return typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1920;
}

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

    constructor(config, cli = null) {
        this.name = 'ChatManager';
        this.defaultEnabled = false;
        this.config = config;
        this._setWA = null;        // our setWidthAvailable / setDocked on the chat instance
        this._setDocked = null;
        this._customWidth = false; // we changed the width (so a reset is needed)
        this._ownMinWidth = DOCK_FALLBACK.dock_width;   // the chat's minWidth before ours
        this._dragWidth = null;    // width while dragging (saved on release)
        this._handle = null;
        this._fonts = new Map();   // Label → its own font, while compact
        this._compactFont = null;
        if (cli && typeof cli.onConfigSet === 'function') {
            cli.onConfigSet('chatmanager.compact', (v) => this.setCompact(v));
            cli.onConfigSet('chatmanager.width', (v) => this.setWidth(v));
        }
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
        this._startLayout();
        this.enrichNow();
    }

    _stopEnrich() {
        this._stopLayout();
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
            this.applyCompact();       // a new chat pane gets the compact font too
            this._updateHandle();      // re-attach if the game rebuilt the window DOM
        } catch (err) {
            console.warn('[ST] ChatManager: enrich failed', err && err.message);
        }
        if (this._observer && this.running) this._observer.observe(root, { childList: true, subtree: true, characterData: true });
        return added;
    }

    // ─── Layout: compact mode and chat width (5.49.0) ─────────────────

    _chat() {
        try { return qx.core.Init.getApplication().getChat(); } catch { return null; }
    }

    _dims() {
        try { return webfrontend.gui.chat.ChatWindow.dimension || DOCK_FALLBACK; } catch { return DOCK_FALLBACK; }
    }

    _resizeDesktop() {
        try { qx.core.Init.getApplication().triggerDesktopResize(); } catch { /* no app */ }
    }

    /** Shadow the game's width calls on the chat instance, then apply width, handle and compact. */
    _startLayout() {
        const chat = this._chat();
        if (!chat || typeof chat.setWidthAvailable !== 'function' || this._setWA) return;
        const plugin = this;
        const ownWA = chat.setWidthAvailable;
        const ownDocked = chat.setDocked;
        this._setWA = function () {
            const r = ownWA.apply(this, arguments);
            plugin._applyWidth();
            return r;
        };
        chat.setWidthAvailable = this._setWA;
        if (typeof ownDocked === 'function') {
            this._setDocked = function () {
                const r = ownDocked.apply(this, arguments);
                plugin._applyWidth();
                plugin._updateHandle();
                return r;
            };
            chat.setDocked = this._setDocked;
        }
        this._applyWidth();
        this._updateHandle();
        this.applyCompact();
    }

    _stopLayout() {
        const chat = this._chat();
        if (chat) {
            if (this._setWA && chat.setWidthAvailable === this._setWA) delete chat.setWidthAvailable;
            if (this._setDocked && chat.setDocked === this._setDocked) delete chat.setDocked;
        }
        this._setWA = this._setDocked = null;
        if (this._handle && this._handle.parentNode) this._handle.parentNode.removeChild(this._handle);
        this._handle = null;
        this._restoreFonts();
        this._resetWidth();
    }

    /** The width we want now: while dragging the drag width, else the setting (null = game). */
    _wantedWidth() {
        if (this._dragWidth !== null) return this._dragWidth;
        return chatWidth(this.config.get('chatmanager.width', null), screenWidth());
    }

    /** Set our width on the docked chat (called after every game width call). */
    _applyWidth() {
        const chat = this._chat();
        if (!chat || !this.running || !this._setWA) return;
        try {
            if (typeof chat.getDocked === 'function' && !chat.getDocked()) {
                // floating: the game's own resize; only our minWidth goes (the game set the rest)
                if (this._customWidth) chat.setMinWidth(this._ownMinWidth);
                this._customWidth = false;
                return;
            }
            const w = this._wantedWidth();
            if (w === null) {
                this._resetWidth();
                return;
            }
            if (!this._customWidth) this._ownMinWidth = chat.getMinWidth();
            // min = max = width: the game's hover growth (focusedOrMoused → resetWidth, then an
            // animation back to widthAvailable) cannot move a width the player chose
            chat.set({ minWidth: w, maxWidth: w, width: w });
            this._customWidth = true;
        } catch (err) {
            console.warn('[ST] ChatManager: chat width failed', err && err.message);
        }
    }

    /** Back to the game's own width (as its widthAvailable apply would set it). */
    _resetWidth() {
        if (!this._customWidth) return;
        this._customWidth = false;
        const chat = this._chat();
        if (!chat) return;
        try {
            const d = this._dims();
            chat.setMinWidth(this._ownMinWidth);
            if (typeof chat.getDocked !== 'function' || chat.getDocked()) {
                chat.setMaxWidth(d.dock_maxwidth);
                chat.setWidth(Math.max(d.dock_width, chat.getWidthAvailable()));
            }
        } catch (err) {
            console.warn('[ST] ChatManager: chat width reset failed', err && err.message);
        }
    }

    /** The drag handle on the chat's free (right) edge, only while docked. */
    _updateHandle() {
        const root = this._chatRoot || this._chatDom();
        const chat = this._chat();
        if (!root || !chat || !this.running) return;
        const docked = typeof chat.getDocked !== 'function' || chat.getDocked();
        if (!this._handle) this._handle = this._makeHandle(root.ownerDocument);
        if (this._handle.parentNode !== root) root.appendChild(this._handle);
        this._handle.style.display = docked ? 'block' : 'none';
    }

    _makeHandle(doc) {
        const h = doc.createElement('div');
        h.setAttribute(HANDLE_ATTR, '1');
        h.title = t('chatWidthHandle');
        h.style.cssText = 'position:absolute;top:0;right:0;width:6px;height:100%;cursor:ew-resize;z-index:1000;';
        h.addEventListener('pointerdown', (e) => this._onDragStart(e));
        h.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); this.setWidth(null); });
        h.addEventListener('mouseenter', () => { h.style.background = 'rgba(79,195,247,0.5)'; });
        h.addEventListener('mouseleave', () => { if (this._dragWidth === null) h.style.background = ''; });
        return h;
    }

    _onDragStart(e) {
        if (e.button !== 0) return;
        const chat = this._chat();
        if (!chat) return;
        e.preventDefault();
        e.stopPropagation();
        const doc = e.target.ownerDocument;
        const win = doc.defaultView || window;
        const startX = e.clientX;
        const bounds = chat.getBounds && chat.getBounds();
        const startW = bounds ? bounds.width : chat.getWidth();
        const oldSelect = doc.body.style.userSelect;
        doc.body.style.userSelect = 'none';
        this._dragWidth = chatWidth(startW, screenWidth());
        let frame = 0;
        const move = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this._dragWidth = chatWidth(startW + (ev.clientX - startX), screenWidth());
            if (frame) return;
            frame = win.requestAnimationFrame(() => {
                frame = 0;
                this._applyWidth();
                this._resizeDesktop();
            });
        };
        const up = (ev) => {
            ev.stopPropagation();
            win.removeEventListener('pointermove', move, true);
            win.removeEventListener('pointerup', up, true);
            if (frame) win.cancelAnimationFrame(frame);
            doc.body.style.userSelect = oldSelect;
            if (this._handle) this._handle.style.background = '';
            const w = this._dragWidth;
            this._dragWidth = null;
            if (ev.clientX === startX) return;    // a click (or the first half of a double-click): nothing changes
            this.config.set('chatmanager.width', w);
            this._applyWidth();
            this._resizeDesktop();
            console.log(`[ST] ChatManager: chat width ${w}px`);
        };
        win.addEventListener('pointermove', move, true);
        win.addEventListener('pointerup', up, true);
    }

    /** `/st config set chatmanager.width <px|null>`: clamp, store, apply, confirm. */
    setWidth(value) {
        const w = chatWidth(value, screenWidth());
        this.config.set('chatmanager.width', w);
        this._applyWidth();
        this._resizeDesktop();
        chatMessage(`[ST] chatmanager.width = ${w === null ? t('chatWidthDefault') : `${w} px`}`);
    }

    /** `/st config set chatmanager.compact <true|false>`: store, apply, confirm. */
    setCompact(value) {
        const on = value === true || /^(on|yes|1)$/i.test(String(value));
        this.config.set('chatmanager.compact', on);
        this.applyCompact();
        chatMessage(`[ST] chatmanager.compact = ${on}`);
    }

    /** The chat's message Labels (rich + selectable), found through the widget tree. */
    _chatLabels() {
        const chat = this._chat();
        const out = [];
        if (!chat) return out;
        const seen = new Set();
        const walk = (w) => {
            if (!w || seen.has(w)) return;
            seen.add(w);
            if (w.classname === 'qx.ui.basic.Label' && w.getRich && w.getRich() && w.getSelectable && w.getSelectable()) out.push(w);
            const kids = typeof w._getChildren === 'function' ? w._getChildren() : [];
            for (const k of kids) walk(k);
        };
        try { walk(chat); } catch { /* tree changed */ }
        return out;
    }

    _font() {
        if (this._compactFont) return this._compactFont;
        let family = ['Segoe UI', 'Tahoma', 'Liberation Sans', 'Arial'];
        try {
            const def = qx.theme.manager.Font.getInstance().resolve('default');
            if (def && typeof def.getFamily === 'function' && def.getFamily()) family = def.getFamily();
        } catch { /* theme font not found: fallback family */ }
        const f = new qx.bom.Font(COMPACT_SIZE, family);
        f.setLineHeight(COMPACT_LINE_HEIGHT);
        this._compactFont = f;
        return f;
    }

    /** Compact on: every chat Label gets the small font (once); off: own fonts back. */
    applyCompact() {
        const on = this.running && this.config.get('chatmanager.compact', false) === true;
        if (!on) {
            this._restoreFonts();
            return 0;
        }
        let n = 0;
        try {
            const font = this._font();
            for (const label of this._chatLabels()) {
                if (this._fonts.has(label)) continue;
                this._fonts.set(label, label.getFont());
                label.setFont(font);
                n++;
            }
        } catch (err) {
            console.warn('[ST] ChatManager: compact failed', err && err.message);
        }
        return n;
    }

    _restoreFonts() {
        for (const [label, font] of this._fonts) {
            try {
                if (font === null || font === undefined) label.resetFont();
                else label.setFont(font);
            } catch { /* label disposed */ }
        }
        this._fonts.clear();
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
