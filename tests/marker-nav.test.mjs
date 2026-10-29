// MarkerNav (plugins/marker-nav.js): own map markers in a panel, click to jump.
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
        stdin: { contents: `export * from './plugins/marker-nav.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

function el(tag) {
    const listeners = [];
    const node = {
        tag, style: {}, children: [], parent: null, dataset: {}, _html: '',
        addEventListener(type, fn) { listeners.push({ type, fn }); },
        removeEventListener() {},
        appendChild(c) { c.parent = node; node.children.push(c); return c; },
        append(...cs) { for (const c of cs) node.appendChild(c); },
        remove() { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = null; },
        contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
        set innerHTML(v) { node._html = v; node.renders = (node.renders || 0) + 1; },
        get innerHTML() { return node._html; },
        querySelectorAll() { return []; },
    };
    return node;
}

function setup(state) {
    const body = el('body');
    globalThis.document = { body, createElement: el, addEventListener() {}, removeEventListener() {} };
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
    globalThis.ClientLib = { Data: { MainData: { GetInstance: () => ({
        get_Player: () => ({ get_Name: () => 'GhoztMasters' }),
        get_Alliance: () => ({ get_Markers: () => ({ l: state.markers }) }),
    }) } } };
    return body;
}

const marker = (type, by, x, y, extra = {}) => ({
    get_Type: () => type, get_NamePlayerCreated: () => by, get_CoordX: () => x, get_CoordY: () => y, ...extra,
});

const mod = await load();

test('ownMarkers: only the own player, broken markers skipped, text from a known getter', () => {
    const ms = [
        marker(5, 'Other', 1, 1),
        marker(5, 'GhoztMasters', 116, 318),
        { get_NamePlayerCreated: () => { throw new Error('deleted'); } },
        marker(3, 'GhoztMasters', 400, 512, { get_Description: () => ' hub ' }),
    ];
    assert.deepEqual(mod.ownMarkers(ms, 'GhoztMasters'), [
        { x: 116, y: 318, type: 5, text: '' },
        { x: 400, y: 512, type: 3, text: 'hub' },
    ]);
    assert.deepEqual(mod.ownMarkers(ms, ''), []);
    assert.deepEqual(mod.ownMarkers(undefined, 'GhoztMasters'), []);
});

test('markerText: first non-empty string getter, throwing getters ignored', () => {
    assert.equal(mod.markerText({ get_Name: () => { throw new Error('x'); }, get_Title: () => '', get_Text: () => 'Plan B' }), 'Plan B');
    assert.equal(mod.markerText({}), '');
});

test('renderList: type label, coordinates on the row, text escaped, empty message', () => {
    const html = mod.renderList([{ x: 116, y: 318, type: 5, text: '<b>' }, { x: 1, y: 2, type: 3, text: '' }]);
    assert.match(html, /data-x="116" data-y="318"/);
    assert.match(html, /Layout reservation/);
    assert.match(html, /Marker \(type 3\)/);
    assert.match(html, /&lt;b&gt;/);
    assert.match(mod.renderList([]), /no markers/);
});

test('MarkerNav: toolbar item + /st markers; reads only while open, follows changes, no re-render without change', async () => {
    const state = { markers: [marker(5, 'GhoztMasters', 116, 318)] };
    const body = setup(state);
    mock.timers.enable({ apis: ['setInterval'] });
    try {
        const items = [];
        const toolbar = { register: (i) => items.push(i), unregister() {} };
        const cli = { commands: {}, register(name, fn) { this.commands[name] = fn; }, unregister(name) { delete this.commands[name]; } };
        const config = { get: (k, d) => d, set() {} };
        const nav = new mod.MarkerNav(config, toolbar, cli);
        await nav.start();
        assert.equal(items.length, 1);
        assert.equal(items[0].id, 'markernav');

        cli.commands.markers();
        assert.ok(nav.isOpen());
        const content = body.children[0].children[1];
        assert.match(content.innerHTML, /116:318/);
        const renders = content.renders;
        mock.timers.tick(2000);
        assert.equal(content.renders, renders, 'unchanged list: no re-render');

        state.markers.push(marker(5, 'GhoztMasters', 500, 900));
        mock.timers.tick(2000);
        assert.match(content.innerHTML, /500:900/);
        assert.equal(nav.statusText(), 'panel open, 2 marker(s)');

        items[0].onClick();   // close
        assert.ok(!nav.isOpen());
        state.markers = [];
        mock.timers.tick(10000);
        assert.match(content.innerHTML, /500:900/, 'no reads while closed');

        nav.stop();
        assert.equal(cli.commands.markers, undefined);
        assert.equal(body.children.length, 0);
    } finally {
        mock.timers.reset();
        delete globalThis.ClientLib;
    }
});
