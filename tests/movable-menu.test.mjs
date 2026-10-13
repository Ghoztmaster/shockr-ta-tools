// MovableMenu: drag game windows / menu overlays, positions remembered (plugins/movable-menu.js).
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
        stdin: { contents: `export * from './plugins/movable-menu.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

// ─── Fakes ──────────────────────────────────────────────────────────

function emitter() {
    const l = [];
    return {
        addEventListener(type, fn, capture) { l.push({ type, fn, capture }); },
        removeEventListener(type, fn, capture) {
            const i = l.findIndex(x => x.type === type && x.fn === fn && x.capture === capture);
            if (i >= 0) l.splice(i, 1);
        },
        fire(type, ev = {}) { for (const x of [...l]) if (x.type === type) x.fn({ type, button: 0, ...ev }); },
        count(type) { return l.filter(x => x.type === type).length; },
    };
}

function domEl(rect) {
    return { ...emitter(), style: {}, rect, getBoundingClientRect() {
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(this.style.transform || '');
        const dx = m ? Number(m[1]) : 0;
        const dy = m ? Number(m[2]) : 0;
        return { left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height };
    } };
}

function setup() {
    class Widget {
        constructor(classname, rect) {
            this.classname = classname;
            this.dom = domEl(rect);
            this.listeners = new Map();
            this.nextId = 1;
            this.visible = true;
        }
        addListener(type, fn, ctx) {
            const id = this.nextId++;
            this.listeners.set(id, { type, fn: fn.bind(ctx) });
            return id;
        }
        removeListenerById(id) { this.listeners.delete(id); }
        fire(type) { for (const x of this.listeners.values()) if (x.type === type) x.fn(); }
        isVisible() { return this.visible; }
        getContainerElement() { return { getDomElement: () => this.dom }; }
    }
    class Window extends Widget {
        constructor(classname, movable = true) {
            super(classname, { left: 100, top: 50, width: 400, height: 300 });
            this.movable = movable;
            this.props = { left: 100, top: 50 };
        }
        getMovable() { return this.movable; }
        setMovable(v) { this.movable = v; }
        getLayoutProperties() { return { ...this.props }; }
        getBounds() { return { width: 400, height: 300 }; }
        moveTo(left, top) { this.props = { left, top }; }
        getCaption() { return 'Window'; }
    }
    class MenuOverlayWidget extends Widget {
        constructor(classname) { super(classname, { left: 200, top: 40, width: 600, height: 625 }); }
    }
    const rootKids = [];
    const deskKids = [];
    globalThis.qx = {
        ui: { window: { Window } },
        core: { Init: { getApplication: () => ({
            getRoot: () => ({ getChildren: () => rootKids }),
            getDesktop: () => ({ getChildren: () => deskKids }),
        }) } },
    };
    globalThis.webfrontend = { gui: { MenuOverlayWidget } };
    const doc = emitter();
    doc.body = { style: {} };
    globalThis.document = doc;
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
    const store = {};
    const config = {
        get: (k, d) => (k.toLowerCase() in store ? JSON.parse(store[k.toLowerCase()]) : d),
        set: (k, v) => { store[k.toLowerCase()] = JSON.stringify(v); },
    };
    return { Window, MenuOverlayWidget, rootKids, deskKids, doc, config, store };
}

const tick = () => new Promise(r => setTimeout(r, 5));

/** User drags a qx window's caption: mousedown, qx moves it, mouseup. */
async function dragWindow(env, win, left, top) {
    win.dom.fire('mousedown');
    win.moveTo(left, top);
    env.doc.fire('mouseup');
    await tick();
}

/** User drags an overlay from (x, y) by (dx, dy). */
function dragOverlay(env, ov, x, y, dx, dy) {
    ov.dom.fire('mousedown', { clientX: x, clientY: y });
    env.doc.fire('mousemove', { clientX: x + dx, clientY: y + dy });
    env.doc.fire('mouseup');
}

// ─── Tests ──────────────────────────────────────────────────────────

test('clampPosition keeps a panel reachable', () => {
    assert.deepEqual(mod.clampPosition(100, 50, 400, 1600, 900), { left: 100, top: 50 });
    assert.deepEqual(mod.clampPosition(-1000, -20, 400, 1600, 900), { left: -320, top: 0 });
    assert.deepEqual(mod.clampPosition(5000, 5000, 400, 1600, 900), { left: 1520, top: 870 });
});

test('widgetId: class, generic overlay window gets its caption without counters', () => {
    assert.equal(mod.widgetId({ classname: 'webfrontend.gui.alliance.Foo' }), 'webfrontend.gui.alliance.Foo');
    assert.equal(mod.widgetId({ classname: 'webfrontend.gui.OverlayWindow', getCaption: () => 'Mail (3)' }),
        'webfrontend.gui.OverlayWindow:Mail');
});

test('game window: made movable, position saved after a drag and restored on reopen', async () => {
    const env = setup();
    const win = new env.Window('webfrontend.gui.info.Foo', false);
    env.rootKids.push(win);
    const p = new mod.MovableMenu(env.config);
    await p.start();
    try {
        assert.equal(win.movable, true);
        await dragWindow(env, win, 300, 200);
        assert.deepEqual(env.config.get('MovableMenu.positions')['webfrontend.gui.info.Foo'], { left: 300, top: 200 });
        win.moveTo(100, 50);                 // game re-centres it on reopen
        win.fire('appear');
        assert.deepEqual(win.props, { left: 300, top: 200 });
        // a click without moving does not save anything new
        win.dom.fire('mousedown');
        env.doc.fire('mouseup');
        await tick();
        assert.deepEqual(env.config.get('MovableMenu.positions')['webfrontend.gui.info.Foo'], { left: 300, top: 200 });
    } finally {
        p.stop();
    }
    assert.equal(win.movable, false, 'stop() restores the game\'s movable flag');
    assert.equal(win.listeners.size, 0);
    assert.equal(win.dom.count('mousedown'), 0);
});

test('other scripts\' windows (TABS, MehrStrom) are never touched', async () => {
    const env = setup();
    const win = new env.Window('qx.ui.window.Window', false);
    const tabs = new env.Window('TABS.GUI.Window.Stats', false);
    env.rootKids.push(win, tabs);
    const p = new mod.MovableMenu(env.config);
    await p.start();
    p.stop();
    assert.equal(win.movable, false);
    assert.equal(tabs.movable, false);
    assert.equal(win.listeners.size + tabs.listeners.size, 0);
});

test('saved window position off screen is clamped', async () => {
    const env = setup();
    env.config.set('MovableMenu.positions', { 'webfrontend.gui.info.Foo': { left: 9000, top: -50 } });
    const win = new env.Window('webfrontend.gui.info.Foo');
    env.deskKids.push(win);
    const p = new mod.MovableMenu(env.config);
    await p.start();
    p.stop();
    assert.deepEqual(win.props, { left: 1520, top: 0 });
});

test('menu overlay: header drag shifts + saves, body drag and plain clicks do nothing', async () => {
    const env = setup();
    const ov = new env.MenuOverlayWidget('webfrontend.gui.alliance.AllianceOverlay');
    env.deskKids.push(ov);
    const p = new mod.MovableMenu(env.config);
    await p.start();
    try {
        dragOverlay(env, ov, 300, 300, 50, 50);            // body, below the header strip
        assert.equal(ov.dom.style.transform || '', '');
        dragOverlay(env, ov, 300, 50, 2, 1);               // header, below threshold = click
        assert.equal(ov.dom.style.transform || '', '');
        dragOverlay(env, ov, 300, 50, -150, 60);           // header drag
        assert.equal(ov.dom.style.transform, 'translate(-150px, 60px)');
        assert.deepEqual(env.config.get('MovableMenu.positions')['webfrontend.gui.alliance.AllianceOverlay'],
            { dx: -150, dy: 60 });
        dragOverlay(env, ov, 160, 110, 10, 0);             // second drag continues from there
        assert.equal(ov.dom.style.transform, 'translate(-140px, 60px)');
        assert.equal(env.doc.count('mousemove') + env.doc.count('mouseup'), 0, 'drag listeners cleaned up');
    } finally {
        p.stop();
    }
    assert.equal(ov.dom.style.transform, '', 'stop() puts the overlay back');
    assert.equal(ov.dom.count('mousedown'), 0);
});

test('menu overlay: saved offset applied on appear, also after a restart', async () => {
    const env = setup();
    env.config.set('MovableMenu.positions', { 'webfrontend.gui.mail.Overlay': { dx: 100, dy: 20 } });
    const ov = new env.MenuOverlayWidget('webfrontend.gui.mail.Overlay');
    ov.visible = false;
    env.deskKids.push(ov);
    const p = new mod.MovableMenu(env.config);
    await p.start();
    assert.equal(ov.dom.style.transform || '', '');
    ov.visible = true;
    ov.fire('appear');
    assert.equal(ov.dom.style.transform, 'translate(100px, 20px)');
    p.stop();
    await p.start();                                       // /st plugin enable again
    try {
        dragOverlay(env, ov, 300, 50, 10, 10);
        assert.equal(ov.dom.style.transform, 'translate(110px, 30px)');
    } finally {
        p.stop();
    }
});

test('no qx / no game classes: start() does not throw', async () => {
    const env = setup();
    delete globalThis.webfrontend;
    globalThis.qx = {};
    const p = new mod.MovableMenu(env.config);
    await p.start();
    p.stop();
    assert.equal(p.running, false);
});
