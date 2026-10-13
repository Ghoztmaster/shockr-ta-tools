/**
 * movable-menu.js — drag game windows and menu overlays to another spot
 * (replaces SoO MovableMenuOverlay 1.0.9).
 *
 * Two kinds of game panels:
 *   1. qooxdoo windows (qx.ui.window.Window, class webfrontend.*): qx moves
 *      them natively by the caption bar (MMovable). Shockr makes them movable
 *      when the game switched that off, and remembers the position per window
 *      class: reopened = back at the remembered spot.
 *   2. Menu overlays (webfrontend.gui.MenuOverlayWidget - alliance, mail,
 *      forum, …): always centred by the game, not movable. These are what the
 *      original made movable. Drag = mouse down on the header strip (top
 *      HEADER_PX), move > DRAG_THRESHOLD_PX; the overlay is shifted with a CSS
 *      transform, which the qx layout never touches. Offset remembered per
 *      overlay class.
 *
 * Not copied from the original: it regex-matched the obfuscated
 * switchMenuOverlay source and replaced that app method plus
 * MenuOverlayWidget.prototype.centerPosition. Shockr patches no game code:
 * a 1 s scan of the root/desktop children finds new windows/overlays and
 * adds listeners - all removed again on stop.
 *
 * Never touched: the world map, tooltips (qx PopUp, not a window), the main
 * menu bar, and windows of other scripts (class not webfrontend.*, e.g. TABS,
 * MehrStrom - they keep their own position logic).
 * Positions live in Shockr's config (localStorage), key MovableMenu.positions.
 */
import { t } from '../lib/i18n.js';

const SCAN_MS = 1000;
const HEADER_PX = 40;              // overlay drag strip height
const DRAG_THRESHOLD_PX = 4;       // below this a mouse down/up is a click
const MIN_VISIBLE_PX = 80;         // keep at least this much of a panel on screen
const MAX_ENTRIES = 60;
const STORE_KEY = 'MovableMenu.positions';

/** Keep a panel of width w at (left, top) reachable on a vw × vh screen. */
export function clampPosition(left, top, w, vw, vh) {
    const minLeft = -Math.max(0, w - MIN_VISIBLE_PX);
    const maxLeft = Math.max(0, vw - MIN_VISIBLE_PX);
    return {
        left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
        top: Math.round(Math.min(Math.max(top, 0), Math.max(0, vh - 30))),
    };
}

/** Storage id of a widget: its class, plus the caption for the generic overlay window. */
export function widgetId(w) {
    const cls = String((w && w.classname) || '');
    if (cls === 'webfrontend.gui.OverlayWindow' && typeof w.getCaption === 'function') {
        const cap = String(w.getCaption() || '').replace(/[\d()]/g, '').trim();
        if (cap) return `${cls}:${cap}`;
    }
    return cls;
}

function domOf(widget) {
    try {
        const el = typeof widget.getContainerElement === 'function'
            ? widget.getContainerElement() : widget.getContentElement();
        return (el && el.getDomElement()) || null;
    } catch {
        return null;
    }
}

function windowClass() {
    try { return qx.ui.window.Window; } catch { return null; }
}

function overlayClass() {
    try { return webfrontend.gui.MenuOverlayWidget; } catch { return null; }
}

export class MovableMenu {
    /** Short description for `/st help`. */
    get description() { return t('descMovableMenu'); }

    constructor(config) {
        this.name = 'MovableMenu';
        this.config = config;
        this.running = false;
        this._timer = null;
        this._hooked = new Set();       // widgets with our listeners
        this._qxListeners = [];         // {widget, id}
        this._domListeners = [];        // {el, type, fn, capture}
        this._madeMovable = [];         // windows we switched to movable
        this._shifted = new Set();      // overlay DOM elements with our transform
        this._attached = new Set();     // DOM elements with our mousedown listener
        this._warned = false;
    }

    async start() {
        this.running = true;
        this._timer = setInterval(() => this.scan(), SCAN_MS);
        this.scan();
        console.log('[ST] MovableMenu: started');
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        for (const { widget, id } of this._qxListeners) {
            try { widget.removeListenerById(id); } catch { /* disposed */ }
        }
        for (const { el, type, fn, capture } of this._domListeners) el.removeEventListener(type, fn, capture);
        for (const win of this._madeMovable) {
            try { win.setMovable(false); } catch { /* disposed */ }
        }
        for (const el of this._shifted) el.style.transform = '';
        this._qxListeners = [];
        this._domListeners = [];
        this._madeMovable = [];
        this._shifted.clear();
        this._attached.clear();
        this._hooked.clear();
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('movableMenuStatus', { n: Object.keys(this._positions()).length });
    }

    // ─── Storage ─────────────────────────────────────────────────────

    _positions() {
        const p = this.config.get(STORE_KEY, {});
        return p && typeof p === 'object' ? p : {};
    }

    _save(id, pos) {
        const all = this._positions();
        delete all[id];
        all[id] = pos;                                // newest last
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
        this.config.set(STORE_KEY, all);
    }

    // ─── Scan ────────────────────────────────────────────────────────

    /** Root + desktop children that are game windows or menu overlays. */
    candidates() {
        const out = [];
        let app;
        try { app = qx.core.Init.getApplication(); } catch { return out; }
        for (const getter of ['getRoot', 'getDesktop']) {
            try {
                const parent = typeof app[getter] === 'function' ? app[getter]() : null;
                if (parent) for (const c of parent.getChildren()) if (!out.includes(c)) out.push(c);
            } catch { /* not there */ }
        }
        return out;
    }

    scan() {
        if (!this.running) return;
        try {
            const Win = windowClass();
            const Overlay = overlayClass();
            for (const w of this.candidates()) {
                if (this._hooked.has(w)) continue;
                if (Overlay && w instanceof Overlay) this._hookOverlay(w);
                else if (Win && w instanceof Win && widgetId(w).startsWith('webfrontend.')) this._hookWindow(w);
            }
        } catch (e) {
            if (!this._warned) {
                this._warned = true;
                console.warn('[ST] MovableMenu: scan failed', e && e.message);
            }
        }
    }

    _listen(widget, type, fn) {
        const id = widget.addListener(type, fn, this);
        this._qxListeners.push({ widget, id });
    }

    _domListen(el, type, fn, capture = false) {
        el.addEventListener(type, fn, capture);
        this._domListeners.push({ el, type, fn, capture });
    }

    _viewport() {
        return { vw: window.innerWidth || 1024, vh: window.innerHeight || 768 };
    }

    // ─── qx windows ──────────────────────────────────────────────────

    _hookWindow(win) {
        this._hooked.add(win);
        try {
            if (typeof win.getMovable === 'function' && !win.getMovable()) {
                win.setMovable(true);
                this._madeMovable.push(win);
            }
        } catch { /* keep as is */ }
        this._listen(win, 'appear', () => {
            this._attachWindowDom(win);
            this._restoreWindow(win);
            setTimeout(() => this._restoreWindow(win), 0);   // after the game's own centring
        });
        if (win.isVisible && win.isVisible()) {
            this._attachWindowDom(win);
            this._restoreWindow(win);
        }
    }

    _attachWindowDom(win) {
        const el = domOf(win);
        if (!el || this._attached.has(el)) return;
        this._attached.add(el);
        this._domListen(el, 'mousedown', () => {
            const start = { ...(win.getLayoutProperties() || {}) };
            const up = () => {
                document.removeEventListener('mouseup', up, true);
                setTimeout(() => this._saveWindow(win, start), 0);   // after qx's own moveTo
            };
            document.addEventListener('mouseup', up, true);
        }, true);
    }

    _saveWindow(win, start) {
        if (!this.running) return;
        const p = win.getLayoutProperties() || {};
        if (typeof p.left !== 'number' || typeof p.top !== 'number') return;
        if (p.left === start.left && p.top === start.top) return;
        this._save(widgetId(win), { left: p.left, top: p.top });
    }

    _restoreWindow(win) {
        if (!this.running) return;
        const pos = this._positions()[widgetId(win)];
        if (!pos || typeof pos.left !== 'number') return;
        const b = (win.getBounds && win.getBounds()) || {};
        const { vw, vh } = this._viewport();
        const c = clampPosition(pos.left, pos.top, b.width || 0, vw, vh);
        const cur = win.getLayoutProperties() || {};
        if (cur.left !== c.left || cur.top !== c.top) win.moveTo(c.left, c.top);
    }

    // ─── Menu overlays ───────────────────────────────────────────────

    _hookOverlay(ov) {
        this._hooked.add(ov);
        this._listen(ov, 'appear', () => {
            this._attachOverlayDom(ov);
            this._restoreOverlay(ov);
        });
        if (ov.isVisible && ov.isVisible()) {
            this._attachOverlayDom(ov);
            this._restoreOverlay(ov);
        }
    }

    _offset(el) {
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
        return m ? { dx: Number(m[1]), dy: Number(m[2]) } : { dx: 0, dy: 0 };
    }

    /** Clamp a translate offset so the overlay stays reachable, then apply it. */
    _shift(el, dx, dy) {
        const cur = this._offset(el);
        const r = el.getBoundingClientRect();
        const baseLeft = r.left - cur.dx;
        const baseTop = r.top - cur.dy;
        const { vw, vh } = this._viewport();
        const c = clampPosition(baseLeft + dx, baseTop + dy, r.width, vw, vh);
        const off = { dx: c.left - Math.round(baseLeft), dy: c.top - Math.round(baseTop) };
        el.style.transform = off.dx || off.dy ? `translate(${off.dx}px, ${off.dy}px)` : '';
        this._shifted.add(el);
        return off;
    }

    _restoreOverlay(ov) {
        if (!this.running) return;
        const el = domOf(ov);
        const pos = this._positions()[widgetId(ov)];
        if (el && pos && typeof pos.dx === 'number') this._shift(el, pos.dx, pos.dy);
    }

    _attachOverlayDom(ov) {
        const el = domOf(ov);
        if (!el || this._attached.has(el)) return;
        this._attached.add(el);
        this._domListen(el, 'mousedown', (e) => {
            if (!this.running || e.button !== 0) return;
            const r = el.getBoundingClientRect();
            if (e.clientY - r.top > HEADER_PX) return;
            const start = { x: e.clientX, y: e.clientY, ...this._offset(el) };
            let dragging = false;
            let off = null;
            const move = (ev) => {
                const dx = ev.clientX - start.x;
                const dy = ev.clientY - start.y;
                if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
                if (!dragging) {
                    dragging = true;
                    document.body.style.userSelect = 'none';
                }
                off = this._shift(el, start.dx + dx, start.dy + dy);
            };
            const up = () => {
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseup', up, true);
                if (!dragging) return;
                document.body.style.userSelect = '';
                if (off) this._save(widgetId(ov), off);
                // the mouse up after a drag must not click the header button under it
                const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                document.addEventListener('click', swallow, true);
                setTimeout(() => document.removeEventListener('click', swallow, true), 0);
            };
            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
        }, true);
    }
}
