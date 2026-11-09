// ChatManager (plugins/chat-manager.js): history length, growing old buffers, close at start,
// chat width and compact mode (5.49.0; the drag handle itself was tested live).
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

/** The docked chat window as far as the plugin uses it (5.49.0): width props, docked, widget tree. */
class FakeChat {
    constructor() {
        this.docked = true; this.width = 346; this.minWidth = 122; this.maxWidth = 624; this.widthAvailable = 346;
        this.label = { classname: 'qx.ui.basic.Label', font: 'default', getRich: () => true, getSelectable: () => true,
            getFont() { return this.font; }, setFont(f) { this.font = f; }, resetFont() { this.font = undefined; } };
        this.pane = { classname: 'qx.ui.container.Composite', _getChildren: () => [this.label] };
    }
    isVisible() { return true; }
    getChatWidget() { return { showMessage() {} }; }
    getDocked() { return this.docked; }
    setDocked(v) { this.docked = v; if (!v) { this.width = 500; this.maxWidth = 1024; } }
    getWidthAvailable() { return this.widthAvailable; }
    setWidthAvailable(n) { this.widthAvailable = n; if (this.docked) this.width = Math.max(122, n); }   // the game's apply
    set(map) { Object.assign(this, map); }
    setWidth(w) { this.width = w; }
    setMaxWidth(w) { this.maxWidth = w; }
    getMinWidth() { return this.minWidth; }
    setMinWidth(w) { this.minWidth = w; }
    getWidth() { return this.width; }
    getBounds() { return { left: 0, top: 790, width: this.width, height: 185 }; }
    _getChildren() { return [this.pane]; }
}

class FakeFont {
    constructor(size, family) { this.size = size; this.family = family; }
    setLineHeight(v) { this.lineHeight = v; }
}

let toggled = [];
let resized = 0;
let chat = null;
function setup({ visible = true } = {}) {
    toggled = [];
    resized = 0;
    chat = new FakeChat();
    globalThis.webfrontend = {
        gui: { chat: { ChatWidget: { recvbufsize: 64, recvbufsizeGlobal: 1000, sentbufsize: 32, sender: { system: 'system' } } } },
        phe: { cnc: { RingArray } },
    };
    RingArray.prototype.push = function (x) { if (this.__n < this.__dL.length) this.__dL[this.__n++] = x; };
    chat.isVisible = () => visible;
    globalThis.qx = {
        bom: { Font: FakeFont },
        theme: { manager: { Font: { getInstance: () => ({ resolve: () => ({ getFamily: () => ['Segoe UI'] }) }) } } },
        core: { Init: { getApplication: () => ({
        getChat: () => chat,
        toggleChat: (v) => toggled.push(v),
        triggerDesktopResize: () => { resized++; },
    }) } } };
    webfrontend.gui.chat.ChatWindow = { dimension: { dock_width: 122, dock_maxwidth: 624 } };
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

test('chatWidth: null / reset = game default; clamped to 200..half the screen', () => {
    for (const v of [null, undefined, '', 'null', 'reset', 'default', 'none', 'abc']) assert.equal(mod.chatWidth(v, 1920), null);
    assert.equal(mod.chatWidth(100, 1920), 200);
    assert.equal(mod.chatWidth(5000, 1920), 960);
    assert.equal(mod.chatWidth('350', 1920), 350);
    assert.equal(mod.chatWidth(300, 300), 200);                 // tiny screen: never below 200
});

test('width: set after every game width call (docked only), config hook, reset on stop', async () => {
    setup();
    const hooks = {};
    const cli = { onConfigSet: (k, h) => { hooks[k] = h; } };
    const cfg = fakeConfig({ 'chatmanager.width': 400 });
    const p = new mod.ChatManager(cfg, cli);
    const restore = quiet();
    await p.start();
    p._startLayout();                                          // in the game: once the chat DOM is found
    assert.equal(chat.width, 400);
    chat.setWidthAvailable(182);                               // the game's _onDesktopResize
    assert.equal(chat.width, 400);
    hooks['chatmanager.width'](700);
    assert.deepEqual([chat.width, chat.minWidth, chat.maxWidth, cfg.get('chatmanager.width')], [700, 700, 700, 700]);   // fixed: hover cannot grow it
    assert.ok(resized > 0);
    chat.setDocked(false);                                     // floating: the game's own size
    assert.deepEqual([chat.width, chat.minWidth, chat.maxWidth], [500, 122, 1024]);
    chat.setDocked(true);
    chat.setWidthAvailable(346);
    assert.equal(chat.width, 700);
    hooks['chatmanager.width']('null');                        // back to the game default
    assert.deepEqual([chat.width, chat.minWidth, chat.maxWidth, cfg.get('chatmanager.width')], [346, 122, 624, null]);
    hooks['chatmanager.width'](50);
    assert.equal(chat.width, 200);
    p.stop();
    restore();
    assert.equal(Object.prototype.hasOwnProperty.call(chat, 'setWidthAvailable'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(chat, 'setDocked'), false);
    assert.deepEqual([chat.width, chat.minWidth, chat.maxWidth], [346, 122, 624]);
});

test('compact: chat Label gets a 10px font, own font back when switched off or on stop', async () => {
    setup();
    const hooks = {};
    const cfg = fakeConfig({ 'chatmanager.compact': true });
    const p = new mod.ChatManager(cfg, { onConfigSet: (k, h) => { hooks[k] = h; } });
    const restore = quiet();
    await p.start();
    p._startLayout();
    assert.equal(chat.label.font.size, 10);
    assert.equal(chat.label.font.lineHeight, 1.15);
    hooks['chatmanager.compact'](false);
    assert.equal(chat.label.font, 'default');
    assert.equal(cfg.get('chatmanager.compact'), false);
    hooks['chatmanager.compact'](true);
    assert.equal(chat.label.font.size, 10);
    p.stop();
    restore();
    assert.equal(chat.label.font, 'default');
    assert.equal(chat.width, 346);                             // no width set: untouched
});
