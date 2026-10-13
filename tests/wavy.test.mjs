// Wavy: Forgotten attack-wave info in the region info panel + distance lines (plugins/wavy.js).
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
        stdin: { contents: `export * from './plugins/wavy.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stub-main',
            setup(b) {
                b.onResolve({ filter: /lib\/main\.js$/ }, () => ({ path: 'main', namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function chatMessage() {}' }));
            },
        }],
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

// ─── Fakes ──────────────────────────────────────────────────────────

function fakeDom() {
    const parent = { children: [], appendChild(el) { el.parentElement = parent; parent.children.push(el); } };
    const make = (tag) => {
        const el = {
            tag, style: {}, attrs: {}, children: [], parentElement: null, textContent: '',
            get firstChild() { return el.children[0] || null; },
            setAttribute(k, v) { el.attrs[k] = v; },
            appendChild(c) { c.parentElement = el; el.children.push(c); },
            removeChild(c) { el.children.splice(el.children.indexOf(c), 1); c.parentElement = null; },
            remove() {
                if (!el.parentElement) return;
                const p = el.parentElement;
                p.children.splice(p.children.indexOf(el), 1);
                el.parentElement = null;
            },
        };
        return el;
    };
    globalThis.document = {
        createElement: make,
        createElementNS: (ns, tag) => make(tag),
        querySelector: (sel) => (sel === 'canvas' ? { parentElement: parent } : null),
    };
    return parent;
}

/** qx widgets: just enough for the panel (set/setValue/add/remove/getLayoutParent/dispose). */
function fakeQx() {
    class Widget {
        constructor(value = '') { this.value = value; this.kids = []; this.parent = null; this.disposed = false; }
        set() { return this; }
        setValue(v) { this.value = v; }
        add(w) {
            if (w.parent) w.parent.remove(w);
            w.parent = this; this.kids.push(w);
        }
        remove(w) { this.kids.splice(this.kids.indexOf(w), 1); w.parent = null; }
        getLayoutParent() { return this.parent; }
        dispose() { this.disposed = true; }
    }
    class StatusInfo extends Widget {
        constructor() { super(); this.listeners = new Map(); this.nextId = 1; }
        addListener(name, fn) { const id = `l${this.nextId++}`; this.listeners.set(id, { name, fn }); return id; }
        removeListenerById(id) { this.listeners.delete(id); }
        fire(name) { for (const l of this.listeners.values()) if (l.name === name) l.fn(); }
    }
    const instances = {};
    const region = {};
    for (const n of ['RegionCityStatusInfoOwn', 'RegionCityStatusInfoAlliance', 'RegionCityStatusInfoEnemy',
        'RegionNPCBaseStatusInfo', 'RegionNPCCampStatusInfo', 'RegionRuinStatusInfo']) {
        instances[n] = new StatusInfo();
        region[n] = { getInstance: () => instances[n] };
    }
    globalThis.qx = {
        ui: {
            container: { Composite: class extends Widget {} },
            basic: { Label: class extends Widget {} },
            layout: { VBox: class {}, HBox: class {} },
        },
    };
    globalThis.webfrontend = {
        gui: { region },
        phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } },
    };
    return instances;
}

/**
 * World: cells keyed "x:y" → object. Grid 100x80 px, screen = world px.
 * Defaults: own base at 50:50 (selected) and 60:50, range 10.
 */
function fakeGame({ objects = {}, mode = 'region', range = 10, own = [[50, 50], [60, 50]], selected = [50, 50] } = {}) {
    const state = { mode, selected };
    globalThis.ClientLib = {
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisMain: {
                GetInstance: () => ({
                    get_Mode: () => state.mode,
                    get_Region: () => ({
                        get_GridWidth: () => 100, get_GridHeight: () => 80,
                        get_ViewWidth: () => 8000, get_ViewHeight: () => 6000,
                    }),
                    ScreenPosFromWorldPosX: (px) => px,
                    ScreenPosFromWorldPosY: (px) => px,
                    get_SelectedObject: () => (state.selected
                        ? { get_RawX: () => state.selected[0], get_RawY: () => state.selected[1] } : null),
                }),
            },
        },
        Data: {
            WorldSector: { ObjectType: { City: 1, NPCBase: 2, NPCCamp: 3 } },
            MainData: {
                GetInstance: () => ({
                    get_Server: () => ({ get_MaxAttackDistance: () => range }),
                    get_World: () => ({ GetObjectFromPosition: (x, y) => objects[`${x}:${y}`] || null }),
                    get_Cities: () => ({
                        get_AllCities: () => ({
                            d: Object.fromEntries(own.map(([x, y], i) => [i + 1, { get_PosX: () => x, get_PosY: () => y }])),
                        }),
                    }),
                }),
            },
        },
    };
    return state;
}

const npc = (level) => ({ Type: 2, $Level: level });

// ─── Pure helpers ───────────────────────────────────────────────────

test('wavesFor: TA Wavy thresholds 21/31/41/51', () => {
    assert.deepEqual([0, 21, 22, 31, 32, 41, 42, 51, 52, 99].map(mod.wavesFor), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('formatLevels: highest level first, count×level, "-" when empty', () => {
    assert.equal(mod.formatLevels({ 28: 1, 31: 2, 29: 4, 30: 2 }), '2×31, 2×30, 4×29, 1×28');
    assert.equal(mod.formatLevels({}), '-');
});

test('scanWaves: only Forgotten bases in Euclidean range; camps, player bases, ruins excluded', () => {
    const objects = {
        '53:54': npc(30),                       // dist 5
        '57:57': npc(30),                       // dist 9.9 → in range, within floor(10)
        '60:50': npc(29),                       // dist 10 → in range (inclusive)
        '58:57': npc(31),                       // dist 10.6 → out
        '51:51': { Type: 3, $CampType: 2, $Level: 30 },   // camp: never counted
        '52:52': { Type: 3, $CampType: 0, $Level: 30 },   // destroyed camp
        '49:49': { Type: 1 },                   // player base
        '48:48': { Type: 4 },                   // ruin
    };
    fakeGame({ objects });
    const world = ClientLib.Data.MainData.GetInstance().get_World();
    const r = mod.scanWaves(world, 50, 50, 10);
    assert.equal(r.count, 3);
    assert.equal(r.countW, 3);
    assert.deepEqual(r.levels, { 30: 2, 29: 1 });
    assert.equal(r.waves, 1);
});

test('scanWaves: waves from the count within floor(range)', () => {
    const objects = {};
    let n = 0;
    for (let x = 45; x <= 55 && n < 25; x++) for (let y = 45; y <= 55 && n < 25; y++) { objects[`${x}:${y}`] = npc(20); n++; }
    // one extra base at exactly 10.4 → counted in range 10.5, but not within floor(10.5) = 10
    objects['60:53'] = npc(19);
    fakeGame({ objects });
    const r = mod.scanWaves(ClientLib.Data.MainData.GetInstance().get_World(), 50, 50, 10.5);
    assert.equal(r.count, 26);
    assert.equal(r.countW, 25);
    assert.equal(r.waves, 2);
});

test('lineTargets: own bases within range, not the selected base itself', () => {
    const t = mod.lineTargets(50, 50, [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 200, y: 200 }]);
    assert.deepEqual(t.map(b => [b.x, b.dist]), [[60, 10]]);
});

// ─── Plugin ─────────────────────────────────────────────────────────

test('panel: appear fills the info widget, lines drawn on the world map, all removed on stop()', async () => {
    const parent = fakeDom();
    const widgets = fakeQx();
    fakeGame({ objects: { '53:54': npc(31), '55:50': npc(30) } });
    const p = new mod.Wavy({ get: (k, d) => d });
    await p.start();

    const w = widgets.RegionNPCBaseStatusInfo;
    w.fire('appear');
    assert.equal(w.kids.length, 1);
    const box = w.kids[0];
    assert.match(box.kids[1].value, /2 \(2\)/);
    assert.match(box.kids[1].value, /1 wave/);
    assert.match(box.kids[2].value, /1×31, 1×30/);

    // distance line to the other own base (60:50 → 10.0)
    assert.equal(parent.children.length, 1);
    const svg = parent.children[0];
    const text = svg.children.find(c => c.tag === 'text');
    assert.equal(text.textContent, '10.0');

    // panel moves to another widget instead of being duplicated
    widgets.RegionCityStatusInfoOwn.fire('appear');
    assert.equal(w.kids.length, 0);
    assert.equal(widgets.RegionCityStatusInfoOwn.kids.length, 1);

    // closing the panel clears the lines
    widgets.RegionCityStatusInfoOwn.fire('disappear');
    assert.equal(parent.children.length, 0);

    widgets.RegionCityStatusInfoOwn.fire('appear');
    p.stop();
    assert.equal(parent.children.length, 0);
    assert.equal(widgets.RegionCityStatusInfoOwn.kids.length, 0);
    for (const inst of Object.values(widgets)) assert.equal(inst.listeners.size, 0);
});

test('no lines outside the world map', async () => {
    const parent = fakeDom();
    const widgets = fakeQx();
    fakeGame({ mode: 'city' });
    const p = new mod.Wavy({ get: (k, d) => d });
    await p.start();
    widgets.RegionCityStatusInfoOwn.fire('appear');
    assert.equal(parent.children.length, 0);
    p.stop();
});

test('cache: the same position is scanned once within 30 s', async () => {
    fakeDom();
    fakeQx();
    let calls = 0;
    fakeGame();
    const md = ClientLib.Data.MainData.GetInstance;
    ClientLib.Data.MainData.GetInstance = () => {
        const m = md();
        return { ...m, get_World: () => ({ GetObjectFromPosition: () => { calls++; return null; } }) };
    };
    const p = new mod.Wavy({ get: (k, d) => d });
    p.info(50, 50, 1000);
    const first = calls;
    p.info(50, 50, 20000);
    assert.equal(calls, first);
    p.info(50, 50, 40000);
    assert.equal(calls, first * 2);
});

test('missing region widgets: start() still works, one warning', async () => {
    fakeDom();
    fakeGame();
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
        const p = new mod.Wavy({ get: (k, d) => d });
        await p.start();
        assert.equal(p.running, true);
        p.stop();
    } finally {
        console.warn = orig;
    }
    assert.ok(warns.length <= 1);
});
