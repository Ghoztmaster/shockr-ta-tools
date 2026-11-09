// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * chat-enrich.js — ChatManager's chat enrichment (5.48.0): own name highlighted,
 * plain http(s) urls clickable, chat text kept selectable.
 *
 * Done on the rendered DOM (a MutationObserver on the chat window), not by
 * patching the game: the game's message method has an obfuscated name.
 *
 * What the chat DOM looks like (VERIFIED LIVE 2026-11-09):
 *   one qx.ui.basic.Label per chat pane (qxselectable="on", user-select: text) holding
 *   one <div> per message: <font>time</font> <font>[Alliance] [<span id="CHAT_SENDER_…"
 *   data-chat-senderid=…>name</span>]: <span>text</span></font>
 *   [coords]/[url]/[player] become <a onClick=…> by webfrontend.gui.util.BBCode.convertBBCode.
 *   Plain urls stay plain text - that is what linkify adds.
 *
 * Coordinates in whispers (5.48.0 finding, VERIFIED LIVE 2026-11-09): every incoming
 * message - alliance, officers, global, whisper in and whisper out - goes through the
 * same ChatWidget method, which runs BBCode.convertBBCode BEFORE it switches on the
 * channel. A [coords] tag in a whisper is therefore just as clickable as in alliance,
 * and ChatHelper tags coordinates in every chat line it sends (whispers included,
 * only /st lines are skipped). No whisper hook is needed. Coordinates typed WITHOUT a
 * tag (by a player without ChatHelper) are plain text in every channel.
 *
 * Never touched: game links (<a>, [onclick]), the sender span (CHAT_SENDER_…) - so
 * your own name as sender is not highlighted - and our own markers (data-st-cm).
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"'\[\]]+/gi;
const TRAILING = /[.,;:!?)]+$/;            // "see https://x.com/a." - the dot is not part of the url
const SKIP = 'a,[onclick],[id^="CHAT_SENDER_"],[data-st-cm],script,style';
const DEFAULT_COLOR = '#ffff00';

/** Only http(s) urls that parse; anything else (javascript:, data:, …) is null. */
export function safeUrl(text) {
    try {
        const u = new URL(text);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}

/** chatmanager.mentionColor: a #hex or a css colour word; 'none'/'' = off (null). */
export function mentionColor(value) {
    if (value === undefined || value === null) return DEFAULT_COLOR;
    const v = String(value).trim();
    if (v === '' || v.toLowerCase() === 'none' || v.toLowerCase() === 'off') return null;
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v) || /^[a-z]{3,20}$/i.test(v)) return v;
    return DEFAULT_COLOR;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a text into segments: {type:'text'|'url'|'mention', value[, href]}.
 * Mention: the name case-insensitive, not inside a longer word.
 * @param {string} text
 * @param {{name?: string, linkify?: boolean}} opts
 */
export function segments(text, { name = '', linkify = true } = {}) {
    const hits = [];
    if (linkify) {
        for (const m of text.matchAll(URL_RE)) {
            const raw = m[0].replace(TRAILING, '');
            const href = safeUrl(raw);
            if (href) hits.push({ start: m.index, end: m.index + raw.length, type: 'url', href });
        }
    }
    if (name) {
        const re = new RegExp(`(?<![\\w])${escapeRe(name)}(?![\\w])`, 'gi');
        for (const m of text.matchAll(re)) {
            const start = m.index;
            const end = start + m[0].length;
            if (!hits.some(h => start < h.end && end > h.start)) hits.push({ start, end, type: 'mention' });
        }
    }
    if (!hits.length) return [{ type: 'text', value: text }];
    hits.sort((a, b) => a.start - b.start);
    const out = [];
    let last = 0;
    for (const h of hits) {
        if (h.start > last) out.push({ type: 'text', value: text.slice(last, h.start) });
        const seg = { type: h.type, value: text.slice(h.start, h.end) };
        if (h.href) seg.href = h.href;
        out.push(seg);
        last = h.end;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
}

/** Is this text node inside something we must not touch (below `root`)? */
function skipped(node, root) {
    for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (el.matches && el.matches(SKIP)) return true;
    }
    return false;
}

/**
 * Enrich every text node below `root`. Idempotent: what we add carries
 * data-st-cm and is skipped next time. @returns {number} segments added
 */
export function enrich(root, { name = '', linkify = true, color = DEFAULT_COLOR } = {}) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue && n.nodeValue.trim() && !skipped(n, root)) nodes.push(n);
    }
    const mentionName = color ? name : '';
    let added = 0;
    for (const n of nodes) {
        const segs = segments(n.nodeValue, { name: mentionName, linkify });
        if (segs.length === 1 && segs[0].type === 'text') continue;
        const frag = doc.createDocumentFragment();
        for (const s of segs) {
            if (s.type === 'text') {
                frag.appendChild(doc.createTextNode(s.value));
                continue;
            }
            added++;
            if (s.type === 'url') {
                const a = doc.createElement('a');
                a.href = s.href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = s.value;
                a.setAttribute('data-st-cm', 'url');
                a.style.cssText = 'color:#4fc3f7;text-decoration:underline;cursor:pointer;';
                frag.appendChild(a);
            } else {
                const span = doc.createElement('span');
                span.textContent = s.value;
                span.setAttribute('data-st-cm', 'mention');
                span.style.cssText = `color:${color};font-weight:bold;`;
                frag.appendChild(span);
            }
        }
        n.parentNode.replaceChild(frag, n);
    }
    return added;
}

/**
 * Selection safety net: every chat Label widget below `root` selectable again
 * (the current client already has them selectable - this only matters if a
 * later client turns it off). @returns {number} labels switched back on
 */
export function keepSelectable(root) {
    let fixed = 0;
    try {
        const seen = new Set();
        for (const el of root.querySelectorAll('div[qxselectable]')) {
            const w = qx.ui.core.Widget.getWidgetByElement(el);
            if (!w || seen.has(w) || typeof w.getSelectable !== 'function') continue;
            seen.add(w);
            if (w.classname === 'qx.ui.basic.Label' && !w.getSelectable()) {
                w.setSelectable(true);
                fixed++;
            }
        }
    } catch { /* no qx: nothing to fix */ }
    return fixed;
}
