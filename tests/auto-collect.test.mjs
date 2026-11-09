// AutoCollect (plugins/auto-collect.js): collect the resource packages of every own base.
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
        stdin: {
            contents: `export * from './plugins/auto-collect.js'; export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

function fakeConfig(data = {}) {
    return {
        data,
        get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; },
        set(k, v) { data[k.toLowerCase()] = v; },
    };
}

function city(id, name, { own = true, ghost = false, packages = true, api = true, throws = false } = {}) {
    const c = {
        id, collected: 0, packages,
        IsOwnBase: () => own, get_IsGhostMode: () => ghost, get_Name: () => name,
    };
    if (api) {
        c.CanCollectResources = () => { if (throws) throw new Error('boom'); return c.packages; };
        c.CollectAllResources = () => { c.collected++; c.packages = false; };
    }
    return c;
}

const chat = [];
function setup(cities) {
    chat.length = 0;
    const byId = Object.fromEntries(cities.map(c => [c.id, c]));
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => ({ get_Cities: () => ({ get_AllCities: () => ({ d: byId }) }) }) } },
    };
    globalThis.qx = { core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ showMessage: (m) => chat.push(m) }) }) }) } } };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => {
    const l = console.log, w = console.warn, e = console.error;
    console.log = console.warn = console.error = () => {};
    return () => { console.log = l; console.warn = w; console.error = e; };
};

test('collect: only own, non-ghost bases with packages; one chat line with the count', () => {
    const a = city(1, 'A');
    const b = city(2, 'B', { packages: false });
    const g = city(3, 'Ghost', { ghost: true });
    const f = city(4, 'Foreign', { own: false });
    const d = city(5, 'D');
    setup([a, b, g, f, d]);
    const p = new mod.AutoCollect(fakeConfig());
    const restore = quiet();
    const res = p.collect();
    restore();
    assert.deepEqual(res, ['A', 'D']);
    assert.equal(a.collected, 1);
    assert.equal(b.collected, 0);
    assert.equal(g.collected, 0);
    assert.equal(f.collected, 0);
    assert.equal(chat.length, 1);
    assert.match(chat[0], /Collected packages on 2 bases/);
});

test('collect: nothing to collect -> no chat line', () => {
    setup([city(1, 'A', { packages: false })]);
    const p = new mod.AutoCollect(fakeConfig());
    assert.deepEqual(p.collect(), []);
    assert.equal(chat.length, 0);
});

test('collect: missing API or an error on one base does not stop the others', () => {
    const ok = city(3, 'OK');
    setup([city(1, 'Old', { api: false }), city(2, 'Bad', { throws: true }), ok]);
    const p = new mod.AutoCollect(fakeConfig());
    const restore = quiet();
    const res = p.collect();
    restore();
    assert.deepEqual(res, ['OK']);
    assert.equal(ok.collected, 1);
});

test('intervalMin: default 5, minimum 1, invalid falls back', () => {
    const cfg = fakeConfig();
    const p = new mod.AutoCollect(cfg);
    assert.equal(p.intervalMin(), 5);
    cfg.set('autocollect.interval', 10);
    assert.equal(p.intervalMin(), 10);
    cfg.set('autocollect.interval', 0.2);
    assert.equal(p.intervalMin(), 1);
    cfg.set('autocollect.interval', 'abc');
    assert.equal(p.intervalMin(), 5);
});

test('plugin metadata: off by default, kebab name auto-collect', () => {
    const p = new mod.AutoCollect(fakeConfig());
    assert.equal(p.name, 'AutoCollect');
    assert.equal(p.defaultEnabled, false);
    assert.ok(p.description.length > 0);
});
