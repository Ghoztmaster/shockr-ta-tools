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
 *   - No document.onkeydown/onkeyup overwrite: addEventListener (keyup and
 *     keydown on document, Enter commands in the capture phase), all removed
 *     by stop() — `/st plugin disable chat-helper` leaves the chat untouched.
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

function isTextInput(el) {
    return !!el && (el.type === 'text' || el.type === 'textarea');
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
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onEnterCapture = this._onEnterCapture.bind(this);
    }

    async start() {
        this.contacts = loadContacts();
        document.addEventListener('keyup', this._onKeyUp);
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keydown', this._onEnterCapture, true);
        this.running = true;
    }

    stop() {
        document.removeEventListener('keyup', this._onKeyUp);
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keydown', this._onEnterCapture, true);
        clearTimeout(this._timer);
        this._timer = null;
        this.running = false;
    }

    statusText() {
        return t('chatHelperStatus', { n: this.contacts.length });
    }

    // ── keyboard ──

    _onKeyUp(e) {
        const el = e.target;
        if (!isTextInput(el) || el.value === '' || el.value.startsWith(ST_PREFIX)) return;
        if (e.keyCode === 32) {
            if (this._runCommand(el, el.value)) return;
            this._applyAutoTag(el);
        }
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._whisperComplete(e), KEYUP_DELAY_MS);
    }

    /** Enter on a chat line with a chat-helper command: handle it, never send it. */
    _onEnterCapture(e) {
        if (e.keyCode !== 13) return;
        const el = e.target;
        if (!el || el.type !== 'text' || !el.value || el.value.startsWith(ST_PREFIX)) return;
        const c = parseCommand(el.value);
        if (!c || c.cmd === 'whisper') return;
        if (this._runCommand(el, el.value)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    _onKeyDown(e) {
        const el = e.target;
        if (!isTextInput(el)) return;
        if (e.keyCode === 13) {
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
            el.value = autoTag(el.value);
            el.scrollTop = st;
            this._caret(el, 0);
        } else if (kc === 50) {                                 // Alt+2
            const url = prompt(t('chatHelperUrlPrompt'), '');
            if (url !== null) el.value += '[url]' + url + '[/url]';
        } else if (kc === 80 || kc === 51) {                    // Alt+p / Alt+3
            wrap('[player]');
        } else if (kc === 65 || kc === 52) {                    // Alt+a / Alt+4
            wrap('[alliance]');
        } else if (kc === 48) {                                 // Alt+0
            const st = el.scrollTop;
            el.value = clearTags(el.value);
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
        if (tagged !== el.value) el.value = tagged;
    }

    _wrap(el, tag) {
        const st = el.scrollTop;
        const r = wrapTag(tag, el.value, el.selectionStart, el.selectionEnd);
        if (!r) return;
        el.value = r.value;
        this._caret(el, r.caret);
        if (el.type === 'textarea') el.scrollTop = st;
    }

    _caret(el, pos) {
        try {
            el.setSelectionRange(pos, pos);
            el.focus();
        } catch { /* not a selectable input */ }
    }

    _whisperComplete(e) {
        const el = e.target;
        if (!el || el.type !== 'text' || !el.value) return;
        if (e.altGraphKey || e.ctrlKey || e.altKey || !(e.keyCode > 47 && e.keyCode < 91)) return;
        const r = completeWhisper(el.value, this.contacts);
        if (!r) return;
        el.value = r.value;
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
        el.value = '';
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
