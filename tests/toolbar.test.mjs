// Toolbar (lib/toolbar.js), drag (lib/drag.js) and TargetBoard (plugins/target-board.js), 5.26.0.
// Run: npm test
import { test, mock } from 'node:test';
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
            contents: `export * from './lib/toolbar.js'; export * from './lib/drag.js'; export * from './plugins/target-board.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

// ─── Minimal DOM ────────────────────────────────────────────────────

function emitter() {
    const l = [];
    return {
        addEventListener(type, fn, capture) { l.push({ type, fn, capture }); },
        removeEventListener(type, fn, capture) {
            const i = l.findIndex(x => x.type === type && x.fn === fn && !!x.capture === !!capture);
            if (i >= 0) l.splice(i, 1);
        },
        fire(type, ev = {}) {
            for (const x of [...l]) if (x.type === type) x.fn({ type, button: 0, preventDefault() {}, stopPropagation() {}, ...ev });
        },
        count(type) { return l.filter(x => x.type === type).length; },
    };
}

function el(tag) {
    const node = {
        ...emitter(), tag, style: {}, children: [], parent: null, dataset: {}, _html: '',
        appendChild(c) { c.parent = node; node.children.push(c); return c; },
        append(...cs) { for (const c of cs) node.appendChild(c); },
        remove() { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = null; },
        contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
        get childElementCount() { return node.children.length; },
        set innerHTML(v) { node._html = v; node.children = []; },
        get innerHTML() { return node._html; },
        querySelectorAll() { return []; },
        getBoundingClientRect() {
            const left = parseInt(node.style.left, 10) || 0;
            const top = parseInt(node.style.top, 10) || 0;
            return { left, top, width: 32, height: 32, bottom: top + 32, right: left + 32 };
        },
    };
    return node;
}

function setupDom() {
    const body = el('body');
    const document = { ...emitter(), body, createElement: el };
    globalThis.document = document;
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
    return document;
}

function fakeConfig(data = {}) {
    return {
        data,
        get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; },
        set(k, v) { data[k.toLowerCase()] = v; },
    };
}

const mod = await load();

// ─── drag.js ────────────────────────────────────────────────────────

test('clampPosition keeps the element reachable', () => {
    const vp = { w: 1000, h: 800 };
    assert.deepEqual(mod.clampPosition({ x: -50, y: 5000 }, { w: 32, h: 32 }, vp), { x: 0, y: 776 });
    assert.deepEqual(mod.clampPosition({ x: 100.4, y: 50.6 }, { w: 32, h: 32 }, vp), { x: 100, y: 51 });
});

test('loadPosition: saved position, else the fallback', () => {
    assert.deepEqual(mod.loadPosition(fakeConfig(), 'toolbar', { x: 1, y: 2 }), { x: 1, y: 2 });
    assert.deepEqual(mod.loadPosition(fakeConfig({ 'toolbar.x': 10, 'toolbar.y': 20 }), 'toolbar', { x: 1, y: 2 }), { x: 10, y: 20 });
});

test('makeDraggable: a press without movement is a click, a drag saves the position', () => {
    const document = setupDom();
    const config = fakeConfig();
    const btn = el('div');
    btn.style.left = '80px';
    btn.style.top = '46px';
    let clicks = 0;
    mod.makeDraggable(btn, btn, { config, prefix: 'toolbar', onClick: () => clicks++ });

    btn.fire('mousedown', { clientX: 90, clientY: 50 });
    document.fire('mouseup');
    assert.equal(clicks, 1);
    assert.equal(config.get('toolbar.x'), undefined);
    assert.equal(document.count('mousemove'), 0, 'listeners removed after release');

    btn.fire('mousedown', { clientX: 90, clientY: 50 });
    document.fire('mousemove', { clientX: 190, clientY: 150 });
    document.fire('mouseup');
    assert.equal(clicks, 1, 'a drag is not a click');
    assert.equal(config.get('toolbar.x'), 180);
    assert.equal(config.get('toolbar.y'), 146);
});

// ─── toolbar.js ─────────────────────────────────────────────────────

test('toolbar: register / unregister / isAvailable', () => {
    setupDom();
    const tb = new mod.Toolbar(fakeConfig(), { onConfig() {} });
    let available = false;
    tb.register({ id: 'a', icon: '', label: 'A', onClick() {} });
    tb.register({ id: 'b', icon: '', label: 'B', onClick() {}, isAvailable: () => available });
    tb.register({ id: 'a', icon: '', label: 'A2', onClick() {} });   // same id replaces
    assert.deepEqual(tb.visibleItems().map(i => i.label), ['A2']);
    available = true;
    assert.deepEqual(tb.visibleItems().map(i => i.id), ['a', 'b']);
    tb.unregister('a');
    assert.deepEqual(tb.visibleItems().map(i => i.id), ['b']);
});

test('toolbar: grid always has the Config button; item click runs and closes; Escape closes', () => {
    const document = setupDom();
    let configOpened = 0;
    let ran = 0;
    const tb = new mod.Toolbar(fakeConfig(), { onConfig: () => configOpened++ });
    tb.start();
    const button = document.body.children[0];

    // nothing registered: only Config
    button.fire('mousedown', { clientX: 1, clientY: 1 });
    document.fire('mouseup');
    assert.ok(tb.isOpen());
    const grid = document.body.children[1];
    assert.equal(grid.children.length, 1);
    grid.children[0].fire('click');
    assert.equal(configOpened, 1);
    assert.ok(!tb.isOpen());
    assert.equal(document.count('keydown'), 0, 'no listeners while closed');

    tb.register({ id: 'x', icon: '<svg/>', label: () => 'X', onClick: () => ran++ });
    tb.open();
    const cells = grid.children[0];
    assert.equal(cells.children.length, 1);
    assert.equal(cells.children[0].title, 'X');
    cells.children[0].fire('click');
    assert.equal(ran, 1);
    assert.ok(!tb.isOpen());

    tb.open();
    document.fire('keydown', { key: 'Escape' });
    assert.ok(!tb.isOpen());

    tb.open();
    document.fire('mousedown', { target: el('div') });   // outside
    assert.ok(!tb.isOpen());
});

// ─── target-board.js ────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const sec = (msAgo) => Math.floor((NOW - msAgo) / 1000);

test('sortTargets: most watchers first, then most recent; empty targets dropped', () => {
    const rows = mod.sortTargets([
        { targetId: 1, watchers: [{ timestamp: sec(60000) }] },
        { targetId: 2, watchers: [{ timestamp: sec(600000) }, { timestamp: sec(300000) }] },
        { targetId: 3, watchers: [{ timestamp: sec(1000) }] },
        { targetId: 4, watchers: [] },
    ]);
    assert.deepEqual(rows.map(r => r.targetId), [2, 3, 1]);
});

test('relativeTime: now / minutes / hours', () => {
    assert.equal(mod.relativeTime(NOW - 30000, NOW), 'now');
    assert.equal(mod.relativeTime(NOW - 2 * 60000, NOW), '2 min');
    assert.equal(mod.relativeTime(NOW - 75 * 60000, NOW), '1 h');
});

test('renderTable: orange row at 2+ watchers, coordinates on the row, names escaped', () => {
    const html = mod.renderTable([
        { targetName: 'Camp', targetX: 400, targetY: 512, targetLevel: 45.7,
          watchers: [{ playerName: 'A<b>', timestamp: sec(60000) }, { playerName: 'B', timestamp: sec(120000) }] },
        { targetName: 'Base', targetX: 1, targetY: 2, targetLevel: 30, watchers: [{ playerName: 'C', timestamp: sec(0) }] },
    ], NOW);
    assert.match(html, /data-x="400" data-y="512"[^>]*background:#3a2e14/);
    assert.doesNotMatch(html, /data-x="1" data-y="2"[^>]*background:#3a2e14/);
    assert.match(html, /L45/);
    assert.match(html, /A&lt;b&gt;, B/);
    assert.match(html, /400:512/);
    assert.match(mod.renderTable([], NOW), /Nobody/);
});

test('TargetBoard: requests only while open, every 20 s; no toolbar item without a server', async () => {
    setupDom();
    globalThis.ClientLib = { Data: { MainData: { GetInstance: () => ({ get_Server: () => ({ get_WorldId: () => 477 }) }) } } };
    mock.timers.enable({ apis: ['setInterval'] });
    try {
        const calls = [];
        const api = {
            isConfigured: true,
            request: async (method, p) => { calls.push(`${method} ${p}`); return { targets: [] }; },
        };
        const items = [];
        const toolbar = { register: (i) => items.push(i), unregister() {} };
        const cli = { commands: {}, register(name, fn) { this.commands[name] = fn; } };
        const board = new mod.TargetBoard(fakeConfig(), api, toolbar, cli);
        await board.start();
        assert.equal(items.length, 1);
        assert.ok(items[0].isAvailable());
        api.isConfigured = false;
        assert.ok(!items[0].isAvailable());
        api.isConfigured = true;

        assert.equal(calls.length, 0, 'nothing before the panel opens');
        cli.commands.targets();
        await Promise.resolve();
        assert.deepEqual(calls, ['GET /api/target-watch/477']);
        mock.timers.tick(20000);
        await Promise.resolve();
        assert.equal(calls.length, 2);

        board.toggle();   // close
        assert.ok(!board.isOpen());
        mock.timers.tick(60000);
        await Promise.resolve();
        assert.equal(calls.length, 2, 'no requests while closed');
    } finally {
        mock.timers.reset();
        delete globalThis.ClientLib;
    }
});
