// MissionHider (plugins/mission-hider.js): hide / re-hide / show the mission tracker.
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
        stdin: { contents: `export * from './plugins/mission-hider.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

class Bar {
    constructor() { this.visibility = 'visible'; this.listeners = new Map(); this.nextId = 1; }
    getVisibility() { return this.visibility; }
    setVis(v) { this.visibility = v; for (const fn of this.listeners.values()) fn(); }
    exclude() { this.setVis('excluded'); }
    show() { this.setVis('visible'); }
    addListener(ev, fn) { assert.equal(ev, 'changeVisibility'); const id = this.nextId++; this.listeners.set(id, fn); return id; }
    removeListenerById(id) { this.listeners.delete(id); }
}

let resizes = 0;
const chat = [];
function setup({ bar = new Bar(), legacy = false } = {}) {
    resizes = 0;
    chat.length = 0;
    const app = {
        triggerDesktopResize: () => { resizes++; },
        getChat: () => ({ getChatWidget: () => ({ showMessage: (m) => chat.push(m) }) }),
    };
    if (bar) app[legacy ? 'getMissionTracker' : 'getMissionsBar'] = () => bar;
    globalThis.qx = { core: { Init: { getApplication: () => app } } };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
    return bar;
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

test('start excludes the bar and resizes; the game showing it again is undone; stop shows it', async () => {
    const bar = setup();
    const p = new mod.MissionHider(fakeConfig());
    const restore = quiet();
    await p.start();
    assert.equal(bar.visibility, 'excluded');
    assert.equal(resizes, 1);
    assert.match(chat.at(-1), /Mission tracker hidden/);
    assert.equal(p.statusText(), 'mission tracker hidden');
    bar.show();                                   // game shows it again
    assert.equal(bar.visibility, 'excluded');
    p.stop();
    restore();
    assert.equal(bar.visibility, 'visible');
    assert.equal(bar.listeners.size, 0);
    assert.equal(p.statusText(), 'off');
});

test('older client: getMissionTracker fallback', async () => {
    const bar = setup({ legacy: true });
    const p = new mod.MissionHider(fakeConfig());
    const restore = quiet();
    await p.start();
    p.stop();
    restore();
    assert.equal(bar.visibility, 'visible');
    assert.equal(resizes, 2);
});

test('no bar: no crash, status says so', async () => {
    setup({ bar: null });
    const p = new mod.MissionHider(fakeConfig());
    const w = console.warn; console.warn = () => {};
    await p.start();
    console.warn = w;
    assert.equal(p.statusText(), 'mission tracker not found');
    p.stop();
});

test('plugin metadata: off by default', () => {
    const p = new mod.MissionHider(fakeConfig());
    assert.equal(p.name, 'MissionHider');
    assert.equal(p.defaultEnabled, false);
});
