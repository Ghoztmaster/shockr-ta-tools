// ChatHelper: BB-code auto-tagging, Alt shortcuts, contact list (plugins/chat-helper.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
    const out = await esbuild.build({
        stdin: { contents: `export * from './plugins/chat-helper.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

function fakeStorage(initial = {}) {
    const store = { ...initial };
    globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
    return store;
}

// ── autoTag (the original's regexes) ──

test('coords are tagged, dot becomes colon', () => {
    assert.equal(mod.autoTag('attack 840:293 now'), 'attack [coords]840:293[/coords] now');
    assert.equal(mod.autoTag('840.293'), '[coords]840:293[/coords]');
    assert.equal(mod.autoTag('840:293:base'), '[coords]840:293:base[/coords]');
});

test('coords need 3-4 digits (original rule)', () => {
    assert.equal(mod.autoTag('84:293'), '84:293');
});

test('auto-tag is idempotent', () => {
    const once = mod.autoTag('840:293 https://example.com/a?b=1');
    assert.equal(mod.autoTag(once), once);
});

test('urls with protocol are tagged, bare domains not', () => {
    assert.equal(mod.autoTag('see https://example.com/x?y=1'), 'see [url]https://example.com/x?y=1[/url]');
    assert.equal(mod.autoTag('see example.com'), 'see example.com');
});

test('a cnc-map line keeps its coords untagged', () => {
    const s = 'http://cnc-map.com/x 840:293';
    assert.ok(!mod.autoTag(s).includes('[coords]'));
});

test('[p]/[a] shorthands', () => {
    assert.equal(mod.autoTag('[p]Bob[/p] of [a]SoO[/a]'), '[player]Bob[/player] of [alliance]SoO[/alliance]');
});

test('clearTags removes every known tag', () => {
    assert.equal(mod.clearTags('[b][player]Bob[/player][/b] [coords]1:2[/coords] [url]x[/url] [i][u][s]z[/s][/u][/i]'), 'Bob 1:2 x z');
});

// ── wrapTag (tagWith) ──

test('selection is wrapped', () => {
    assert.deepEqual(mod.wrapTag('[b]', 'hello world', 6, 11), { value: 'hello [b]world[/b]', caret: 18 });
});

test('empty input / after space inserts an empty pair', () => {
    assert.deepEqual(mod.wrapTag('[player]', '', 0, 0), { value: '[player][/player]', caret: 8 });
    assert.deepEqual(mod.wrapTag('[i]', 'hi ', 3, 3), { value: 'hi [i][/i]', caret: 6 });
});

test('caret behind a word wraps the word', () => {
    assert.deepEqual(mod.wrapTag('[player]', 'hi Bob', 6, 6), { value: 'hi [player]Bob[/player]', caret: 23 });
});

// ── whisper completion + commands ──

test('whisper completes a contact', () => {
    const r = mod.completeWhisper('/whisper Gh', ['Bob', 'Ghozt']);
    assert.deepEqual(r, { value: '/whisper Ghozt ', selStart: 11, selEnd: 14 });
    assert.equal(mod.completeWhisper('/whisper Xy', ['Bob']), null);
    assert.equal(mod.completeWhisper('/whisper Bob hi', ['Bob']), null);
});

test('parseCommand', () => {
    assert.deepEqual(mod.parseCommand('/chelp '), { cmd: 'help' });
    assert.deepEqual(mod.parseCommand('/list '), { cmd: 'list' });
    assert.deepEqual(mod.parseCommand('/contacts'), { cmd: 'list' });
    assert.deepEqual(mod.parseCommand('/add Bob '), { cmd: 'add', name: 'Bob' });
    assert.deepEqual(mod.parseCommand('/del all'), { cmd: 'del', name: 'all' });
    assert.deepEqual(mod.parseCommand('/whisper Bob hi'), { cmd: 'whisper', name: 'Bob' });
    assert.equal(mod.parseCommand('/add '), null);          // waits for a name
    assert.equal(mod.parseCommand('/del '), null);
    assert.equal(mod.parseCommand('/st help'), null);       // Shockr's own prefix
    assert.equal(mod.parseCommand('/st plugin list'), null);
});

// ── storage (original key + format) ──

test('contacts load from the original chatHelper key', () => {
    fakeStorage({ chatHelper: JSON.stringify({ saveObjVer: '3.2.0', contacts: ['Bob', 'Ann'] }) });
    assert.deepEqual(mod.loadContacts(), ['Bob', 'Ann']);
});

test('legacy myContacts is migrated', () => {
    const store = fakeStorage({ myContacts: 'Bob,Ann' });
    assert.deepEqual(mod.loadContacts(), ['Bob', 'Ann']);
    assert.equal(store.myContacts, undefined);
    assert.deepEqual(JSON.parse(store.chatHelper), { saveObjVer: '3.2.0', contacts: ['Bob', 'Ann'] });
});

test('sortContacts is case-insensitive', () => {
    assert.deepEqual(mod.sortContacts(['bob', 'Ann', 'Carl']), ['Ann', 'bob', 'Carl']);
});

// ── plugin: chat hook on the element, window capture for the rest ──

/** A DOM-ish node with its own listener list. */
function node(value, type = 'text') {
    const ls = [];
    const attrs = {};
    return {
        type, value, tagName: type === 'textarea' ? 'TEXTAREA' : 'INPUT',
        selectionStart: value.length, selectionEnd: value.length, scrollTop: 0,
        focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
        addEventListener: (t, fn, cap) => ls.push({ t, fn, cap: !!cap }),
        removeEventListener: (t, fn, cap) => {
            const i = ls.findIndex(l => l.t === t && l.fn === fn && l.cap === !!cap);
            if (i >= 0) ls.splice(i, 1);
        },
        setAttribute: (k, v) => { attrs[k] = v; },
        removeAttribute: (k) => { delete attrs[k]; },
        attrs, ls,
    };
}

/** window + qx with a chat widget whose editable is `chatEl` (null = no chat yet). */
function setupGame(chatEl) {
    const win = node('');
    globalThis.window = win;
    const setValues = [];
    const editable = {
        getContentElement: () => ({ getDomElement: () => chatEl }),
        setValue(v) { setValues.push(v); chatEl.value = v; },
    };
    globalThis.qx = {
        core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ getEditable: () => editable }) }) }) } },
        ui: { core: { Widget: { getWidgetByElement: () => null } } },
    };
    return { win, setValues };
}

/** Fire on the element (target phase) and on window capture, as a browser would. */
function fire(game, el, type, ev) {
    ev = { target: el, preventDefault() { ev.prevented = true; }, stopPropagation() {}, ...ev };
    for (const l of game.win.ls.filter(x => x.t === type && x.cap)) l.fn(ev);
    for (const l of el.ls.filter(x => x.t === type)) l.fn(ev);
    return ev;
}

const config = { get: (k, d) => d };

test('chat input is hooked on the element and marked', async () => {
    fakeStorage();
    const chat = node('');
    const game = setupGame(chat);
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.equal(chat.attrs['data-st-chathelper'], 'chat');
    assert.ok(chat.ls.some(l => l.t === 'keyup'));
    p.stop();
    assert.equal(chat.ls.length, 0);
    assert.equal(game.win.ls.length, 0);
    assert.equal(chat.attrs['data-st-chathelper'], undefined);
});

test('840:293 + space in the chat is tagged through the qx widget', async () => {
    fakeStorage();
    const chat = node('840:293 ');
    const game = setupGame(chat);
    const p = new mod.ChatHelper(config);
    await p.start();
    fire(game, chat, 'keyup', { keyCode: 32, key: ' ' });
    assert.equal(chat.value, '[coords]840:293[/coords] ');
    assert.deepEqual(game.setValues, ['[coords]840:293[/coords] ']);
    p.stop();
});

test('chat is handled once (window capture skips the hooked element)', async () => {
    fakeStorage();
    const chat = node('hi Bob');
    const game = setupGame(chat);
    const p = new mod.ChatHelper(config);
    await p.start();
    fire(game, chat, 'keydown', { keyCode: 66, altKey: true });
    assert.equal(chat.value, 'hi [b]Bob[/b]');           // not [b][b]Bob[/b][/b]
    p.stop();
});

test('chat input that appears later is hooked by the retry', async (t) => {
    fakeStorage();
    t.mock.timers.enable({ apis: ['setInterval'] });
    const chat = node('');
    const game = setupGame(null);
    let real = null;
    globalThis.qx.core.Init.getApplication = () => ({ getChat: () => ({ getChatWidget: () => ({ getEditable: () => ({
        getContentElement: () => ({ getDomElement: () => real }), setValue(v) { real.value = v; },
    }) }) }) });
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.match(p.statusText(), /NOT/);
    real = chat;
    t.mock.timers.tick(2000);
    assert.equal(chat.attrs['data-st-chathelper'], 'chat');
    p.stop();
    void game;
});

test('/st lines are never touched (space, Enter)', async () => {
    fakeStorage();
    const chat = node('/st config set api.url https://x.example.com ');
    const game = setupGame(chat);
    const p = new mod.ChatHelper(config);
    await p.start();
    fire(game, chat, 'keyup', { keyCode: 32 });
    const ev = fire(game, chat, 'keydown', { keyCode: 13 });
    assert.equal(chat.value, '/st config set api.url https://x.example.com ');
    assert.ok(!ev.prevented);
    assert.deepEqual(game.setValues, []);
    p.stop();
});

test('mail textarea (not the chat) is tagged on Enter via window capture', async () => {
    fakeStorage();
    const chat = node('');
    const game = setupGame(chat);
    const mail = node('meet at 840:293', 'textarea');
    const p = new mod.ChatHelper(config);
    await p.start();
    fire(game, mail, 'keydown', { keyCode: 13 });
    assert.equal(mail.value, 'meet at [coords]840:293[/coords]');
    fire(game, mail, 'keydown', { keyCode: 48, altKey: true });
    assert.equal(mail.value, 'meet at 840:293');
    p.stop();
});

// ── 5.22.1 fix: chat input found when getEditable()'s DOM is not the <input> ──

/** A wrapper element (div) with the given children. */
function wrapper(...kids) {
    const w = node('', 'div');
    w.tagName = 'DIV';
    w.type = undefined;
    w.querySelectorAll = () => kids;
    w.contains = (el) => kids.includes(el);
    return w;
}

function setupChat(chatWidget) {
    const win = node('');
    globalThis.window = win;
    globalThis.qx = {
        core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => chatWidget }) }) } },
        ui: { core: { Widget: { getWidgetByElement: () => null } } },
    };
    return { win };
}

test('editable whose content element is a wrapper: the <input> inside is hooked', async () => {
    fakeStorage();
    const chat = node('840:293 ');
    const game = setupChat({ getEditable: () => ({ getContentElement: () => ({ getDomElement: () => wrapper(chat) }) }) });
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.equal(chat.attrs['data-st-chathelper'], 'chat');
    fire(game, chat, 'keyup', { keyCode: 32 });
    assert.equal(chat.value, '[coords]840:293[/coords] ');
    p.stop();
});

test('no getEditable(): the text box inside the chat widget DOM is hooked', async () => {
    fakeStorage();
    const chat = node('');
    setupChat({ getContentElement: () => ({ getDomElement: () => wrapper(node('', 'textarea'), chat) }) });
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.equal(chat.attrs['data-st-chathelper'], 'chat');
    p.stop();
});

test('focus on a line input inside the chat widget hooks it', async () => {
    fakeStorage();
    const chat = node('840:293 ');
    let dom = null;                                     // qx route finds nothing
    const game = setupChat({ getContainerElement: () => ({ getDomElement: () => dom }) });
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.match(p.statusText(), /NOT/);
    dom = { contains: (el) => el === chat, querySelectorAll: () => [] };
    fire(game, chat, 'focusin', {});
    assert.equal(chat.attrs['data-st-chathelper'], 'chat');
    fire(game, chat, 'keyup', { keyCode: 32 });
    assert.equal(chat.value, '[coords]840:293[/coords] ');
    p.stop();
    assert.equal(game.win.ls.length, 0);
});

test('composedPath()[0] is used as the target (shadow DOM retargeting)', async () => {
    fakeStorage();
    const game = setupGame(null);
    const host = node('', 'div');
    host.tagName = 'DIV';
    const inner = node('840:293 ');
    const p = new mod.ChatHelper(config);
    await p.start();
    fire(game, host, 'keyup', { keyCode: 32, composedPath: () => [inner, host] });
    assert.equal(inner.value, '[coords]840:293[/coords] ');
    p.stop();
});
