// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * chat-activity.js — ChatManager's unread badge and auto-scroll toggle (5.50.0).
 *
 *   chatmanager.unreadBadge (default true)  — a count bubble on a chat tab with unread
 *        messages, and on the chat button while the chat is closed
 *   chatmanager.autoScroll  (default true)  — the ⬇ button's state: true = the chat follows
 *        new messages, false = it stays where it is and a "↓ X new messages" bar appears
 *
 * Game facts used (VERIFIED LIVE 2026-11-09), all readable names, no obfuscated ones:
 *   webfrontend.gui.chat.ChatWidget declares two qx Data events:
 *     chatmessagein  - fired for every INCOMING message with its channel flag; not for
 *                      your own messages, own whispers or system lines to all channels.
 *                      (The game's tab-icon blink listens to it.)
 *     chatmessageout - fired when a tab is shown (tab switch, chat opened), data = its flags
 *   ChatWidget.channel: all 1, alliance 2, officers 4, whisper 8, global 16.
 *   Tabs = the TabView's pages; page.meta.flags (All tab = 1), page.getButton(),
 *   page.ui.scrcontent (the qx.ui.container.Scroll of that tab).
 *   page.autoscroll: the game's own follow flag per tab. Its scrollbar listener turns it
 *   off when you scroll up and on again when you reach the bottom; scrollToEnd(true)
 *   sets it on and scrolls. So "auto-scroll off" here is simply page.autoscroll = false.
 *   The chat button (webfrontend.gui.chat.ChatButtonWidget) is only visible while the
 *   chat is closed.
 *   The game scrolls to the end by itself when a tab is shown or the chat opens; only a
 *   scroll to the bottom right after your own input in the chat turns auto-scroll back on
 *   (VERIFIED LIVE: a time window after the tab switch was not enough - the game's scroll
 *   can come later), a game scroll is paused again.
 *   The docked chat is narrower than its content (the right part, scrollbar included,
 *   is cut off until you hover), so the ⬇ button is placed against the visible edge.
 */
import { t } from './i18n.js';

export const CHANNEL = { all: 1, alliance: 2, officers: 4, whisper: 8, global: 16 };
const MARK = 'data-st-cm';          // chat-enrich skips everything carrying it
const USER_MS = 1500;               // a scroll this soon after your own wheel / click / key in the chat is yours

/** Unread messages for a tab with these channel flags (the All tab: everything). */
export function tabUnread(unread, flags) {
    let n = 0;
    for (const [ch, count] of Object.entries(unread)) {
        if ((flags & CHANNEL.all) || (flags & Number(ch))) n += count;
    }
    return n;
}

/** Remove the channels a shown tab covers from the unread counts (All tab: everything). */
export function markRead(unread, flags) {
    for (const ch of Object.keys(unread)) {
        if ((flags & CHANNEL.all) || (flags & Number(ch))) delete unread[ch];
    }
    return unread;
}

/** Badge text: up to 99, then 99+. */
export function badgeText(n) {
    return n > 99 ? '99+' : String(n);
}

function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}

function setStyle(el, prop, value) {
    if (el.style[prop] !== value) el.style[prop] = value;
}

export class ChatActivity {
    constructor(config) {
        this.config = config;
        this.unread = {};          // channel flag → count
        this.newCount = 0;         // new messages in the shown tab while not following
        this.running = false;
        this._listeners = [];      // [qx object, listener id]
        this._badges = new Map();  // widget → badge element
        this._chatButton = null;
        this._scrollBtn = null;
        this._bar = null;
        this._root = null;
        this._userAt = 0;          // last wheel / pointer / key input in the chat
        this._onUser = () => { this._userAt = Date.now(); };
        this._frame = 0;
    }

    _app() {
        try { return qx.core.Init.getApplication(); } catch { return null; }
    }

    _chat() {
        const app = this._app();
        try { return app ? app.getChat() : null; } catch { return null; }
    }

    _widget() {
        const chat = this._chat();
        try { return chat && typeof chat.getChatWidget === 'function' ? chat.getChatWidget() : null; } catch { return null; }
    }

    _tabView() {
        const w = this._widget();
        if (!w || typeof w._getChildren !== 'function') return null;
        return w._getChildren().find(c => typeof c.getSelection === 'function' && typeof c.getChildren === 'function') || null;
    }

    _pages() {
        const tv = this._tabView();
        return tv ? tv.getChildren().filter(p => p.meta && typeof p.meta.flags === 'number') : [];
    }

    _selected() {
        const tv = this._tabView();
        const sel = tv && tv.getSelection()[0];
        return sel && sel.meta ? sel : null;
    }

    _isOpen() {
        const chat = this._chat();
        try { return !!chat && chat.isVisible(); } catch { return false; }
    }

    _following() {
        return this.config.get('chatmanager.autoScroll', true) !== false;
    }

    _badgesOn() {
        return this.config.get('chatmanager.unreadBadge', true) !== false;
    }

    _listen(obj, event, fn) {
        if (obj && typeof obj.addListener === 'function') this._listeners.push([obj, obj.addListener(event, fn, this)]);
    }

    /** Hook the game's chat events; false when the chat widget is not there yet. */
    start(root) {
        const w = this._widget();
        if (!w || typeof w.addListener !== 'function' || this.running) return this.running;
        this.running = true;
        this._root = root;
        if (root && typeof root.addEventListener === 'function') {
            for (const ev of ['wheel', 'pointerdown', 'keydown']) root.addEventListener(ev, this._onUser, true);
        }
        this._listen(w, 'chatmessagein', (e) => this.onIncoming(e.getData()));
        this._listen(w, 'chatmessageout', (e) => this.onShown(e.getData()));
        const chat = this._chat();
        this._listen(chat, 'changeVisibility', () => { const s = this._selected(); if (s && this._isOpen()) this.onShown(s.meta.flags); else this.refresh(); });
        this._listen(chat, 'resize', () => this._placeSoon());
        for (const page of this._pages()) {
            try {
                const sb = page.ui.scrcontent.getChildControl('scrollbar-y');
                this._listen(sb, 'scroll', () => this.onScroll(page));
            } catch { /* tab without a scroll area */ }
        }
        if (!this._following()) this._pause(true);
        this.refresh();
        return true;
    }

    stop() {
        for (const [obj, id] of this._listeners) {
            try { obj.removeListenerById(id); } catch { /* disposed */ }
        }
        this._listeners = [];
        if (this._root && typeof this._root.removeEventListener === 'function') {
            for (const ev of ['wheel', 'pointerdown', 'keydown']) this._root.removeEventListener(ev, this._onUser, true);
        }
        for (const el of [...this._badges.values(), this._scrollBtn, this._bar]) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        this._badges.clear();
        this._scrollBtn = this._bar = this._root = this._chatButton = null;
        // nothing stays paused once the plugin is off
        for (const page of this._pages()) if (page.autoscroll === false) page.autoscroll = true;
        if (this._frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._frame);
        this._frame = 0;
        this.running = false;
        this.unread = {};
        this.newCount = 0;
    }

    /** A message came in on channel `flag`. */
    onIncoming(flag) {
        if (!this.running) return;
        const f = Number(flag) || 0;
        const sel = this._selected();
        const shown = this._isOpen() && sel && ((sel.meta.flags & CHANNEL.all) || (sel.meta.flags & f));
        if (!shown) this.unread[f] = (this.unread[f] || 0) + 1;
        else if (sel.autoscroll === false) this.newCount++;
        this.refresh();
    }

    /** A tab was shown (switch or chat opened): its channels are read. */
    onShown(flags) {
        if (!this.running) return;
        markRead(this.unread, Number(flags) || 0);
        this.newCount = 0;
        if (!this._following()) this._pause(true);
        this.refresh();
    }

    /** The shown tab's scrollbar moved (after the game's own listener set page.autoscroll). */
    onScroll(page) {
        if (!this.running || page !== this._selected()) return;
        if (page.autoscroll === true && !this._following()) {
            if (Date.now() - this._userAt > USER_MS) {
                page.autoscroll = false;   // the game's own scroll-to-end (tab shown, chat opened): stay paused
                return;
            }
            this.config.set('chatmanager.autoScroll', true);   // you scrolled to the bottom
        }
        if (page.autoscroll === true) this.newCount = 0;
        this.refresh();
    }

    /**
     * Stop following in the shown tab (again after the game's own scrollToEnd(true) of a tab
     * switch). toEnd: a tab that is shown opens at its newest message first (VERIFIED LIVE:
     * without it a reopened, paused chat sat at its oldest line), then stays there.
     */
    _pause(toEnd = false) {
        const pause = () => {
            const p = this._selected();
            if (!p) return;
            if (toEnd) {
                try { p.ui.scrcontent.scrollToY(p.ui.scrcontent.getChildControl('scrollbar-y').getMaximum()); } catch { /* no scroll area */ }
            }
            p.autoscroll = false;
            this.refresh();
        };
        pause();
        setTimeout(pause, 0);
        if (toEnd) setTimeout(pause, 300);   // once the layout of a just-shown tab is done
    }

    /** ⬇ button / `chatmanager.autoScroll`: true = follow (and jump to the end), false = stay. */
    setFollow(on) {
        this.config.set('chatmanager.autoScroll', !!on);
        if (!this.running) return;
        if (on) {
            this.newCount = 0;
            const w = this._widget();
            try { w.scrollToEnd(true); } catch { const p = this._selected(); if (p) p.autoscroll = true; }
        } else {
            this._pause();
        }
        this.refresh();
    }

    toggleFollow() {
        const sel = this._selected();
        const paused = sel ? sel.autoscroll === false : !this._following();
        this.setFollow(paused);
    }

    /** Draw badges and the scroll button / bar from the current state (only real changes touch the DOM). */
    refresh() {
        if (!this.running) return;
        try {
            this._renderBadges();
            this._placeScrollUi();
        } catch (err) {
            console.warn('[ST] ChatManager: chat activity failed', err && err.message);
        }
    }

    _placeSoon() {
        if (this._frame || typeof requestAnimationFrame !== 'function') return;
        this._frame = requestAnimationFrame(() => { this._frame = 0; this.refresh(); });
    }

    _findChatButton() {
        if (this._chatButton) return this._chatButton;
        const app = this._app();
        let found = null;
        const walk = (w, depth) => {
            if (!w || found || depth > 4) return;
            if (w.classname === 'webfrontend.gui.chat.ChatButtonWidget') { found = w; return; }
            for (const k of (typeof w._getChildren === 'function' ? w._getChildren() : [])) walk(k, depth + 1);
        };
        try { walk(app.getRoot(), 0); } catch { /* no root */ }
        this._chatButton = found;
        return found;
    }

    _renderBadges() {
        const on = this._badgesOn();
        const open = this._isOpen();
        const sel = this._selected();
        let total = 0;
        for (const n of Object.values(this.unread)) total += n;
        for (const page of this._pages()) {
            const n = on && open && page !== sel ? tabUnread(this.unread, page.meta.flags) : 0;
            try { this._badge(page.getButton(), n); } catch { /* no button */ }
        }
        this._badge(this._findChatButton(), on && !open ? total : 0);
    }

    _badge(widget, n) {
        if (!widget) return;
        let b = this._badges.get(widget);
        if (n <= 0) {
            if (b) setStyle(b, 'display', 'none');
            return;
        }
        const dom = widget.getContentElement && widget.getContentElement().getDomElement();
        if (!dom) return;
        if (!b) {
            b = dom.ownerDocument.createElement('div');
            b.setAttribute(MARK, 'badge');
            b.style.cssText = 'position:absolute;top:1px;right:1px;min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;'
                + 'border-radius:8px;background:#e53935;color:#fff;font:bold 10px/15px Arial,sans-serif;text-align:center;'
                + 'z-index:30;pointer-events:none;';
            this._badges.set(widget, b);
        }
        if (b.parentNode !== dom) dom.appendChild(b);
        setText(b, badgeText(n));
        setStyle(b, 'display', 'block');
    }

    _makeScrollUi(doc) {
        const btn = doc.createElement('div');
        btn.setAttribute(MARK, 'scroll');
        btn.textContent = '⬇';
        btn.style.cssText = 'position:absolute;width:18px;height:18px;border-radius:9px;font:bold 12px/18px Arial,sans-serif;'
            + 'text-align:center;cursor:pointer;z-index:1001;user-select:none;';
        const bar = doc.createElement('div');
        bar.setAttribute(MARK, 'scroll');
        bar.style.cssText = 'position:absolute;height:18px;padding:0 8px;border-radius:9px;background:#f57c00;color:#fff;'
            + 'font:bold 11px/18px Arial,sans-serif;cursor:pointer;z-index:1001;user-select:none;white-space:nowrap;';
        for (const el of [btn, bar]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFollow(); });
        bar.addEventListener('click', (e) => { e.stopPropagation(); this.setFollow(true); });
        this._scrollBtn = btn;
        this._bar = bar;
    }

    _placeScrollUi() {
        const root = this._root;
        const sel = this._selected();
        let scEl = null;
        try { scEl = sel.ui.scrcontent.getContentElement().getDomElement(); } catch { /* no scroll area */ }
        if (!root || !scEl || !this._isOpen()) {
            if (this._scrollBtn) setStyle(this._scrollBtn, 'display', 'none');
            if (this._bar) setStyle(this._bar, 'display', 'none');
            return;
        }
        if (!this._scrollBtn) this._makeScrollUi(root.ownerDocument);
        for (const el of [this._scrollBtn, this._bar]) if (el.parentNode !== root) root.appendChild(el);
        const rr = root.getBoundingClientRect();
        const sr = scEl.getBoundingClientRect();
        let sbw = 15;
        try { const b = sel.ui.scrcontent.getChildControl('scrollbar-y').getBounds(); if (b) sbw = b.width; } catch { /* default */ }
        const bottom = `${Math.round(Math.max(0, rr.bottom - sr.bottom) + 4)}px`;
        // the scroll area can run past the visible chat edge (docked chat): stay inside what is visible
        const right = `${Math.round(Math.max(0, rr.right - (sr.right - sbw)) + 4)}px`;
        const paused = sel.autoscroll === false;
        const btn = this._scrollBtn;
        setStyle(btn, 'display', 'block');
        setStyle(btn, 'bottom', bottom);
        setStyle(btn, 'right', right);
        setStyle(btn, 'background', paused ? '#f57c00' : 'rgba(0,0,0,0.45)');
        setStyle(btn, 'color', paused ? '#fff' : 'rgba(255,255,255,0.75)');
        const tip = paused ? t('chatScrollResume') : t('chatScrollPause');
        if (btn.title !== tip) btn.title = tip;
        const bar = this._bar;
        if (paused && this.newCount > 0) {
            setText(bar, t('chatNewMessages', { n: this.newCount }));
            setStyle(bar, 'display', 'block');
            setStyle(bar, 'bottom', bottom);
            setStyle(bar, 'left', `${Math.round(Math.max(0, sr.left - rr.left) + 6)}px`);
        } else {
            setStyle(bar, 'display', 'none');
        }
    }
}
