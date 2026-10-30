// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * spam-block.js — hide in-game mail from blocked players (client-side only).
 *
 * Purely local: nothing is sent to the server on the player's behalf, nothing
 * is deleted or marked read, and the blocked player notices nothing. The mail
 * stays on the server; turn the plugin off (or unblock) and it shows again.
 *
 * How (game API names only, no game code patched):
 *   1. The mail window loads its list with the server command IGMGetMsgHeader
 *      via ClientLib.Net.CommunicationManager.SendSimpleCommand(name, params,
 *      delegate, context). That method (plus obfuscated aliases, found by
 *      reference) is wrapped: the answer - an array of headers
 *      { i: mail id, f: sender name, fi: sender player id (-1 = system), s, r, d }
 *      - reaches the game's own delegate with the blocked senders filtered out.
 *      A sender whose every mail is blocked so drops out of the list.
 *   2. The message view is webfrontend.gui.mail.MailMessageDisplay (probe
 *      2026-10-30): its action buttons (objid btnback, btndelete, btnreport,
 *      btnforward, btnreplyall, btnreply, btn_close) share one Composite, and
 *      "Block sender" goes right after btndelete (addAfter). It copies the
 *      appearance, size, padding and font of btndelete: the appearance alone
 *      made it larger than the game's own buttons in the row.
 *      A 1 s scan of the visible top-level widgets finds the view: an opened
 *      mail that the game had cached sends no IGMGetMsg, so the traffic alone
 *      cannot be the trigger (IGMGetMsg still triggers an immediate scan).
 *   3. The sender is read when the button is clicked: the view keeps the open
 *      mail in an obfuscated own field (__dS in the probed build, renamed per
 *      build) = { Id, Type, Subject, From, To, Date, Read, FromId, ToIds, ... }.
 *      Found by shape (an object with FromId and From), never by field name.
 *      Type 0 = player mail. Fallback: the header of the last IGMGetMsg.
 *   4. Blocking replays the game's last IGMGetMsgHeader call (a read, the same
 *      request the window sends itself), so the list redraws without the
 *      blocked mails, and presses the view's own btnback to leave the message.
 *
 * Not adjusted: the unread counter (the server counts blocked mail too) and
 * the page count of a long inbox (a page shows fewer rows). A list the game
 * loaded before Shockr started is filtered from its next reload on.
 *
 * Block list: config `SpamBlock.blocked` = [{ id, name }] (localStorage, mirrored
 * to GM storage). An entry typed by name in the panel has id null and matches
 * the sender name (case-insensitive, not checked against the game); the first
 * header from that name fills in its id. Panel (Shockr toolbar or /st blocklist,
 * look of Marker Nav): name field + Block, per player Unblock.
 * /st blocklist remove <name> unblocks from the chat.
 *
 * Re-check the widget side with docs/probes/spam-block-probe.js when the game
 * client changes (VIEW_CLASS / objids below).
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';

const STORE_KEY = 'SpamBlock.blocked';
const HEADER_CMD = 'IGMGetMsgHeader';
const OPEN_CMD = 'IGMGetMsg';
const VIEW_CLASS = 'webfrontend.gui.mail.MailMessageDisplay';
const ANCHOR_OBJID = 'btndelete';
const BACK_OBJID = 'btnback';
const BUTTON_OBJID = 'stblocksender';
const SCAN_MS = 1000;
const MAX_DEPTH = 40;
/** How deep the sender search looks into the view's own properties. */
const HEADER_DEPTH = 2;
/** qx properties copied from btndelete, so "Block sender" matches the row. */
const LOOK_PROPS = ['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight',
    'PaddingTop', 'PaddingRight', 'PaddingBottom', 'PaddingLeft', 'Font', 'TextColor',
    'AllowGrowX', 'AllowGrowY', 'AllowShrinkX', 'AllowShrinkY', 'Center', 'Gap'];

const PANEL_ID = 'st-spamblock-panel';
const TOOLBAR_ID = 'spamblock';
const PANEL_WIDTH = 300;
const DEFAULT_POSITION = { x: 150, y: 110 };
const BTN = 'padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;color:#fff;';
const BTN_PRIMARY = BTN + 'background:#2a5a8a;border:1px solid #3a7ab8;';
const BTN_GREY = BTN + 'background:#444;border:1px solid #666;';
const FIELD = 'flex:1;min-width:0;box-sizing:border-box;padding:4px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;font-size:12px;';

/** A server answer that is a mail header list: non-empty array of { i, fi } objects. */
export function isHeaderList(x) {
    return Array.isArray(x) && x.length > 0
        && x.every(h => h && typeof h === 'object' && 'i' in h && 'fi' in h);
}

/** Headers without the blocked senders (Set of player ids, Set of lower-case names). */
export function filterHeaders(headers, blockedIds, blockedNames = new Set()) {
    if (!blockedIds.size && !blockedNames.size) return headers;
    return headers.filter(h => !blockedIds.has(Number(h.fi)) && !blockedNames.has(String(h.f || '').toLowerCase()));
}

/** Stored entries, cleaned: { id: number|null, name: string }; an entry needs an id or a name. */
export function normalizeList(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(e => e && typeof e === 'object').map(e => ({
        id: e.id !== null && e.id !== undefined && e.id !== '' && Number.isFinite(Number(e.id)) ? Number(e.id) : null,
        name: String(e.name || '').trim(),
    })).filter(e => e.id !== null || e.name);
}

/** Block-list entry by name (case-insensitive) or player id. */
export function findEntry(list, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    return list.find(e => String(e.name).toLowerCase() === q || (e.id !== null && String(e.id) === q)) || null;
}

/** Mail type of a player mail (MailMessageDisplay data, `Type`). */
const PLAYER_MAIL = 0;

/** A real player sent this header (player mail, not a system mail, not yourself). */
export function isBlockable(header, ownId) {
    if (!header || (header.type !== undefined && header.type !== PLAYER_MAIL)) return false;
    const id = Number(header.fi);
    return Number.isFinite(id) && id > 0 && id !== ownId;
}

/** The view's mail data: an object with FromId and From (whatever the obfuscated field is called). */
function isMailData(v) {
    return !!v && typeof v === 'object' && 'FromId' in v && 'From' in v;
}

/**
 * Sender of the mail a view holds, as { i, fi, f, type }: the first mail-data
 * object among obj's own properties (depth-limited; qx widgets and DOM skipped).
 */
export function findHeaderIn(obj, depth = HEADER_DEPTH, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
    seen.add(obj);
    let keys = [];
    try { keys = Object.keys(obj); } catch { return null; }
    for (const k of keys) {
        let v;
        try { v = obj[k]; } catch { continue; }
        if (isMailData(v)) {
            const type = v.Type === undefined || v.Type === null ? undefined : Number(v.Type);
            return { i: Number(v.Id), fi: Number(v.FromId), f: String(v.From || ''), type };
        }
    }
    if (depth <= 0) return null;
    for (const k of keys) {
        let v;
        try { v = obj[k]; } catch { continue; }
        if (!v || typeof v !== 'object' || v.classname || v.nodeType) continue;   // no qx widgets / DOM nodes
        const h = findHeaderIn(v, depth - 1, seen);
        if (h) return h;
    }
    return null;
}

/**
 * Wrap a CommandResult delegate: `map` rewrites header-list arguments,
 * `after` runs once the game's delegate is done. Not a function -> unchanged.
 */
export function wrapDelegate(delegate, { map, after } = {}) {
    if (typeof delegate !== 'function') return delegate;
    const wrapped = function (...args) {
        const out = map ? args.map(a => (isHeaderList(a) ? map(a) : a)) : args;
        const result = delegate.apply(this, out);
        if (after) after();
        return result;
    };
    return Object.assign(wrapped, delegate);
}

/** Size, padding and font of the game's button onto ours (only values it actually has). */
export function copyLook(from, to) {
    try { to.setAppearance(from.getAppearance()); } catch { /* default button look */ }
    for (const p of LOOK_PROPS) {
        try {
            if (typeof from[`get${p}`] !== 'function' || typeof to[`set${p}`] !== 'function') continue;
            const v = from[`get${p}`]();
            if (v !== null && v !== undefined) to[`set${p}`](v);
        } catch { /* property not on this widget */ }
    }
    try {
        const lp = from.getLayoutProperties();
        if (lp && Object.keys(lp).length) to.setLayoutProperties({ ...lp });
    } catch { /* no layout properties */ }
}

/** Panel rows: name, id (or "by name") and an Unblock button carrying the list index. */
export function renderBlockList(list) {
    if (!list.length) {
        return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('spamBlockPanelEmpty'))}</div>`;
    }
    const td = 'padding:4px;vertical-align:middle;';
    let html = '<table style="width:100%;border-collapse:collapse;">';
    list.forEach((e, i) => {
        const id = e.id !== null ? String(e.id) : t('spamBlockByName');
        html += '<tr style="border-bottom:1px solid #2a2a2a;">'
            + `<td style="${td}color:#e0e0e0;">${escapeHtml(e.name || '?')}</td>`
            + `<td style="${td}color:#888;white-space:nowrap;">${escapeHtml(id)}</td>`
            + `<td style="${td}text-align:right;"><button data-unblock="${i}" style="${BTN_GREY}">${escapeHtml(t('spamBlockUnblock'))}</button></td></tr>`;
    });
    return html + '</table>';
}

function childrenOf(w) {
    try {
        return (typeof w._getChildren === 'function' ? w._getChildren()
            : (typeof w.getChildren === 'function' ? w.getChildren() : [])) || [];
    } catch {
        return [];   // disposed
    }
}

function isShown(w) {
    try { return typeof w.isSeeable === 'function' ? w.isSeeable() : w.isVisible(); } catch { return false; }
}

/** Visible descendants for which test() holds; hidden subtrees are not entered. */
function findShown(root, test, out = [], depth = 0) {
    if (!root || depth > MAX_DEPTH || !isShown(root)) return out;
    if (test(root)) out.push(root);
    for (const k of childrenOf(root)) findShown(k, test, out, depth + 1);
    return out;
}

/** Button in `view` with this objid (any depth). */
function buttonIn(view, objid) {
    const found = [];
    const walk = (w, d) => {
        if (!w || d > MAX_DEPTH || found.length) return;
        if (w.objid === objid) found.push(w);
        for (const k of childrenOf(w)) walk(k, d + 1);
    };
    walk(view, 0);
    return found[0] || null;
}

function buttonClass() {
    try { return qx.ui.form.Button; } catch { return null; }
}

export class SpamBlock {
    /** Short description for `/st help`. */
    get description() { return t('descSpamBlock'); }

    constructor(config, toolbar, cli) {
        this.name = 'SpamBlock';
        this.defaultEnabled = true;
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this._patches = [];          // { proto, key, original }
        this._send = null;           // the original SendSimpleCommand
        this._headers = new Map();   // mail id -> { i, fi, f }
        this._openId = null;         // mail id of the last IGMGetMsg
        this._lastList = null;       // { self, args } of the last header request, for a replay
        this._buttons = new Map();   // our button -> its MailMessageDisplay
        this._timer = null;
        this._warned = false;
        this._panel = null;
        this._title = null;
        this._input = null;
        this._list = null;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    async start() {
        this.running = true;
        this._patchSend();
        if (this.cli) this.cli.register('blocklist', (args) => this.command(args || []));
        if (this.toolbar) {
            this.toolbar.register({
                id: TOOLBAR_ID,
                icon: ICONS.block,
                label: () => t('toolbarSpamBlock'),
                onClick: () => this.toggle(),
            });
        }
        this._timer = setInterval(() => this.scan(), SCAN_MS);
        this.scan();
        console.log(`[ST] SpamBlock: started (${this.blocked().length} blocked, send patched: ${this._patches.length})`);
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        for (const btn of this._buttons.keys()) {
            try { btn.destroy(); } catch { /* disposed with its window */ }
        }
        this._buttons.clear();
        for (const p of this._patches) p.proto[p.key] = p.original;
        this._patches = [];
        if (this.cli) this.cli.unregister('blocklist');
        if (this.toolbar) this.toolbar.unregister(TOOLBAR_ID);
        this.close();
        if (this._panel) this._panel.remove();
        this._panel = null;
        this._refreshList();            // blocked mail shows again (the filter checks `running`)
        this._send = null;
        console.log('[ST] SpamBlock: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('spamBlockStatus', { n: this.blocked().length });
    }

    // ─── Block list ──────────────────────────────────────────────────

    blocked() {
        return normalizeList(this.config.get(STORE_KEY, []));
    }

    blockedIds() {
        return new Set(this.running ? this.blocked().filter(e => e.id !== null).map(e => e.id) : []);
    }

    blockedNames() {
        return new Set(this.running ? this.blocked().map(e => e.name.toLowerCase()).filter(Boolean) : []);
    }

    /**
     * Add a sender; id null = by name only (the panel field, not checked against the game).
     * An entry already there by name gets the id when it is now known.
     * @returns {boolean} newly blocked
     */
    block(id, name) {
        const pid = id === null || id === undefined ? null : Number(id);
        const label = String(name || '').trim();
        if (pid === null && !label) return false;
        const list = this.blocked();
        const same = list.find(e => (pid !== null && e.id === pid) || (label && e.name.toLowerCase() === label.toLowerCase()));
        if (same) {
            if (same.id === null && pid !== null) {
                same.id = pid;
                this.config.set(STORE_KEY, list);
                this.renderPanel();
            }
            chatMessage(`[ST] ${t('spamBlockAlready', { name: escapeHtml(label || same.name) })}`);
            return false;
        }
        list.push({ id: pid, name: label });
        this.config.set(STORE_KEY, list);
        chatMessage(`[ST] ${t('spamBlockBlocked', { name: escapeHtml(label || String(pid)) })}`);
        this._refreshList();
        this.renderPanel();
        return true;
    }

    /** Remove by name or id; @returns {boolean} found */
    unblock(query) {
        const entry = findEntry(this.blocked(), query);
        if (!entry) {
            chatMessage(`[ST] ${t('spamBlockNotFound', { name: escapeHtml(query) })}`);
            return false;
        }
        this._removeEntry(entry);
        return true;
    }

    /** Remove one stored entry, confirm, redraw the mail list and the panel. */
    _removeEntry(entry) {
        this.config.set(STORE_KEY, this.blocked().filter(e => !(e.id === entry.id && e.name === entry.name)));
        chatMessage(`[ST] ${t('spamBlockUnblocked', { name: escapeHtml(entry.name || String(entry.id)) })}`);
        this._refreshList();
        this.renderPanel();
    }

    /** /st blocklist (panel) | /st blocklist remove <name> */
    command(args) {
        const [action, ...rest] = args;
        if (!action) {
            this.toggle();
            return;
        }
        if (action.toLowerCase() === 'remove' && rest.length) {
            this.unblock(rest.join(' '));
            return;
        }
        chatMessage(`[ST] ${escapeHtml(t('spamBlockUsage'))}`);
    }

    // ─── Server traffic ──────────────────────────────────────────────

    /** Wrap SendSimpleCommand and every prototype key pointing at the same function. */
    _patchSend() {
        let proto;
        try { proto = ClientLib.Net.CommunicationManager.prototype; } catch { return; }
        const original = proto && proto.SendSimpleCommand;
        if (typeof original !== 'function') return;
        this._send = original;
        const plugin = this;
        const wrapper = function (name, params, delegate, ...rest) {
            return original.call(this, name, params, plugin._onSend(this, name, params, delegate, rest), ...rest);
        };
        for (const key of Object.getOwnPropertyNames(proto)) {
            const d = Object.getOwnPropertyDescriptor(proto, key);
            if (!d || d.value !== original) continue;   // value only: never call an accessor
            this._patches.push({ proto, key, original });
            proto[key] = wrapper;
        }
    }

    /** The delegate the game's command goes out with (wrapped for the mail commands). */
    _onSend(self, name, params, delegate, rest) {
        if (name === HEADER_CMD) {
            const wrapped = wrapDelegate(delegate, { map: (headers) => this._receiveHeaders(headers) });
            this._lastList = { self, args: [name, params, wrapped, ...rest] };
            return wrapped;
        }
        if (name === OPEN_CMD && params && params.mailId !== undefined) {
            this._openId = Number(params.mailId);
            return wrapDelegate(delegate, { after: () => setTimeout(() => this.scan(), 0) });
        }
        return delegate;
    }

    /** Remember every sender (fallback for the button), fill in ids of name entries, hand the game the unblocked ones. */
    _receiveHeaders(headers) {
        for (const h of headers) this._headers.set(Number(h.i), { i: Number(h.i), fi: Number(h.fi), f: String(h.f || '') });
        if (this.running) this._learnIds(headers);
        return filterHeaders(headers, this.blockedIds(), this.blockedNames());
    }

    /** A name-only entry takes the player id of the first mail from that name. */
    _learnIds(headers) {
        const list = this.blocked();
        let changed = false;
        for (const e of list) {
            if (e.id !== null) continue;
            const h = headers.find(x => String(x.f || '').toLowerCase() === e.name.toLowerCase() && Number(x.fi) > 0);
            if (!h) continue;
            e.id = Number(h.fi);
            changed = true;
        }
        if (!changed) return;
        this.config.set(STORE_KEY, list);
        this.renderPanel();
    }

    /** Ask the server for the same header page again; the game redraws its list. */
    _refreshList() {
        const last = this._lastList;
        if (!last || !this._send) return;
        try {
            this._send.apply(last.self, last.args);
        } catch (err) {
            console.warn('[ST] SpamBlock: list refresh failed', err);
        }
    }

    // ─── Message view ────────────────────────────────────────────────

    /** Find visible message views; add or update their "Block sender" button. */
    scan() {
        if (!this.running) return;
        try {
            for (const view of this._messageViews()) this._injectButton(view);
        } catch (e) {
            if (!this._warned) {
                this._warned = true;
                console.warn('[ST] SpamBlock: scan failed', e && e.message);
            }
        }
    }

    /** Visible MailMessageDisplay widgets under the root and desktop children (hidden overlays not entered). */
    _messageViews() {
        let app;
        try { app = qx.core.Init.getApplication(); } catch { return []; }
        const views = [];
        for (const getter of ['getRoot', 'getDesktop']) {
            let parent = null;
            try { parent = typeof app[getter] === 'function' ? app[getter]() : null; } catch { /* none */ }
            for (const c of parent ? childrenOf(parent) : []) {
                for (const v of findShown(c, w => w.classname === VIEW_CLASS)) if (!views.includes(v)) views.push(v);
            }
        }
        return views;
    }

    /** Sender of the mail the view shows: its own mail data, else the last IGMGetMsg. */
    senderOf(view) {
        return findHeaderIn(view) || this._headers.get(this._openId) || null;
    }

    _injectButton(view) {
        const Button = buttonClass();
        let btn = buttonIn(view, BUTTON_OBJID);
        if (!btn) {
            const anchor = buttonIn(view, ANCHOR_OBJID);
            const parent = anchor && anchor.getLayoutParent();
            if (!Button || !parent) return;
            btn = new Button(t('spamBlockButton'));
            btn.objid = BUTTON_OBJID;
            copyLook(anchor, btn);
            btn.addListener('execute', () => this._onBlockClick(view));
            if (typeof parent.addAfter === 'function') parent.addAfter(btn, anchor);
            else parent.add(btn);
            this._buttons.set(btn, view);
        }
        const header = this.senderOf(view);
        const ok = isBlockable(header, this._ownId());
        btn.setEnabled(ok);
        btn.setToolTipText(ok ? t('spamBlockTooltip', { name: header.f }) : t('spamBlockNoSender'));
    }

    /** Sender read now (the view may show another mail than at the last scan). */
    _onBlockClick(view) {
        const h = this.senderOf(view);
        if (!isBlockable(h, this._ownId())) {
            chatMessage(`[ST] ${t('spamBlockNoSender')}`);
            return;
        }
        if (!this.block(h.fi, h.f)) return;
        // leave the blocked message the game's own way (its back button: a view switch, nothing sent)
        const back = buttonIn(view, BACK_OBJID);
        try { if (back && isShown(back)) back.execute(); } catch { /* the list refresh still applies */ }
    }

    // ─── Panel ───────────────────────────────────────────────────────

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        this._ensurePanel();
        this._panel.style.display = 'block';
        document.addEventListener('keydown', this._onKeyDown);
        this.renderPanel();
    }

    close() {
        if (!this._panel) return;           // never opened: no listener, no panel
        document.removeEventListener('keydown', this._onKeyDown);
        this._panel.style.display = 'none';
    }

    /** Redraw the list (open panel only); called after every change. */
    renderPanel() {
        if (!this.isOpen()) return;
        const list = this.blocked();
        this._title.innerHTML = `<b style="color:#fff;">${escapeHtml(t('spamBlockTitle'))}</b> <span style="color:#aaa;">(${list.length})</span>`;
        this._list.innerHTML = renderBlockList(list);
        this._list.querySelectorAll('button[data-unblock]').forEach((b) => {
            b.addEventListener('click', () => {
                const entry = list[Number(b.dataset.unblock)];
                if (entry) this._removeEntry(entry);
            });
        });
    }

    /** The panel field: block by name as typed. */
    blockTyped() {
        const name = this._input ? this._input.value.trim() : '';
        if (!name) return;
        this.block(null, name);
        this._input.value = '';
        this.renderPanel();     // also when it was already on the list
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;

        const pos = clampPosition(loadPosition(this.config, 'SpamBlock', DEFAULT_POSITION),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        // Same look as the Marker Nav / Target Watch panels
        panel.style.cssText = `
            display: none;
            position: fixed;
            left: ${pos.x}px;
            top: ${pos.y}px;
            z-index: 10000;
            width: ${PANEL_WIDTH}px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
        // typing in the name field must not reach the game's hotkeys
        for (const type of ['keydown', 'keyup', 'keypress']) panel.addEventListener(type, (e) => e.stopPropagation());

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:8px 10px 6px;cursor:move;user-select:none;border-bottom:1px solid #333;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1;min-width:0;';
        const close = document.createElement('div');
        close.textContent = '✕';
        close.title = t('close');
        close.style.cssText = 'cursor:pointer;color:#999;font-size:14px;line-height:1;';
        close.addEventListener('mousedown', (e) => e.stopPropagation());   // not a drag
        close.addEventListener('click', () => this.close());
        close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
        close.addEventListener('mouseleave', () => { close.style.color = '#999'; });
        header.append(title, close);

        const form = document.createElement('div');
        form.style.cssText = 'display:flex;gap:6px;padding:8px 10px 4px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = t('spamBlockPlaceholder');
        input.style.cssText = FIELD;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.blockTyped();
            else if (e.key === 'Escape') this.close();   // the panel stops the event before the document listener
        });
        const add = document.createElement('button');
        add.textContent = t('spamBlockAdd');
        add.style.cssText = BTN_PRIMARY;
        add.addEventListener('click', () => this.blockTyped());
        form.append(input, add);

        const list = document.createElement('div');
        list.style.cssText = 'max-height:50vh;overflow-y:auto;padding:4px 10px 8px;';

        panel.append(header, form, list);
        document.body.appendChild(panel);
        makeDraggable(panel, header, { config: this.config, prefix: 'SpamBlock' });
        this._panel = panel;
        this._title = title;
        this._input = input;
        this._list = list;
    }

    _ownId() {
        try { return ClientLib.Data.MainData.GetInstance().get_Player().get_Id(); } catch { return null; }
    }
}
