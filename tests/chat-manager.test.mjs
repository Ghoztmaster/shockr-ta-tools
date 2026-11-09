// ChatManager (plugins/chat-manager.js): history length, growing old buffers, close at start.
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
        stdin: { contents: `export * from './plugins/chat-manager.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

/** Like the game's RingArray: obfuscated fields, capacity = internal array length, resize keeps items. */
class RingArray {
    constructor(n) { this.__n = 0; this.__dL = new Array(n); }
    resize(n) { const old = this.__dL.slice(0, this.__n); this.__dL = new Array(n); old.forEach((x, i) => { this.__dL[i] = x; }); }
    push(x) { if (this.__n < this.__dL.length) this.__dL[this.__n++] = x; }
}

let toggled = [];
let resized = 0;
function setup({ visible = true } = {}) {
    toggled = [];
    resized = 0;
    globalThis.webfrontend = {
        gui: { chat: { ChatWidget: { recvbufsize: 64, recvbufsizeGlobal: 1000, sentbufsize: 32, sender: { system: 'system' } } } },
        phe: { cnc: { RingArray } },
    };
    RingArray.prototype.push = function (x) { if (this.__n < this.__dL.length) this.__dL[this.__n++] = x; };
    globalThis.qx = { core: { Init: { getApplication: () => ({
        getChat: () => ({ isVisible: () => visible, getChatWidget: () => ({ showMessage() {} }) }),
        toggleChat: (v) => toggled.push(v),
        triggerDesktopResize: () => { resized++; },
    }) } } };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

test('historyLength: default 512, clamped to 64..512', () => {
    assert.equal(mod.historyLength(fakeConfig()), 512);
    assert.equal(mod.historyLength(fakeConfig({ 'chatmanager.historylength': 10 })), 64);
    assert.equal(mod.historyLength(fakeConfig({ 'chatmanager.historylength': 9999 })), 512);
    assert.equal(mod.historyLength(fakeConfig({ 'chatmanager.historylength': '200' })), 200);
    assert.equal(mod.historyLength(fakeConfig({ 'chatmanager.historylength': 'x' })), 512);
});

test('start: recvbufsize set; old 64-buffers grow on the next message (items kept), others untouched; stop restores', async () => {
    setup();
    const original = RingArray.prototype.push;
    const alliance = new RingArray(64);
    alliance.push('a');
    const global = new RingArray(1000);
    const sent = new RingArray(32);
    const p = new mod.ChatManager(fakeConfig({ 'chatmanager.historylength': 300 }));
    const restore = quiet();
    await p.start();
    assert.equal(webfrontend.gui.chat.ChatWidget.recvbufsize, 300);
    alliance.push('b');
    global.push('g');
    sent.push('s');
    assert.equal(mod.capacity(alliance), 300);
    assert.deepEqual(alliance.__dL.slice(0, 2), ['a', 'b']);
    assert.equal(mod.capacity(global), 1000);
    assert.equal(mod.capacity(sent), 32);
    assert.match(p.statusText(), /history 300 per channel, 1 channel/);
    assert.deepEqual(toggled, []);                     // closeOnStart off
    p.stop();
    restore();
    assert.equal(webfrontend.gui.chat.ChatWidget.recvbufsize, 64);
    assert.equal(RingArray.prototype.push, original);
    assert.equal(p.statusText(), 'off');
});

test('closeOnStart: closes a visible chat at startup, not when already closed', async () => {
    setup();
    const restore = quiet();
    const p = new mod.ChatManager(fakeConfig({ 'chatmanager.closeonstart': true }));
    await p.start();
    p.stop();
    assert.deepEqual(toggled, [false]);
    assert.equal(resized, 1);
    setup({ visible: false });
    const q = new mod.ChatManager(fakeConfig({ 'chatmanager.closeonstart': true }));
    await q.start();
    q.stop();
    restore();
    assert.deepEqual(toggled, []);
});

test('plugin metadata: off by default', () => {
    const p = new mod.ChatManager(fakeConfig());
    assert.equal(p.name, 'ChatManager');
    assert.equal(p.defaultEnabled, false);
});
