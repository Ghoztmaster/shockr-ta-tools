// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * chat-helper.js — BB-code helper for chat, mail and forum text boxes
 * (replaces "C&C: Tiberium Alliances Chat Helper Enhanced Yiannis Mod" 3.2.3).
 *
 * Function by function from the original:
 *   - Auto-tagging (space in a chat line, Enter in a mail/forum textarea,
 *     Alt+1 in a textarea): coordinates "123:456" / "123.456[:x]" →
 *     [coords]123:456[/coords] (the game renders those as clickable links that
 *     jump to the spot), http(s) urls → [url]..[/url], shorthands [p]..[/p] →
 *     [player], [a]..[/a] → [alliance]. Same regexes as the original (Netquik's
 *     mod), so coordinates need 3-4 digits on both sides.
 *   - Alt shortcuts in any text box: Alt+2 url popup, Alt+p / Alt+3 [player],
 *     Alt+a / Alt+4 [alliance], Alt+b / i / u / s bold / italic / underline /
 *     strikethrough, Alt+0 removes all those tags. Word wrap: selection → tags
 *     around it; caret in a word → tags around the word; empty / after a space
 *     → empty tag pair. The browser's own Alt menus are suppressed for the
 *     letter shortcuts (config `ChatHelper.suppressAltKeys`, default true).
 *   - Contact list for whispering: typing "/whisper Bo" completes to a saved
 *     contact (rest selected); "/whisper <name> " offers to add an unknown
 *     name; /add <name>, /del <name>, /del all, /list or /contacts; /chelp
 *     shows the help. Triggered by space (the original) and also by Enter.
 *
 * Storage: localStorage 'chatHelper' = {saveObjVer, contacts} — the
 * original's own key and format, so an existing contact list carries over
 * (the old 'myContacts' string is migrated the same way the original did).
 *
 * Differences from the original, on purpose:
 *   - No document.onkeydown/onkeyup overwrite. The chat input is found the
 *     way lib/cli.js finds it (getChat().getChatWidget().getEditable() →
 *     content element → DOM element; the <input> inside it when that is a
 *     wrapper; else the first text box in the chat widget's DOM; or a line
 *     input inside the chat widget that gets focus) and gets its listeners ON THE ELEMENT,
 *     re-hooked every 2 s if the game re-creates it; it carries
 *     data-st-chathelper="chat" while hooked. Other text boxes (mail, forum)
 *     via window listeners in the capture phase. 5.22.0 listened on document
 *     (bubble phase) only and did nothing live; most likely the game's qooxdoo
 *     key handling sits in between (not verified). All removed by stop() — `/st plugin disable
 *     chat-helper` leaves the chat untouched.
 *   - Values are written through the qx widget's setValue() (as
 *     TA_Coords_Button writes the chat), so the widget and DOM stay in sync.
 *   - A line starting with /st is never touched: Shockr's own command handler
 *     (lib/cli.js) owns it (auto-tagging would turn `/st config set api.url
 *     https://…` into a [url] tag).
 *   - Help and contact list as local chat lines (i18n) instead of alert().
 *     Add/delete confirmations and the url popup stay browser dialogs.
 *   - "/del" and "/add" wait for a name (the original fired on the first space
 *     and reported "  is not in your contacts list"); a cancelled delete says
 *     nothing (the original then said "not in your contacts list").
 *   - "Add <name> to your contacts?" for a whisper is asked once per name per
 *     session (the original asked again on every space).
 *
 * Not in the original source and therefore not built: chat timestamps,
 * extra scrollback, colours. No game code is patched.
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';

const STORAGE_KEY = 'chatHelper';
const LEGACY_KEY = 'myContacts';
const SAVE_VERSION = '3.2.0';         // the original's saveObjVer, kept for compatibility
const KEYUP_DELAY_MS = 50;            // original onkeyupDelay
const WHISPER = '/whisper ';
const ST_PREFIX = '/st';
const VALID_CHAR = /[-\w.]/;
const LINE_TYPES = new Set(['text', 'search', '']);
const DIAG_AFTER = 5;                 // failed hook attempts (x 2 s) before the route is logged once

// ─── Pure helpers (exported for tests) ───────────────────────────────

/** The original's autoTag(): coords, urls, [p]/[a] shorthands. */
export function autoTag(text) {
    let s = String(text);
    // auto coords — Modded by NetquiK (args: match, g1..g5, offset, whole string)
    s = s.replace(/(\[coords\])*([0-9]{3,4})[:|.]([0-9]{3,4})([:|.]\w+)?(\[\/coords\])*/gi, (...a) => {
        const whole = a[7];
        if (whole.startsWith('http://cnc-map') || whole.startsWith('[url]')) return a[0];
        return '[coords]' + a[2] + ':' + a[3] + (a[4] !== undefined ? a[4].replace('.', ':') : '') + '[/coords]';
    });
    // auto url — Modded by NetquiK
    s = s.replace(/(\[url\])*(https?:\/\/)?([\da-z.-]+)(\.[a-z]{2,6})([/\w.\-=?&:+%#|~]*)*\/?(\[\/url\])*/gi, (...a) => {
        if (a[2] && a[3]) return '[url]' + a[2] + a[3] + a[4] + (a[5] === undefined ? '' : a[5]) + '[/url]';
        return a[0];
    });
    s = s.replace(/\[p\]([a-z0-9_\-\s]+)\[\/p\]/gi, '[player]$1[/player]');
    s = s.replace(/\[a\]([a-z0-9_\-\s]+)\[\/a\]/gi, '[alliance]$1[/alliance]');
    return s;
}

/** Alt+0: strip every tag the helper knows. */
export function clearTags(text) {
    return String(text).replace(/\[\/?(coords|url|player|alliance|b|i|u|s)\]/gi, '');
}

/** [start, end] of the word the caret sits right behind, or null. */
export function wordAt(text, pos) {
    if (!VALID_CHAR.test(text.charAt(pos - 1))) return null;
    let s = pos;
    let e = pos;
    while (s > 0 && VALID_CHAR.test(text.charAt(s - 1))) s--;
    while (e < text.length && VALID_CHAR.test(text.charAt(e))) e++;
    return [s, e];
}

/**
 * The original's tagWith() as a pure function: text + selection → new text
 * and caret, or null when nothing applies (caret behind a non-word char that
 * is not a space).
 */
export function wrapTag(tag, text, selStart, selEnd) {
    const eTag = tag.replace('[', '[/');
    if (selStart !== selEnd) {
        const mid = text.slice(selStart, selEnd);
        return { value: text.slice(0, selStart) + tag + mid + eTag + text.slice(selEnd), caret: selStart + tag.length + eTag.length + mid.length };
    }
    const pos = selStart;
    if ((text === '' || text.charAt(pos - 1) === ' ') && text.charAt(pos) !== '[') {
        return { value: text.slice(0, pos) + tag + eTag + text.slice(pos), caret: pos + tag.length };
    }
    const w = wordAt(text, pos);
    if (w) {
        const [s, e] = w;
        return { value: text.slice(0, s) + tag + text.slice(s, e) + eTag + text.slice(e), caret: e + tag.length + eTag.length };
    }
    return null;
}

/** The original's whisper completion: last contact that starts with the typed part. */
export function completeWhisper(text, contacts) {
    if (!text.startsWith(WHISPER) || text.length < WHISPER.length + 1) return null;
    const typed = text.slice(WHISPER.length);
    if (/\s/.test(typed)) return null;
    let hit = null;
    for (const c of contacts) if (c.startsWith(typed)) hit = c;
    if (!hit) return null;
    return { value: WHISPER + hit + ' ', selStart: WHISPER.length + typed.length, selEnd: WHISPER.length + hit.length };
}

/**
 * Chat-helper command in a line, or null. A name is required for add/del
 * (`/add `, `/del ` alone are not a command yet).
 *   {cmd: 'help'|'list'} · {cmd: 'add'|'del', name} · {cmd: 'whisper', name}
 */
export function parseCommand(text) {
    const s = String(text);
    if (/^\/chelp\s*$/.test(s)) return { cmd: 'help' };
    if (/^\/(list|contacts)\s*$/.test(s)) return { cmd: 'list' };
    let m = s.match(/^\/(add|del) +(\S+)\s*$/);
    if (m) return { cmd: m[1], name: m[2] };
    m = s.match(/^\/whisper (\w+)\s/);
    if (m) return { cmd: 'whisper', name: m[1] };
    return null;
}

/** Contacts from localStorage (original key/format; migrates 'myContacts'). */
export function loadContacts() {
    try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            localStorage.removeItem(LEGACY_KEY);
            const list = legacy.split(',').filter(Boolean);
            saveContacts(list);
            return list;
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        const obj = raw ? JSON.parse(raw) : null;
        return obj && Array.isArray(obj.contacts) ? obj.contacts.filter(c => typeof c === 'string' && c) : [];
    } catch {
        return [];
    }
}

export function saveContacts(contacts) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ saveObjVer: SAVE_VERSION, contacts }));
    } catch { /* storage full/blocked: list lives for this session only */ }
}

export function sortContacts(contacts) {
    return [...contacts].sort((a, b) => {
        a = a.toLowerCase();
        b = b.toLowerCase();
        return a > b ? 1 : a < b ? -1 : 0;
    });
}

/** A single-line text input (the chat line) - <input> with a text-like type. */
function isLineInput(el) {
    return !!el && String(el.tagName).toUpperCase() === 'INPUT' && LINE_TYPES.has(String(el.type || 'text').toLowerCase());
}

function isTextInput(el) {
    return isLineInput(el) || (!!el && (el.type === 'textarea' || String(el.tagName).toUpperCase() === 'TEXTAREA'));
}

/** The element the key was really typed in (composedPath()[0] sees through a shadow root). */
export function eventTarget(e) {
    try {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
        if (path && path.length && path[0] && path[0].tagName) return path[0];
    } catch { /* fall back to target */ }
    return e.target;
}

function isSpace(e) {
    return e.keyCode === 32 || e.key === ' ';
}

function isEnter(e) {
    return e.keyCode === 13 || e.key === 'Enter';
}

/** A qx widget's DOM element (qx 1.x/2.x container element, or the content element). */
function widgetDom(w, which) {
    try {
        const h = typeof w[which] === 'function' ? w[which]() : null;
        return h && typeof h.getDomElement === 'function' ? h.getDomElement() : null;
    } catch {
        return null;
    }
}

/** el itself when it is a text box, else the first text box inside it. */
function textBoxIn(el) {
    if (!el) return null;
    if (isTextInput(el)) return el;
    try {
        const all = el.querySelectorAll ? el.querySelectorAll('input, textarea') : [];
        for (const c of all) if (isLineInput(c)) return c;
        for (const c of all) if (isTextInput(c)) return c;
    } catch { /* not a DOM element */ }
    return null;
}

/** The game's chat widget (webfrontend.gui.chat.ChatWidget), or null. */
function chatWidget() {
    try {
        return qx.core.Init.getApplication().getChat().getChatWidget() || null;
    } catch {
        return null;
    }
}

/**
 * The game's chat input: {widget, el}, or null. First the route lib/cli.js
 * uses (getEditable() → content element → DOM); when that DOM element is not
 * the <input> itself (a wrapper), the text box inside it; else the first text
 * box inside the chat widget's own DOM.
 */
export function findChatInput() {
    const chat = chatWidget();
    if (!chat) return null;
    let widget = null;
    try { widget = typeof chat.getEditable === 'function' ? chat.getEditable() : null; } catch { widget = null; }
    if (widget) {
        const el = textBoxIn(widgetDom(widget, 'getContentElement')) || textBoxIn(widgetDom(widget, 'getContainerElement'));
        if (el) return { widget, el };
    }
    const el = textBoxIn(widgetDom(chat, 'getContentElement')) || textBoxIn(widgetDom(chat, 'getContainerElement'));
    return el ? { widget: null, el } : null;
}

/** Is el inside the chat widget's DOM? (for a chat input found through focus) */
function inChatWidget(el) {
    const chat = chatWidget();
    if (!chat || !el) return false;
    for (const root of [widgetDom(chat, 'getContainerElement'), widgetDom(chat, 'getContentElement')]) {
        try { if (root && root !== el && root.contains(el)) return true; } catch { /* ignore */ }
    }
    return false;
}

/** What the chat route returns step by step - logged once when the hook fails. */
export function describeChatRoute() {
    const tag = (el) => (el ? `<${String(el.tagName).toLowerCase()}${el.type ? ' type=' + el.type : ''}>` : 'null');
    const out = [];
    let app = null;
    try { app = qx.core.Init.getApplication(); } catch (e) { return `qx app: ${e && e.message}`; }
    let chat = null;
    try { chat = app.getChat(); out.push(`getChat: ${chat ? 'ok' : 'null'}`); } catch (e) { out.push(`getChat: ${e && e.message}`); }
    try { chat = chat && chat.getChatWidget(); out.push(`getChatWidget: ${chat ? (chat.classname || 'ok') : 'null'}`); } catch (e) { out.push(`getChatWidget: ${e && e.message}`); chat = null; }
    if (!chat) return out.join(' · ');
    let ed = null;
    try { ed = typeof chat.getEditable === 'function' ? chat.getEditable() : undefined; out.push(`getEditable: ${ed === undefined ? 'no such method' : ed ? (ed.classname || 'ok') : 'null'}`); } catch (e) { out.push(`getEditable: ${e && e.message}`); }
    if (ed) out.push(`editable content ${tag(widgetDom(ed, 'getContentElement'))}, container ${tag(widgetDom(ed, 'getContainerElement'))}`);
    out.push(`chat widget content ${tag(widgetDom(chat, 'getContentElement'))}, container ${tag(widgetDom(chat, 'getContainerElement'))}`);
    return out.join(' · ');
}

/**
 * Write a text box's value. A qooxdoo field (the chat input, mail, forum) gets
 * it through its widget's setValue() - the way TA_Coords_Button writes the
 * chat - so the widget's own value stays in sync with the DOM; else the DOM.
 */
export function setFieldValue(el, value, widget) {
    let w = widget || null;
    if (!w) {
        try { w = qx.ui.core.Widget.getWidgetByElement(el); } catch { w = null; }
    }
    if (w && typeof w.setValue === 'function') {
        try {
            const own = w.getContentElement && w.getContentElement().getDomElement();
            if (own === el) {
                w.setValue(value);
                if (el.value !== value) el.value = value;
                return;
            }
        } catch { /* fall through to the DOM */ }
    }
    el.value = value;
    // no widget found: an 'input' event lets a qx field pick up the new DOM value
    // (else the game could still send the untagged text it holds itself)
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* not a DOM element */ }
}

// ─── Plugin ──────────────────────────────────────────────────────────

export class ChatHelper {
    /** Short description for `/st help`. */
    get description() { return t('descChatHelper'); }

    constructor(config) {
        this.name = 'ChatHelper';
        this.config = config;
        this.running = false;
        this.contacts = [];
        this._declined = new Set();     // whisper names the player said "no" to this session
        this._timer = null;
        this._chat = null;              // {widget, el} the chat listeners sit on
        this._hookTimer = null;
        this._warned = false;
        this._misses = 0;               // failed hook attempts in a row (diagnostics)
        this._loggedTarget = false;
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onEnterCapture = this._onEnterCapture.bind(this);
        this._onWinKeyUp = (e) => {
            const el = eventTarget(e);
            if (this._isChat(el)) return;
            this._logUnhookedTarget(el);
            this._onKeyUp(e);
        };
        this._onWinKeyDown = (e) => {
            if (this._isChat(eventTarget(e))) return;
            this._onEnterCapture(e);
            this._onKeyDown(e);
        };
        // A line input inside the chat widget that gets focus is the chat input,
        // whatever route the game uses to build it (hooked before the first key).
        this._onFocusIn = (e) => {
            const el = eventTarget(e);
            if (this._isChat(el) || !isLineInput(el) || !inChatWidget(el)) return;
            let widget = null;
            try { widget = qx.ui.core.Widget.getWidgetByElement(el); } catch { widget = null; }
            this._attach({ widget, el }, 'focus');
        };
    }

    async start() {
        this.contacts = loadContacts();
        this.running = true;
        // Mail/forum/other text boxes: window capture phase, so the game's own
        // (qooxdoo) key handling cannot swallow the event first.
        window.addEventListener('keyup', this._onWinKeyUp, true);
        window.addEventListener('keydown', this._onWinKeyDown, true);
        window.addEventListener('focusin', this._onFocusIn, true);
        // The chat input: listeners on the element itself (like lib/cli.js),
        // re-hooked when the game re-creates it; checked every 2 s.
        this._hookChat();
        this._hookTimer = setInterval(() => this._hookChat(), 2000);
    }

    stop() {
        window.removeEventListener('keyup', this._onWinKeyUp, true);
        window.removeEventListener('keydown', this._onWinKeyDown, true);
        window.removeEventListener('focusin', this._onFocusIn, true);
        this._unhookChat();
        clearInterval(this._hookTimer);
        this._hookTimer = null;
        clearTimeout(this._timer);
        this._timer = null;
        this.running = false;
    }

    statusText() {
        const hook = t(this._chat ? 'chatHelperHooked' : 'chatHelperNotHooked');
        return `${t('chatHelperStatus', { n: this.contacts.length })} · ${hook}`;
    }

    _isChat(el) {
        return !!this._chat && el === this._chat.el;
    }

    _hookChat() {
        if (!this.running) return;
        const found = findChatInput();
        if (found && this._chat && found.el === this._chat.el) return;
        if (!found) {
            // keep an input hooked through focus while it is still in the page
            if (this._chat && this._chat.el.isConnected !== false) return;
            this._unhookChat();
            this._misses++;
            if (!this._warned) {
                this._warned = true;
                console.warn('[ST] ChatHelper: chat input not found yet — retrying every 2 s');
            }
            if (this._misses === DIAG_AFTER) console.warn(`[ST] ChatHelper: chat route - ${describeChatRoute()}`);
            return;
        }
        this._attach(found, 'qx');
    }

    _attach(found, how) {
        this._unhookChat();
        const { el } = found;
        el.addEventListener('keyup', this._onKeyUp);
        el.addEventListener('keydown', this._onEnterCapture);
        el.addEventListener('keydown', this._onKeyDown);
        try { el.setAttribute('data-st-chathelper', 'chat'); } catch { /* ignore */ }
        this._chat = found;
        this._misses = 0;
        console.log(`[ST] ChatHelper: chat input hooked via ${how} (<${String(el.tagName).toLowerCase()} type=${el.type}>)`);
    }

    /** Once, while the chat is not hooked: what the first key was typed in (diagnostics). */
    _logUnhookedTarget(el) {
        if (this._chat || this._loggedTarget || !el) return;
        this._loggedTarget = true;
        const cls = el.className ? ` class="${String(el.className).slice(0, 60)}"` : '';
        console.warn(`[ST] ChatHelper: key in <${String(el.tagName).toLowerCase()}${el.type ? ' type=' + el.type : ''}${cls}> `
            + `while the chat is not hooked (in chat widget: ${inChatWidget(el)}) - ${describeChatRoute()}`);
    }

    _unhookChat() {
        if (!this._chat) return;
        const { el } = this._chat;
        el.removeEventListener('keyup', this._onKeyUp);
        el.removeEventListener('keydown', this._onEnterCapture);
        el.removeEventListener('keydown', this._onKeyDown);
        try { el.removeAttribute('data-st-chathelper'); } catch { /* ignore */ }
        this._chat = null;
    }

    _set(el, value) {
        setFieldValue(el, value, this._isChat(el) ? this._chat.widget : null);
    }

    // ── keyboard ──

    _onKeyUp(e) {
        const el = eventTarget(e);
        if (!isTextInput(el) || el.value === '' || el.value.startsWith(ST_PREFIX)) return;
        if (isSpace(e)) {
            if (this._runCommand(el, el.value)) return;
            this._applyAutoTag(el);
        }
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._whisperComplete(e, el), KEYUP_DELAY_MS);
    }

    /** Enter on a chat line with a chat-helper command: handle it, never send it. */
    _onEnterCapture(e) {
        if (!isEnter(e)) return;
        const el = eventTarget(e);
        if (!isLineInput(el) || !el.value || el.value.startsWith(ST_PREFIX)) return;
        const c = parseCommand(el.value);
        if (!c || c.cmd === 'whisper') return;
        if (this._runCommand(el, el.value)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    _onKeyDown(e) {
        const el = eventTarget(e);
        if (!isTextInput(el)) return;
        if (isEnter(e)) {
            // mail / forum: tag on Enter (chat lines are tagged on space)
            if (el.type === 'textarea' && el.value !== '') this._applyAutoTag(el);
            return;
        }
        if (!e.altKey || e.shiftKey || e.ctrlKey || e.altGraphKey) return;
        const kc = e.keyCode;
        const suppress = this.config.get('ChatHelper.suppressAltKeys', true);
        const wrap = (tag) => {
            this._wrap(el, tag);
            if (suppress) e.preventDefault();
        };
        if (kc === 49 && el.type === 'textarea') {             // Alt+1
            const st = el.scrollTop;
            this._set(el, autoTag(el.value));
            el.scrollTop = st;
            this._caret(el, 0);
        } else if (kc === 50) {                                 // Alt+2
            const url = prompt(t('chatHelperUrlPrompt'), '');
            if (url !== null) this._set(el, el.value + '[url]' + url + '[/url]');
        } else if (kc === 80 || kc === 51) {                    // Alt+p / Alt+3
            wrap('[player]');
        } else if (kc === 65 || kc === 52) {                    // Alt+a / Alt+4
            wrap('[alliance]');
        } else if (kc === 48) {                                 // Alt+0
            const st = el.scrollTop;
            this._set(el, clearTags(el.value));
            el.scrollTop = st;
        } else if (kc === 66) {
            wrap('[b]');
        } else if (kc === 73) {
            wrap('[i]');
        } else if (kc === 85) {
            wrap('[u]');
        } else if (kc === 83) {
            wrap('[s]');
        }
    }

    _applyAutoTag(el) {
        const tagged = autoTag(el.value);
        if (tagged !== el.value) this._set(el, tagged);
    }

    _wrap(el, tag) {
        const st = el.scrollTop;
        const r = wrapTag(tag, el.value, el.selectionStart, el.selectionEnd);
        if (!r) return;
        this._set(el, r.value);
        this._caret(el, r.caret);
        if (el.type === 'textarea') el.scrollTop = st;
    }

    _caret(el, pos) {
        try {
            el.setSelectionRange(pos, pos);
            el.focus();
        } catch { /* not a selectable input */ }
    }

    _whisperComplete(e, el) {
        if (!isLineInput(el) || !el.value) return;
        if (e.altGraphKey || e.ctrlKey || e.altKey || !(e.keyCode > 47 && e.keyCode < 91)) return;
        const r = completeWhisper(el.value, this.contacts);
        if (!r) return;
        this._set(el, r.value);
        try { el.setSelectionRange(r.selStart, r.selEnd, 'forward'); } catch { /* ignore */ }
    }

    // ── commands ──

    /** Runs a chat-helper command; true if the line was one (and is consumed). */
    _runCommand(el, text) {
        const c = parseCommand(text);
        if (!c) return false;
        if (c.cmd === 'whisper') {
            // a whisper is sent as usual; only offer to save an unknown name (once)
            if (!this.contacts.includes(c.name) && !this._declined.has(c.name)) {
                const name = c.name;
                this._declined.add(name);
                setTimeout(() => {
                    if (confirm(t('chatHelperAddConfirm', { name }))) this._add(name);
                }, 500);
            }
            return false;
        }
        this._set(el, '');
        if (c.cmd === 'help') this._showHelp();
        else if (c.cmd === 'list') this._list();
        else if (c.cmd === 'add') {
            if (this.contacts.includes(c.name)) chatMessage(`[ST] ${escapeHtml(t('chatHelperAlready', { name: c.name }))}`);
            else if (confirm(t('chatHelperAddConfirm', { name: c.name }))) this._add(c.name);
        } else if (c.cmd === 'del') {
            if (c.name !== 'all' && !this.contacts.includes(c.name)) {
                chatMessage(`[ST] ${escapeHtml(t('chatHelperNotInList', { name: c.name }))}`);
            } else if (confirm(t(c.name === 'all' ? 'chatHelperDelAllConfirm' : 'chatHelperDelConfirm', { name: c.name }))) {
                this.contacts = c.name === 'all' ? [] : this.contacts.filter(x => x !== c.name);
                saveContacts(this.contacts);
                chatMessage(`[ST] ${escapeHtml(t(c.name === 'all' ? 'chatHelperDeletedAll' : 'chatHelperDeleted', { name: c.name }))}`);
            }
        }
        setTimeout(() => { try { el.focus(); } catch { /* ignore */ } }, 5);
        return true;
    }

    _add(name) {
        if (this.contacts.includes(name)) return;
        this.contacts.push(name);
        saveContacts(this.contacts);
        chatMessage(`[ST] ${escapeHtml(t('chatHelperAdded', { name }))}`);
    }

    _list() {
        if (this.contacts.length === 0) {
            const p = prompt(t('chatHelperEmptyPrompt'), '');
            if (p && p.trim()) this._add(p.trim());
            return;
        }
        const sorted = sortContacts(this.contacts);
        chatMessage(`[ST] ${escapeHtml(t('chatHelperListHeader', { n: sorted.length }))}`);
        chatMessage(`[ST] ${escapeHtml(sorted.join(', '))}`);
    }

    _showHelp() {
        for (const key of ['chatHelperHelp1', 'chatHelperHelp2', 'chatHelperHelp3', 'chatHelperHelp4', 'chatHelperHelp5', 'chatHelperHelp6']) {
            chatMessage(`[ST] ${escapeHtml(t(key))}`);
        }
    }
}
