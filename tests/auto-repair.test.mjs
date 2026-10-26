// AutoRepair (plugins/auto-repair.js) and RepairGuard's CityRepair patch (plugins/repair-guard.js).
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
            contents: `export * from './plugins/auto-repair.js'; export * from './plugins/repair-guard.js'; export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const MODE = { City: 1, Region: 2, CombatSetup: 5, ArmySetup: 7 };

function fakeConfig(data = {}) {
    return {
        data,
        get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; },
        set(k, v) { data[k.toLowerCase()] = v; },
    };
}

/** A base whose CityRepair answers CanRepairAll(mode) from `damaged[mode]`; RepairAll repairs. */
function city(id, name, { own = true, ghost = false, locked = false, alerted = false, damaged = { [MODE.ArmySetup]: true } } = {}) {
    const calls = [];
    const state = { ...damaged, locked, alerted };
    const rep = {
        CanRepairAll(mode) { calls.push(['can', mode]); return !!state[mode]; },
        RepairAll(mode) { calls.push(['repair', mode]); state[mode] = false; },
    };
    return {
        id, calls, state,
        IsOwnBase: () => own, get_IsGhostMode: () => ghost, get_IsLocked: () => state.locked,
        get_isAlerted: () => state.alerted, get_Id: () => id,
        get_Name: () => name, get_CityRepairData: () => rep,
    };
}

const chat = [];
function setup(cities, mode = MODE.Region, currentOwn = null) {
    const view = { mode, setModeCalls: 0, sent: [] };
    // CommunicationManager: SendCommand / SendSimpleCommand record and return a marker
    const cm = {
        SendCommand(name, args) { view.sent.push(['SendCommand', name, args]); return 'sc-result'; },
        SendSimpleCommand(name, args) { view.sent.push(['SendSimpleCommand', name, args]); return 'ssc-result'; },
    };
    view.cm = cm;
    const byId = Object.fromEntries(cities.map(c => [c.id, c]));
    globalThis.ClientLib = {
        Vis: { Mode: MODE, VisMain: { GetInstance: () => ({ get_Mode: () => view.mode, set_Mode: () => { view.setModeCalls++; } }) } },
        Data: { MainData: { GetInstance: () => ({ get_Cities: () => ({
            get_AllCities: () => ({ d: byId }),
            GetCity: (id) => byId[id] || null,
            get_CurrentOwnCityId: () => (currentOwn !== null ? currentOwn : cities[0].id),
        }) }) } },
        Net: { CommunicationManager: { GetInstance: () => cm } },
    };
    globalThis.qx = { core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ showMessage: (m) => chat.push(m) }) }) }) } } };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
    return view;
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

test('check: repairs only own, non-ghost bases with damaged units, via ArmySetup, without switching the view', () => {
    const a = city(1, 'Ghozt');
    const b = city(2, 'Ghozt 1', { damaged: {} });
    const g = city(3, 'Ghost', { ghost: true });
    const f = city(4, 'Foreign', { own: false });
    const view = setup([a, b, g, f]);
    chat.length = 0;
    const restore = quiet();
    const r = new mod.AutoRepair(fakeConfig()).check();
    restore();
    assert.deepEqual(r.repaired, ['Ghozt']);
    assert.deepEqual(a.calls.filter(c => c[0] === 'repair'), [['repair', MODE.ArmySetup]], 'units only (ArmySetup), never buildings');
    assert.equal(b.calls.some(c => c[0] === 'repair'), false, 'nothing to repair -> no RepairAll');
    assert.equal(g.calls.length + f.calls.length, 0, 'ghost / foreign base untouched');
    assert.equal(view.setModeCalls, 0, 'view never switched');
    assert.equal(chat.length, 1);
    assert.match(chat[0], /Auto Repair: units repaired in Ghozt/);
});

test('check: nothing while the attack screen is open', () => {
    const a = city(1, 'Ghozt');
    setup([a], MODE.CombatSetup);
    chat.length = 0;
    const p = new mod.AutoRepair(fakeConfig());
    const r = p.check();
    assert.match(r.skipped, /attack screen open/);
    assert.equal(a.calls.length, 0);
    assert.equal(chat.length, 0);
    p.running = true;
    assert.match(p.statusText(), /skipped: attack screen open/);
});

test('check: a base in lockdown is skipped, the others are repaired', () => {
    const a = city(1, 'Ghozt', { locked: true });
    const b = city(2, 'Ghozt 2');
    setup([a, b]);
    const restore = quiet();
    const r = new mod.AutoRepair(fakeConfig()).check();
    restore();
    assert.deepEqual(r.locked, ['Ghozt']);
    assert.deepEqual(r.repaired, ['Ghozt 2']);
    assert.equal(a.calls.length, 0);
});

test('intervalMin: default 5, at least 1, nonsense -> default', () => {
    const p = (v) => new mod.AutoRepair(fakeConfig(v === undefined ? {} : { 'autorepair.interval': v })).intervalMin();
    assert.equal(p(undefined), 5);
    assert.equal(p(2), 2);
    assert.equal(p('3'), 3);
    assert.equal(p(0.5), 1);
    assert.equal(p(0), 1);
    assert.equal(p('abc'), 5);
});

test('timer: first check after 10 s, then every interval (re-read each time); stop() ends it', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const restore = quiet();
    try {
        const a = city(1, 'Ghozt');
        setup([a]);
        const cfg = fakeConfig({ 'autorepair.interval': 2 });
        const p = new mod.AutoRepair(cfg);
        let checks = 0;
        const orig = p.check.bind(p);
        p.check = () => { checks++; return orig(); };
        await p.start();
        mock.timers.tick(9999);
        assert.equal(checks, 0);
        mock.timers.tick(1);
        assert.equal(checks, 1, 'first check after 10 s');
        mock.timers.tick(2 * 60000);
        assert.equal(checks, 2, 'then every 2 min');
        cfg.set('autorepair.interval', 1);            // applies after the check already scheduled
        mock.timers.tick(2 * 60000);
        assert.equal(checks, 3);
        mock.timers.tick(60000);
        assert.equal(checks, 4, 'now every minute');
        p.stop();
        mock.timers.tick(10 * 60000);
        assert.equal(checks, 4, 'stopped');
    } finally {
        restore();
        mock.timers.reset();
    }
});

/** Start the plugin with fake timers; returns { p, view, restore }. */
async function started(cities, opts = {}) {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
    const restoreLog = quiet();
    const view = setup(cities, opts.mode, opts.currentOwn);
    const p = new mod.AutoRepair(fakeConfig({ 'autorepair.interval': 60, ...(opts.config || {}) }));   // interval out of the way
    await p.start();
    chat.length = 0;
    return { p, view, restore: () => { p.stop(); restoreLog(); mock.timers.reset(); } };
}

test('after an attack: InvokeBattle (SendCommand) -> the attacking base is repaired as soon as it is unlocked; the command passes unchanged', async () => {
    const a = city(1, 'Ghozt', { locked: true });
    const b = city(2, 'Ghozt 2');                               // damaged too, but did not attack
    const { view, restore } = await started([a, b]);
    try {
        const args = { battleSetup: { d: 401301, a: 1, u: [], s: 0 } };
        const ret = view.cm.SendCommand('InvokeBattle', args, 'cb');
        assert.equal(ret, 'sc-result', 'original return value');
        assert.deepEqual(view.sent, [['SendCommand', 'InvokeBattle', args]], 'original called with the same arguments');
        mock.timers.tick(3000);
        mock.timers.tick(3000);
        assert.equal(a.calls.some(c => c[0] === 'repair'), false, 'locked: waits');
        a.state.locked = false;
        mock.timers.tick(3000);
        assert.deepEqual(a.calls.filter(c => c[0] === 'repair'), [['repair', MODE.ArmySetup]]);
        assert.equal(b.calls.length, 0, 'only the attacking base');
        assert.equal(chat.length, 1);
        assert.match(chat[0], /units repaired in Ghozt \(after the attack\)/);
        mock.timers.tick(30000);
        assert.equal(a.calls.filter(c => c[0] === 'repair').length, 1, 'done: no further tries');
    } finally {
        restore();
    }
});

test('after an attack: waits while the attack screen is open; SendSimpleCommand without battleSetup.a uses the current own base', async () => {
    const a = city(1, 'Ghozt');
    const { view, restore } = await started([a], { mode: MODE.CombatSetup, currentOwn: 1 });
    try {
        assert.equal(view.cm.SendSimpleCommand('InvokeBattle', { d: 401301 }), 'ssc-result');
        mock.timers.tick(9000);
        assert.equal(a.calls.length, 0, 'attack screen open: no repair');
        view.mode = MODE.Region;
        mock.timers.tick(3000);
        assert.equal(a.calls.filter(c => c[0] === 'repair').length, 1);
    } finally {
        restore();
    }
});

test('after an attack: no damage within 3 min -> stops trying; other commands are ignored', async () => {
    const a = city(1, 'Ghozt', { damaged: {} });
    const { view, restore } = await started([a]);
    try {
        view.cm.SendCommand('UpgradeBuilding', { x: 1 });
        mock.timers.tick(9000);                                 // before the interval's first check at 10 s
        assert.equal(a.calls.length, 0, 'not an attack: nothing');
        view.cm.SendCommand('InvokeBattle', { battleSetup: { a: 1 } });
        for (let i = 0; i < 61; i++) mock.timers.tick(3000);   // step by step: a timer set inside a tick runs on the next
        const tries = a.calls.length;                           // incl. the interval's first check
        assert(tries >= 59, 'tried about every 3 s (' + tries + ')');
        for (let i = 0; i < 20; i++) mock.timers.tick(3000);
        assert.equal(a.calls.length, tries, 'window over: no more tries');
    } finally {
        restore();
    }
});

test('stop: the original SendCommand / SendSimpleCommand are back; a wrapper on top stays but is inert', async () => {
    const a = city(1, 'Ghozt');
    const { p, view, restore } = await started([a]);
    const origSimple = view.cm.SendSimpleCommand;
    try {
        // another script wraps SendSimpleCommand after us
        const ours = view.cm.SendSimpleCommand;
        view.cm.SendSimpleCommand = function (...x) { return ours.apply(this, x); };
        p.stop();
        assert.equal(view.cm.SendCommand.name, 'SendCommand', 'SendCommand restored');
        assert.notEqual(view.cm.SendSimpleCommand, origSimple, 'the outer wrapper is left alone');
        view.cm.SendSimpleCommand('InvokeBattle', { battleSetup: { a: 1 } });
        mock.timers.tick(30000);
        assert.equal(a.calls.length, 0, 'stopped: the inert wrapper triggers nothing');
        assert.equal(view.sent.length, 1, 'but the command still goes through');
    } finally {
        restore();
    }
});

// ─── Buildings (autorepair.buildings) ───────────────────────────────

const BOTH = { [MODE.ArmySetup]: true, [MODE.City]: true };
const repairsOf = (c, mode) => c.calls.filter(x => x[0] === 'repair' && x[1] === mode).length;

test('buildings off (default): the interval repairs units only - CanRepairAll(City) is never even asked', () => {
    const a = city(1, 'Ghozt', { damaged: { ...BOTH } });
    setup([a]);
    const restore = quiet();
    const p = new mod.AutoRepair(fakeConfig());
    const r = p.check();
    restore();
    assert.equal(p.buildingsOn(), false);
    assert.deepEqual(r.buildings, []);
    assert.equal(repairsOf(a, MODE.ArmySetup), 1);
    assert.equal(a.calls.some(x => x[1] === MODE.City), false, 'no City call at all');
});

test('buildings on: the interval also repairs buildings via CanRepairAll(City) -> RepairAll(City), with its own chat line', () => {
    const a = city(1, 'Ghozt', { damaged: { ...BOTH } });
    const b = city(2, 'Ghozt 2', { damaged: { [MODE.City]: true }, alerted: true });   // still under attack
    setup([a, b]);
    chat.length = 0;
    const restore = quiet();
    const r = new mod.AutoRepair(fakeConfig({ 'autorepair.buildings': true })).check();
    restore();
    assert.deepEqual(r.repaired, ['Ghozt']);
    assert.deepEqual(r.buildings, ['Ghozt']);
    assert.deepEqual(a.calls.filter(x => x[1] === MODE.City), [['can', MODE.City], ['repair', MODE.City], ['can', MODE.City]], 'CanRepairAll before and after');
    assert.equal(repairsOf(b, MODE.City), 0, 'a base under attack waits');
    assert.ok(chat.some(m => /Auto Repair: buildings repaired in Ghozt</.test(m) || /Auto Repair: buildings repaired in Ghozt$/.test(m.replace(/<[^>]+>/g, ''))));
});

test('buildingsOn: true / "true" / 1 on; false / "false" / missing off', () => {
    const on = (v) => new mod.AutoRepair(fakeConfig(v === undefined ? {} : { 'autorepair.buildings': v })).buildingsOn();
    assert.equal(on(true), true);
    assert.equal(on('true'), true);
    assert.equal(on(1), true);
    assert.equal(on(false), false);
    assert.equal(on('false'), false);
    assert.equal(on(undefined), false);
});

test('after an attack on a base: get_isAlerted -> buildings repaired once the attack and the lockdown are over', async () => {
    const a = city(1, 'Ghozt', { damaged: { [MODE.City]: true } });   // units intact: the interval has nothing to do
    const { view, restore } = await started([a], { config: { 'autorepair.buildings': true } });
    try {
        a.state.alerted = true;
        mock.timers.tick(5000);                              // alert poll sees it
        for (let i = 0; i < 4; i++) mock.timers.tick(3000);
        assert.equal(repairsOf(a, MODE.City), 0, 'under attack: waits');
        a.state.alerted = false;
        a.state.locked = true;
        for (let i = 0; i < 80; i++) mock.timers.tick(3000);  // 4 min locked: the window must not run out meanwhile
        assert.equal(repairsOf(a, MODE.City), 0, 'locked: waits');
        a.state.locked = false;
        mock.timers.tick(3000);
        assert.equal(repairsOf(a, MODE.City), 1, 'repaired after the lockdown');
        assert.equal(repairsOf(a, MODE.ArmySetup), 0, 'no unit repair');
        assert.equal(a.calls.filter(x => x[1] === MODE.City && x[0] === 'can').length >= 2, true);
        assert.ok(chat.some(m => /buildings repaired in Ghozt \(after the attack on your base\)/.test(m)));
        void view;
    } finally {
        restore();
    }
});

test('after an attack on a base: nothing when autorepair.buildings is off', async () => {
    const a = city(1, 'Ghozt', { damaged: { ...BOTH }, alerted: true });
    const { restore } = await started([a]);
    try {
        for (let i = 0; i < 5; i++) mock.timers.tick(5000);
        a.state.alerted = false;
        for (let i = 0; i < 10; i++) mock.timers.tick(3000);
        assert.equal(a.calls.some(x => x[1] === MODE.City), false);
    } finally {
        restore();
    }
});

test('AutoRepair / RepairGuard declare each other as excluded; AutoRepair yields on conflict', () => {
    const ar = new mod.AutoRepair(fakeConfig());
    const rg = new mod.RepairGuard(fakeConfig());
    assert.deepEqual(ar.excludes, ['RepairGuard']);
    assert.deepEqual(rg.excludes, ['AutoRepair']);
    assert.equal(ar.yieldsOnConflict, true);
    assert.equal(!!rg.yieldsOnConflict, false, 'RepairGuard wins');
    assert.equal(ar.defaultEnabled, false);
});

test('RepairGuard wraps CityRepair.RepairAll and RepairAllUnits (not CanRepairAll) and restores them on stop', async () => {
    const calls = [];
    const proto = {
        RepairAll(m) { calls.push(['RepairAll', m]); },
        RepairAllUnits() { calls.push(['RepairAllUnits']); },
        CanRepairAll() { return true; },
    };
    const original = { ...proto };
    globalThis.ClientLib = { Data: { CityRepair: { prototype: proto } } };
    const restore = quiet();
    try {
        const rg = new mod.RepairGuard(fakeConfig());
        await rg.start();
        assert.notEqual(proto.RepairAll, original.RepairAll);
        assert.notEqual(proto.RepairAllUnits, original.RepairAllUnits);
        assert.equal(proto.CanRepairAll, original.CanRepairAll, 'CanRepairAll is not a repair');
        proto.RepairAll(MODE.ArmySetup);
        proto.RepairAll(MODE.City);
        proto.RepairAllUnits();
        assert.deepEqual(calls, [], 'blocked - units and buildings');
        rg.stop();
        assert.equal(proto.RepairAll, original.RepairAll);
        assert.equal(proto.RepairAllUnits, original.RepairAllUnits);
        proto.RepairAll(MODE.ArmySetup);
        assert.deepEqual(calls, [['RepairAll', MODE.ArmySetup]], 'works again after stop');
    } finally {
        restore();
    }
});
