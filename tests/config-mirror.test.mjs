// GM mirror of the config across game hosts (lib/config.js + lib/bootstrap.js, 5.25.0).
// Run: npm test   (the dist test needs `node build.js` first)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Config, mergeWithGm, CONFIG_LOST_MESSAGE } from '../lib/config.js';

function fakeStorage(initial = {}) {
    const store = { ...initial };
    globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    };
    return store;
}

/** Capture what Config sends to the bootstrapper. */
function captureEvents() {
    const sent = [];
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
    globalThis.window = { dispatchEvent: (e) => { sent.push({ type: e.type, ...JSON.parse(e.detail) }); } };
    return sent;
}

test('merge: GM-only key comes in, local-only key stays, conflict without base -> local wins', () => {
    const m = mergeWithGm({ a: 1, b: 'local' }, { b: 'gm', c: 3 }, null);
    assert.deepEqual(m, { a: 1, b: 'local', c: 3 });
});

test('merge: key unchanged here since last sync but changed on another host -> GM value', () => {
    const m = mergeWithGm({ 'api.key': 'old' }, { 'api.key': 'new' }, { 'api.key': 'old' });
    assert.equal(m['api.key'], 'new');
});

test('merge: changed here since last sync -> local wins over GM', () => {
    const m = mergeWithGm({ x: 'mine' }, { x: 'other' }, { x: 'base' });
    assert.equal(m.x, 'mine');
});

test('merge: key missing from GM never deletes a local one (GM wiped)', () => {
    const m = mergeWithGm({ 'api.key': 'k' }, {}, { 'api.key': 'k' });
    assert.equal(m['api.key'], 'k');
});

test('empty host: config comes from GM, is written locally, not a fresh install', () => {
    const store = fakeStorage();
    const sent = captureEvents();
    const c = new Config('st-config', { 'api.url': 'https://x', 'api.key': 'k' });
    assert.equal(c.get('api.url'), 'https://x');
    assert.equal(c.isNew, false);
    assert.deepEqual(JSON.parse(store['st-config']), { 'api.url': 'https://x', 'api.key': 'k' });
    assert.equal(sent.length, 0);   // GM already has it all
    assert.deepEqual(JSON.parse(store['st-config-gm-sync']), { 'api.url': 'https://x', 'api.key': 'k' });
});

test('first startup with mirror: local keys go to GM', () => {
    fakeStorage({ 'st-config': JSON.stringify({ 'api.url': 'https://x', 'wavy.enabled': false }) });
    const sent = captureEvents();
    new Config('st-config', {});
    assert.deepEqual(sent, [
        { type: 'st-config-changed', key: 'api.url', value: 'https://x' },
        { type: 'st-config-changed', key: 'wavy.enabled', value: false },
    ]);
});

test('set, delete and import are mirrored; unchanged keys are not resent', () => {
    fakeStorage();
    const sent = captureEvents();
    const c = new Config('st-config', {});
    c.set('Api.Url', 'https://y');
    c.set('api.url', 'https://y');            // same value: nothing sent
    c.set('api.url', undefined);
    c.data['imported.key'] = 7; c.save();     // applyImport path
    assert.deepEqual(sent, [
        { type: 'st-config-changed', key: 'api.url', value: 'https://y' },
        { type: 'st-config-changed', key: 'api.url' },
        { type: 'st-config-changed', key: 'imported.key', value: 7 },
    ]);
});

test('no mirror (no bootstrapper): no events, no sync key', () => {
    const store = fakeStorage();
    const sent = captureEvents();
    const c = new Config('st-config', null);
    c.set('a', 1);
    assert.equal(sent.length, 0);
    assert.equal(store['st-config-gm-sync'], undefined);
});

// --- 5.25.0 diagnosis: config gone everywhere although this host synced before ---

function captureWarn() {
    const warned = [];
    const orig = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    return { warned, restore: () => { console.warn = orig; } };
}

test('wiped config: empty localStorage + empty GM + sync marker -> one console line, configLost = true', () => {
    fakeStorage({ 'st-config-gm-sync': JSON.stringify({ 'api.url': 'https://x', 'api.playerkey': 'k' }) });
    captureEvents();
    const w = captureWarn();
    try {
        const c = new Config('st-config', {});
        assert.equal(c.configLost, true);
        assert.deepEqual(c.data, {}, 'nothing invented');
        assert.equal(w.warned.length, 1);
        assert.equal(w.warned[0], CONFIG_LOST_MESSAGE);
        assert.match(w.warned[0], /Importeren/);
        assert.match(w.warned[0], /\/st config import/);
    } finally {
        w.restore();
    }
});

test('no diagnosis on a real fresh install (no sync marker), with a GM config, or with a local config', () => {
    const w = captureWarn();
    try {
        fakeStorage(); captureEvents();
        assert.equal(new Config('st-config', {}).configLost, false, 'fresh install');
        fakeStorage({ 'st-config-gm-sync': JSON.stringify({ a: 1 }) }); captureEvents();
        assert.equal(new Config('st-config', { a: 1 }).configLost, false, 'GM still has it');
        fakeStorage({ 'st-config': JSON.stringify({ a: 1 }), 'st-config-gm-sync': JSON.stringify({ a: 1 }) }); captureEvents();
        assert.equal(new Config('st-config', {}).configLost, false, 'local still has it');
        fakeStorage({ 'st-config-gm-sync': JSON.stringify({ a: 1 }) });
        assert.equal(new Config('st-config', null).configLost, false, 'no mirror at all: not judged');
        assert.equal(w.warned.length, 0);
    } finally {
        w.restore();
    }
});

// --- End to end: the built .user.js with a sandbox and a page that only share the DOM/window events ---

function makeWorlds(gmInit) {
    const listeners = {};
    const win = {
        addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
        removeEventListener() {},
        dispatchEvent: (e) => { for (const f of listeners[e.type] || []) f(e); return true; },
    };
    class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
    const gm = { 'st-config': gmInit };
    const ls = {};
    const localStorage = {
        getItem: (k) => (k in ls ? ls[k] : null),
        setItem: (k, v) => { ls[k] = String(v); },
        removeItem: (k) => { delete ls[k]; },
    };
    const page = vm.createContext({ window: win, CustomEvent, localStorage, console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
        document: { addEventListener() {}, createElement: () => ({ style: {} }) } });
    page.window = win;
    let injected = 0;
    const document = {
        head: { appendChild: (el) => { injected++; vm.runInContext(el.textContent, page); } },
        createElement: () => ({ textContent: '', remove() {} }),
    };
    const sandbox = vm.createContext({ window: win, document, CustomEvent, console: { log() {}, warn() {}, error() {} },
        GM_getValue: (k, d) => (k in gm && gm[k] !== undefined ? structuredClone(gm[k]) : d),
        GM_setValue: (k, v) => { gm[k] = structuredClone(v); } });
    return { sandbox, page, gm, ls, injected: () => injected };
}

const DIST = new URL('../dist/shockr-ta-tools.user.js', import.meta.url);

test('dist: bundle is injected into the page and gets the GM config before Config is built', { skip: !fs.existsSync(DIST) }, () => {
    const src = fs.readFileSync(DIST, 'utf8');
    assert.match(src, /@grant\s+GM_getValue/);
    assert.match(src, /@grant\s+GM_setValue/);
    const w = makeWorlds({ 'api.url': 'https://from-host-a' });
    vm.runInContext(src, w.sandbox);
    assert.equal(w.injected(), 1);
    // page has no ClientLib here, so startup waits; the mirror is already in place:
    // sending a change from the page lands in GM storage
    w.page.window.dispatchEvent(new w.page.CustomEvent('st-config-changed',
        { detail: JSON.stringify({ key: 'api.key', value: 'k1' }) }));
    assert.deepEqual(w.gm['st-config'], { 'api.url': 'https://from-host-a', 'api.key': 'k1' });
    w.page.window.dispatchEvent(new w.page.CustomEvent('st-config-changed',
        { detail: JSON.stringify({ key: 'api.key' }) }));
    assert.deepEqual(w.gm['st-config'], { 'api.url': 'https://from-host-a' });
});

/** Anything-goes stand-in for ClientLib/qx: every property and call returns itself. */
function gameStub() {
    const fn = function () {};
    const p = new Proxy(fn, {
        get: (t, k) => (k === Symbol.toPrimitive ? () => 'stub' : k === 'then' ? undefined : p),
        apply: () => p,
        construct: () => p,
    });
    return p;
}

test('dist: empty host gets the config of another host from GM at startup', { skip: !fs.existsSync(DIST) }, async () => {
    const src = fs.readFileSync(DIST, 'utf8');
    const w = makeWorlds({ 'api.url': 'https://from-host-a', 'api.key': 'k1' });
    w.page.ClientLib = gameStub();
    w.page.qx = gameStub();
    w.page.webfrontend = gameStub();
    vm.runInContext(src, w.sandbox);
    for (let i = 0; i < 20 && !w.ls['st-config']; i++) await new Promise(r => setImmediate(r));
    const local = JSON.parse(w.ls['st-config']);
    assert.equal(local['api.url'], 'https://from-host-a');
    assert.equal(local['api.key'], 'k1');
});
