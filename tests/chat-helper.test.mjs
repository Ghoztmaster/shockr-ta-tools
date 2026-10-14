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

// ── plugin: listeners, /st untouched, disable restores ──

function setupDom() {
    const listeners = [];
    globalThis.document = {
        addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap: !!cap }),
        removeEventListener: (type, fn, cap) => {
            const i = listeners.findIndex(l => l.type === type && l.fn === fn && l.cap === !!cap);
            if (i >= 0) listeners.splice(i, 1);
        },
    };
    return listeners;
}

function fire(listeners, type, ev) {
    for (const l of listeners.filter(x => x.type === type)) l.fn(ev);
}

function input(value, type = 'text') {
    return { type, value, selectionStart: value.length, selectionEnd: value.length, scrollTop: 0, focus() {}, setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; } };
}

const config = { get: (k, d) => d };

test('/st lines are never touched (space, Enter, auto-tag)', async () => {
    fakeStorage();
    const listeners = setupDom();
    const p = new mod.ChatHelper(config);
    await p.start();
    const el = input('/st config set api.url https://x.example.com ');
    let prevented = false;
    fire(listeners, 'keyup', { target: el, keyCode: 32 });
    fire(listeners, 'keydown', { target: el, keyCode: 13, preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(el.value, '/st config set api.url https://x.example.com ');
    assert.equal(prevented, false);
    p.stop();
});

test('space in chat tags coords; disable removes every listener', async () => {
    fakeStorage();
    const listeners = setupDom();
    const p = new mod.ChatHelper(config);
    await p.start();
    assert.equal(listeners.length, 3);
    const el = input('go 840:293 ');
    fire(listeners, 'keyup', { target: el, keyCode: 32 });
    assert.equal(el.value, 'go [coords]840:293[/coords] ');
    p.stop();
    assert.equal(listeners.length, 0);
    assert.equal(p.running, false);
});

test('Alt+b wraps the word, Alt+0 clears', async () => {
    fakeStorage();
    const listeners = setupDom();
    const p = new mod.ChatHelper(config);
    await p.start();
    const el = input('hi Bob');
    let prevented = false;
    fire(listeners, 'keydown', { target: el, keyCode: 66, altKey: true, preventDefault() { prevented = true; } });
    assert.equal(el.value, 'hi [b]Bob[/b]');
    assert.equal(prevented, true);
    fire(listeners, 'keydown', { target: el, keyCode: 48, altKey: true, preventDefault() {} });
    assert.equal(el.value, 'hi Bob');
    p.stop();
});
