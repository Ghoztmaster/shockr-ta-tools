// PluginManager (lib/plugin-manager.js), PluginPanel (lib/plugin-panel.js) and the
// toolbar's Plugins button, 5.28.0.
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
            contents: `export * from './lib/plugin-manager.js'; export * from './lib/plugin-panel.js'; export * from './lib/toolbar.js'; export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        define: { __ST_PLUGIN_SHORT__: JSON.stringify({ Alpha: { en: 'Alpha short', nl: 'Alpha kort' } }) },
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
        ...emitter(), tag, style: {}, children: [], parent: null, dataset: {}, _html: '', textContent: '',
        appendChild(c) { c.parent = node; node.children.push(c); return c; },
        append(...cs) { for (const c of cs) node.appendChild(c); },
        insertBefore(c, ref) { c.parent = node; const i = node.children.indexOf(ref); node.children.splice(i < 0 ? 0 : i, 0, c); return c; },
        get firstChild() { return node.children[0] || null; },
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

function setupDom(h = 900) {
    const body = el('body');
    const document = { ...emitter(), body, createElement: el };
    globalThis.document = document;
    globalThis.window = { innerWidth: 1600, innerHeight: h };
    return document;
}

function fakeConfig(data = {}) {
    return {
        data,
        get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; },
        set(k, v) { data[k.toLowerCase()] = v; },
    };
}

function fakePlugin(name, extra = {}) {
    return {
        name, running: false, starts: 0, stops: 0, description: `${name} long`,
        async start() { this.starts++; this.running = true; },
        stop() { this.stops++; this.running = false; },
        ...extra,
    };
}

/** All text in a subtree (textContent of every node). */
function texts(node) {
    return [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

// ─── PluginManager ──────────────────────────────────────────────────

test('setEnabled: starts / stops live, stores the state and confirms in the chat', async () => {
    const said = [];
    const config = fakeConfig();
    const p = fakePlugin('Alpha');
    const m = new mod.PluginManager(config, [p], (s) => said.push(s));

    assert.equal(await m.setEnabled(p, true), true);
    assert.equal(p.running, true);
    assert.equal(config.get('Alpha.enabled'), true);
    assert.match(said.pop(), /Alpha enabled/);

    await m.setEnabled(p, true);
    assert.equal(p.starts, 1, 'already running: not started twice');

    await m.setEnabled(p, false);
    assert.equal(p.running, false);
    assert.equal(config.get('Alpha.enabled'), false);
    assert.match(said.pop(), /Alpha disabled/);
});

test('setEnabled: a failing start is reported, undone and not stored; the next enable retries', async () => {
    const said = [];
    const config = fakeConfig();
    let fail = true;
    const p = fakePlugin('Beta', {
        async start() { this.running = true; if (fail) throw new Error('boom'); },
    });
    const m = new mod.PluginManager(config, [p], (s) => said.push(s));
    const err = console.error;
    console.error = () => {};
    try {
        assert.equal(await m.setEnabled(p, true), false);
    } finally {
        console.error = err;
    }
    assert.equal(p.running, false, 'stopped again, so a retry is possible');
    assert.equal(p.stops, 1);
    assert.equal(config.get('Beta.enabled'), undefined);
    assert.deepEqual(said, ['[ST] ⚠ Beta failed to start: boom']);

    fail = false;
    assert.equal(await m.setEnabled(p, true), true);
    assert.equal(p.running, true);
});

test('setEnabled: a plugin with an info-panel block says it shows after reselecting', async () => {
    const said = [];
    const p = fakePlugin('Wavy', { appearsOnSelect: true });
    const m = new mod.PluginManager(fakeConfig(), [p], (s) => said.push(s));
    await m.setEnabled(p, true);
    assert.deepEqual(said, ['[ST] Wavy enabled', '[ST] Wavy: visible after selecting the object again']);
    said.length = 0;
    await m.setEnabled(p, false);
    assert.deepEqual(said, ['[ST] Wavy disabled'], 'no hint when turning off');
});

test('find / offered / isEnabled', () => {
    const parked = fakePlugin('STABS', { parked: true });
    const off = fakePlugin('RepairGuard', { defaultEnabled: false });
    const m = new mod.PluginManager(fakeConfig({ 'repairguard.enabled': true }), [off, parked], () => {});
    assert.equal(m.find('repair-guard'), off);
    assert.equal(m.find('repair_guard'), off);
    assert.equal(m.find('nope'), null);
    assert.deepEqual(m.offered().map(p => p.name), ['RepairGuard']);
    assert.equal(m.isEnabled(off), true, 'stored value beats defaultEnabled');
    assert.equal(new mod.PluginManager(fakeConfig(), [off], () => {}).isEnabled(off), false);
});

test('excludes: enabling one turns the other off first (stopped + stored off), both directions, with a chat line', async () => {
    const said = [];
    const config = fakeConfig();
    const guard = fakePlugin('RepairGuard', { defaultEnabled: false, excludes: ['AutoRepair'] });
    const auto = fakePlugin('AutoRepair', { defaultEnabled: false, excludes: ['RepairGuard'], yieldsOnConflict: true });
    const m = new mod.PluginManager(config, [guard, auto], (s) => said.push(s));

    await m.setEnabled(guard, true);
    said.length = 0;
    assert.equal(await m.setEnabled(auto, true), true);
    assert.equal(guard.running, false, 'RepairGuard stopped');
    assert.equal(config.get('RepairGuard.enabled'), false, 'and stored off');
    assert.equal(auto.running, true);
    assert.deepEqual(said, ['[ST] RepairGuard disabled', '[ST] RepairGuard turned off — cannot run together with AutoRepair', '[ST] AutoRepair enabled']);

    said.length = 0;
    await m.setEnabled(guard, true);
    assert.equal(auto.running, false);
    assert.equal(config.get('AutoRepair.enabled'), false);
    assert.equal(guard.running, true);
    assert.match(said[1], /AutoRepair turned off — cannot run together with RepairGuard/);

    said.length = 0;
    await m.setEnabled(guard, false);
    await m.setEnabled(auto, true);
    assert.deepEqual(said, ['[ST] RepairGuard disabled', '[ST] AutoRepair enabled'], 'other already off: no extra line');
});

test('resolveConflicts: both stored on at startup -> the yielding one (AutoRepair) is stored off, nothing started', () => {
    const said = [];
    const config = fakeConfig({ 'repairguard.enabled': true, 'autorepair.enabled': true });
    const guard = fakePlugin('RepairGuard', { defaultEnabled: false, excludes: ['AutoRepair'] });
    const auto = fakePlugin('AutoRepair', { defaultEnabled: false, excludes: ['RepairGuard'], yieldsOnConflict: true });
    const m = new mod.PluginManager(config, [guard, auto], (s) => said.push(s));
    assert.deepEqual(m.resolveConflicts(), ['AutoRepair']);
    assert.equal(m.isEnabled(auto), false);
    assert.equal(m.isEnabled(guard), true, 'RepairGuard wins');
    assert.equal(auto.starts + guard.starts, 0);
    assert.deepEqual(said, ['[ST] AutoRepair turned off — cannot run together with RepairGuard']);
    said.length = 0;
    assert.deepEqual(m.resolveConflicts(), [], 'no conflict left');
    config.set('RepairGuard.enabled', false);
    config.set('AutoRepair.enabled', true);
    assert.deepEqual(new mod.PluginManager(config, [guard, auto], () => {}).resolveConflicts(), [], 'only AutoRepair on: stays on');
});

test('menu: all plugins by default; hide / show stored as a list in menu.hidden', () => {
    const config = fakeConfig();
    const a = fakePlugin('Alpha');
    const b = fakePlugin('Beta');
    const m = new mod.PluginManager(config, [a, b, fakePlugin('STABS', { parked: true })], () => {});
    assert.deepEqual(m.menuPlugins().map(p => p.name), ['Alpha', 'Beta']);
    m.setInMenu(a, false);
    m.setInMenu(a, false);
    assert.deepEqual(config.get('menu.hidden'), ['Alpha'], 'no duplicates');
    assert.deepEqual(m.menuPlugins().map(p => p.name), ['Beta']);
    m.setInMenu(a, true);
    assert.deepEqual(config.get('menu.hidden'), []);
    assert.deepEqual(m.menuPlugins().map(p => p.name), ['Alpha', 'Beta'], 'order kept');
    config.set('menu.hidden', 'garbage');
    assert.equal(m.inMenu(a), true, 'a bad stored value hides nothing');
});

// ─── PluginPanel ────────────────────────────────────────────────────

test('shortText: info-page text in the active language, else English, else the description', () => {
    assert.equal(mod.shortText({ name: 'Alpha' }), 'Alpha short');
    mod.initI18n(fakeConfig({ language: 'nl' }));
    assert.equal(mod.shortText({ name: 'Alpha' }), 'Alpha kort');
    mod.initI18n(fakeConfig({ language: 'de' }));
    assert.equal(mod.shortText({ name: 'Alpha' }), 'Alpha short');
    mod.initI18n(fakeConfig({ language: 'en' }));
    assert.equal(mod.shortText({ name: 'Other', description: 'own text' }), 'own text');
});

test('placement: below the button with a capped list; above when there is more room there', () => {
    assert.deepEqual(mod.placement({ top: 46, bottom: 86 }, 1000), { below: true, maxHeight: 480 });
    assert.deepEqual(mod.placement({ top: 46, bottom: 86 }, 600), { below: true, maxHeight: 462 });
    assert.deepEqual(mod.placement({ top: 700, bottom: 740 }, 800), { below: false, maxHeight: 480 });
    assert.equal(mod.placement({ top: 10, bottom: 50 }, 100).maxHeight, 80, 'never below a usable minimum');
});

test('panel: one row per menu plugin; the switch toggles via the manager and redraws', async () => {
    const document = setupDom();
    const said = [];
    const a = fakePlugin('Alpha');
    const b = fakePlugin('Beta', { running: true });
    const config = fakeConfig({ 'menu.hidden': ['Beta'] });
    const m = new mod.PluginManager(config, [a, b], (s) => said.push(s));
    const panel = new mod.PluginPanel(m, () => ({ left: 80, top: 46, bottom: 86 }));

    panel.open();
    const root = document.body.children[0];
    const list = root.children[1];
    assert.equal(list.children.length, 1, 'Beta is hidden from the menu');
    assert.ok(texts(list).includes('Alpha') && texts(list).includes('Alpha short'));
    assert.equal(list.style.maxHeight, '480px');
    assert.equal(root.style.top, '90px');

    const sw = list.children[0].children[1];
    sw.fire('click');
    await new Promise(r => setTimeout(r, 0));
    assert.equal(a.running, true);
    assert.equal(config.get('Alpha.enabled'), true);
    assert.deepEqual(said, ['[ST] Alpha enabled']);
    assert.notEqual(list.children[0].children[1], sw, 'redrawn after the toggle');

    document.fire('keydown', { key: 'Escape' });
    assert.equal(panel.isOpen(), false);
    assert.equal(document.count('mousedown'), 0, 'listeners only while open');
});

test('panel: the gear shows a checklist of all offered plugins that sets menu.hidden', () => {
    const document = setupDom();
    const config = fakeConfig({ 'menu.hidden': ['Beta'] });
    const m = new mod.PluginManager(config, [fakePlugin('Alpha'), fakePlugin('Beta'), fakePlugin('STABS', { parked: true })], () => {});
    const panel = new mod.PluginPanel(m, () => null);
    panel.open();
    const root = document.body.children[0];
    const [header, list] = root.children;
    header.children[1].fire('click');   // gear
    assert.equal(header.children[0].textContent, 'Show in the menu');
    assert.equal(list.children.length, 2, 'parked plugins are not offered');
    const [boxA, boxB] = list.children.map(r => r.children[0]);
    assert.deepEqual([boxA.checked, boxB.checked], [true, false]);
    boxB.checked = true;
    boxB.fire('change');
    boxA.checked = false;
    boxA.fire('change');
    assert.deepEqual(config.get('menu.hidden'), ['Alpha']);

    header.children[1].fire('click');   // back to the list
    assert.equal(list.children.length, 1);
    assert.ok(texts(list).includes('Beta'));
});

test('panel: an empty menu says how to fill it', () => {
    const document = setupDom();
    const m = new mod.PluginManager(fakeConfig({ 'menu.hidden': ['Alpha'] }), [fakePlugin('Alpha')], () => {});
    new mod.PluginPanel(m, () => null).open();
    assert.match(texts(document.body.children[0].children[1]).join(' '), /gear/);
});

// ─── Toolbar Plugins button ─────────────────────────────────────────

test('toolbar: with onPlugins the grid has Plugins above Config; without it only Config', () => {
    const document = setupDom();
    let plugins = 0;
    const tb = new mod.Toolbar(fakeConfig(), { onConfig() {}, onPlugins: () => plugins++ });
    tb.start();
    assert.ok(tb.anchorRect());
    tb.open();
    const grid = document.body.children[1];
    assert.deepEqual(grid.children.map(c => c.textContent), ['Plugins', 'Config']);
    grid.children[0].fire('click');
    assert.equal(plugins, 1);
    assert.equal(tb.isOpen(), false, 'the grid closes');

    setupDom();
    const plain = new mod.Toolbar(fakeConfig(), { onConfig() {} });
    assert.equal(plain.anchorRect(), null, 'before start()');
    plain.start();
    plain.open();
    assert.deepEqual(globalThis.document.body.children[1].children.map(c => c.textContent), ['Config']);
});
