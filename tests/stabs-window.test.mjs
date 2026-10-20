// STABS statistics window (plugins/stabs-window.js) against a generic qx fake. Run: npm test
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
        stdin: { contents: `export * from './plugins/stabs-window.js'; export * from './plugins/stabs-stats.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

/**
 * Any qx widget: set({a: 1}) / setA(1) / getA() / resetA() store properties,
 * add() collects children, child controls are widgets too, listeners are kept.
 */
function fakeQx() {
    const all = [];
    class Widget {
        constructor(...args) {
            this.props = {};
            this.kids = [];
            this.listeners = {};
            this.controls = {};
            this.args = args;
            this.style = {};
            if (typeof args[0] === 'string' || args[0] === null) this.props.value = args[0];
            all.push(this);
            const proxy = new Proxy(this, {
                get(target, name) {
                    if (name in target) return target[name];
                    if (typeof name !== 'string') return undefined;
                    const m = /^(set|get|reset|is)([A-Z].*)$/.exec(name);
                    if (!m) return () => target.proxy;
                    const prop = m[2][0].toLowerCase() + m[2].slice(1);
                    if (m[1] === 'set') return (v) => { target.props[prop] = v; return target.proxy; };
                    if (m[1] === 'reset') return () => { delete target.props[prop]; return target.proxy; };
                    return () => target.props[prop];
                },
            });
            this._proxy = proxy;
            return proxy;
        }
        get proxy() { return this._proxy; }
        set(o) { Object.assign(this.props, o); return this._proxy; }
        add(w, opts) { this.kids.push(w); return this._proxy; }
        addListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return 'id'; }
        fire(name) { for (const fn of this.listeners[name] || []) fn(); }
        getChildControl(name) { return (this.controls[name] = this.controls[name] || new Widget()); }
        getContentElement() { const w = this; return { setStyle: (k, v) => { w.style[k] = v; } }; }
        getValue() { return this.props.value; }
        setValue(v) { this.props.value = v; return this._proxy; }
        isVisible() { return this.props.visibility !== 'excluded'; }
        open() { this.props.visibleNow = true; }
        close() { this.props.visibleNow = false; }
        exclude() { this.props.visibility = 'excluded'; }
        show() { this.props.visibility = 'visible'; }
        moveTo(x, y) { this.props.pos = [x, y]; }
        getBounds() { return { left: 10, top: 20 }; }
        destroy() {}
    }
    const W = Widget;
    /** A window starts closed; open() / close() switch it. */
    class Win extends Widget {
        isVisible() { return !!this.props.visibleNow; }
    }
    const layout = class {};
    globalThis.qx = {
        ui: {
            window: { Window: Win },
            container: { Composite: W },
            basic: { Label: W, Atom: W },
            form: { Button: W },     // no ModelButton: it does not exist in game client 26.1.1
            core: { Spacer: W },
            layout: { VBox: layout, HBox: layout, Grow: layout },
        },
        locale: { Manager: { tr: (id) => ({ 'tnf:combat target': 'Defender' }[id] || id) } },
    };
    globalThis.ClientLib = {
        Base: {
            ETechName: { Construction_Yard: 1, Defense_Facility: 2, Command_Center: 3, Barracks: 4, Factory: 5, Airport: 6 },
            EFactionType: { GDIFaction: 1 },
            Tech: { GetTechIdFromTechNameAndFaction: () => 0, GetTechDisplayNameFromTechId: () => null },
        },
    };
    return all;
}

function config() {
    const data = {};
    return { data, get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
}

function makeWindow() {
    const all = fakeQx();
    const calls = [];
    const cfg = config();
    const win = new mod.StatsWindow({
        config: cfg,
        presets: [{ id: 'live', name: 'live', description: 'd' }, { id: 'cy', name: 'CY', description: 'd' }],
        onUserClose: () => calls.push('close'),
        onSimulate: (id) => calls.push(`sim:${id}`),
        onReplay: (id) => calls.push(`replay:${id}`),
        onLoad: (id) => calls.push(`load:${id}`),
        onReset: () => calls.push('reset'),
    });
    return { win, all, calls, cfg };
}

const fmt = { time: (s) => `t${s}`, number: (n) => `n${n}` };

test('window: game window with the section headers from the game texts, two columns, status bar', () => {
    const { win, all } = makeWindow();
    win.open();
    assert.ok(win.isOpen());
    assert.equal(win.win.args[0], 'STABS: Statistic');
    const labels = all.map(w => w.props.value);
    assert.ok(labels.includes('Defender'), 'header from the game text tnf:combat target');
    assert.ok(labels.includes('live') && labels.includes('CY'));
    assert.equal(win.columns.length, 2);
    // header + section composites use the game's light panel decorators
    assert.ok(all.some(w => w.props.decorator === 'pane-light-opaque'));
    assert.ok(all.some(w => w.props.decorator === 'pane-light-plain'));
    assert.deepEqual(win.win.props.pos, [124, 31]);
});

test('window: update fills the cells, the bottleneck glows, rows show per target, dim column', () => {
    const { win } = makeWindow();
    win.open();
    const s = mod.emptyStats();
    Object.assign(s.enemy.overall.hp, { max: 200, end: 50 });
    Object.assign(s.enemy.defense.hp, { max: 100, end: 50 });
    Object.assign(s.offense.overall.hp, { max: 100, end: 60 });
    s.offense.overall.res[mod.RES.RC_VEH] = 4260;
    s.battleDuration = 56000;
    const live = mod.columnCells({ stats: s, base: 'Home', storage: 122, loot: null }, fmt);
    const empty = mod.columnCells(null, fmt);
    win.update({
        columns: [{ cells: live, dim: false }, { cells: empty, dim: true }],
        enemyRows: mod.visibleEnemyRows(s),
        moraleVisible: false,
        cacheCount: 3,
        outcomeTitles: { victory: 'Victory' },
    });
    const live0 = win.columns[0].cells;
    assert.equal(live0.enemy.overall.getValue(), '25.0 %');
    assert.equal(live0.repair.overall.getValue(), 't4260');
    assert.equal(live0.repair.overall.style['text-shadow'], '0 0 3pt');
    assert.equal(live0.battle.base.getValue(), 'Home');
    assert.equal(live0.battle.outcome.props.show, 'icon');
    assert.equal(win.rows.enemy.defense[0].props.visibility, 'visible');
    assert.equal(win.rows.enemy.df[0].props.visibility, 'excluded');
    assert.equal(win.rows.battle.morale[0].props.visibility, 'excluded');
    assert.equal(win.columns[1].boxes[0].props.opacity, 0.7);
    assert.equal(win.columns[0].boxes[0].props.opacity, 1);
    assert.equal(win.win.props.status, '3 simulations in cache');
});

test('window: buttons, double click, reset and the close button reach the plugin; headers fold', () => {
    const { win, all, calls, cfg } = makeWindow();
    win.open();
    const buttons = all.filter(w => w.props.appearance === 'button-addpoints');
    assert.equal(buttons.length, 4, 'simulate + play per column');
    for (const b of buttons) b.fire('click');
    assert.deepEqual(calls, ['sim:live', 'replay:live', 'sim:cy', 'replay:cy']);
    win.columns[1].boxes[0].fire('dblclick');
    assert.equal(calls.at(-1), 'load:cy');
    all.find(w => w.props.value === 'Reset').fire('click');
    assert.equal(calls.at(-1), 'reset');
    win.win.getChildControl('close-button').fire('execute');
    assert.equal(calls.at(-1), 'close');
    const header = all.find(w => w.props.value === 'Defender');
    // the header label sits in a composite that carries the click listener
    const headerBox = all.find(w => w.kids.includes(header._proxy || header));
    headerBox.fire('click');
    assert.equal(cfg.data['stabs.section.enemy'], false);
});
