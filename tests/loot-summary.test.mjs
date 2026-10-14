// Loot Summary: available loot of a Forgotten target in the region info panel (plugins/loot-summary.js).
// Loot = MHTools getLoots: sum of hp% * Count over get_UnitLevelRepairRequirements() of buildings + defence.
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
        stdin: { contents: `export * from './plugins/loot-summary.js';`, resolveDir: root },
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

function fakeQx() {
    class Widget {
        constructor(value = '') { this.value = value; this.kids = []; this.parent = null; this.color = null; }
        set() { return this; }
        setValue(v) { this.value = v; }
        setTextColor(c) { this.color = c; }
        add(w) {
            if (w.parent) w.parent.remove(w);
            w.parent = this; this.kids.push(w);
        }
        remove(w) { this.kids.splice(this.kids.indexOf(w), 1); w.parent = null; }
        getLayoutParent() { return this.parent; }
        dispose() {}
    }
    class StatusInfo extends Widget {
        constructor() { super(); this.listeners = new Map(); this.nextId = 1; }
        addListener(name, fn) { const id = `l${this.nextId++}`; this.listeners.set(id, { name, fn }); return id; }
        removeListenerById(id) { this.listeners.delete(id); }
        fire(name) { for (const l of this.listeners.values()) if (l.name === name) l.fn(); }
    }
    const instances = {};
    const region = {};
    for (const n of ['RegionNPCBaseStatusInfo', 'RegionNPCCampStatusInfo', 'RegionCityStatusInfoEnemy']) {
        instances[n] = new StatusInfo();
        region[n] = { getInstance: () => instances[n] };
    }
    globalThis.qx = {
        ui: {
            container: { Composite: class extends Widget {} },
            basic: { Label: class extends Widget {} },
            layout: { VBox: class {} },
        },
    };
    const events = [];
    globalThis.webfrontend = {
        gui: { region },
        phe: { cnc: { Util: {
            attachNetEvent: (src, name, type, ctx, cb) => events.push({ name, ctx, cb }),
            detachNetEvent: (src, name, type, ctx, cb) => events.splice(events.findIndex(e => e.cb === cb), 1),
        } } },
    };
    return { instances, events, fireCities: () => events.filter(e => e.name === 'Change').forEach(e => e.cb.call(e.ctx)) };
}

/** Building (no GetUnitGroupType) or unit (GetUnitGroupType 0 = defence, 3 = offence). */
const entity = (reqs, hp = 1, group) => {
    const u = { get_HitpointsPercent: () => hp, get_UnitLevelRepairRequirements: () => reqs };
    if (group !== undefined) u.GetUnitGroupType = () => group;
    return u;
};
/** {c, d} collection, as the game stores it. */
const coll = (...items) => ({ c: items.length, d: Object.fromEntries(items.map((x, i) => [`k${i}`, x])) });

/**
 * Live shape (2026-10): the {c, d} lists sit on the city object under obfuscated
 * names; get_CityBuildingsData() holds a count summary {c, d: {techId: count}};
 * get_CityUnitsData() has the public get_DefenseUnits().
 */
function city({ x = 10, y = 10, buildings = coll(), defences = coll(), offences = coll() } = {}) {
    return {
        YRMYVJ: { c: 2, d: { a: 1, b: 2 } },       // some other {c, d} list
        UNPJNJ: buildings,
        get_CityBuildingsData: () => ({ c: 3, d: { 2: 1, 5: 2, 29: 5 } }),
        get_CityUnitsData: () => ({ get_DefenseUnits: () => defences, get_OffenseUnits: () => offences }),
        get_LvlBase: () => 31.4,
        get_PosX: () => x, get_PosY: () => y,
    };
}

function fakeGame({ loaded = true, campType = 3, selected = [10, 10], current = [10, 10] } = {}) {
    const state = { loaded, current };
    const req = (Type, Count) => ({ Type, Count });
    const full = city({
        x: current[0], y: current[1],
        buildings: coll(entity([req(1, 1000), req(3, 200)])),
        defences: coll(entity([req(2, 500), req(6, 50)], 0.5, 0)),
    });
    const ownBase = (name, x, y, cp) => ({
        ...city({
            buildings: coll(entity([req(1, 1)])),
            defences: coll(entity([req(1, 1)], 1, 0)),
            offences: coll(entity([req(1, 1)], 1, 3)),
        }),
        get_PosX: () => x, get_PosY: () => y, get_Name: () => name,
        CalculateAttackCommandPointCostToCoord: () => cp,
    });
    globalThis.ClientLib = {
        Vis: {
            VisMain: {
                GetInstance: () => ({
                    get_SelectedObject: () => (selected
                        ? { get_RawX: () => selected[0], get_RawY: () => selected[1], get_Id: () => 77 } : null),
                }),
            },
        },
        Data: {
            CitiesChange: 'CitiesChange',
            MainData: {
                GetInstance: () => ({
                    get_Cities: () => ({
                        get_CurrentCity: () => (state.loaded ? full : null),
                        get_AllCities: () => ({ d: { 1: ownBase('Far', 40, 40, 30), 2: ownBase('Near', 13, 14, 6) } }),
                    }),
                    get_World: () => ({ GetObjectFromPosition: () => ({ Type: 3, $CampType: campType, $Level: 31 }) }),
                }),
            },
        },
    };
    return state;
}

// ─── MHTools loot ───────────────────────────────────────────────────

test('getLoots: hp% * Count per EResourceType (1 tib, 2 cry, 3 credits, 6 research), other types kept by number', () => {
    const r = mod.getLoots(coll(
        entity([{ Type: 1, Count: 1000 }, { Type: 3, Count: 200 }]),
        entity([{ Type: 2, Count: 500 }, { Type: 6, Count: 50 }, { Type: 9, Count: 4 }, 'x'], 0.5),
    ));
    assert.deepEqual(r, { tib: 1000, cred: 200, cry: 250, rp: 25, 9: 2 });
});

test('calcLoot: buildings + defence, total = tib + cry + credits', () => {
    const loot = mod.calcLoot(coll(entity([{ Type: 1, Count: 100 }])), coll(entity([{ Type: 2, Count: 40 }, { Type: 6, Count: 7 }], 0.25)));
    assert.deepEqual(loot, { rp: 1.75, tib: 100, cry: 10, cred: 0, total: 110 });
});

test('buildingList: the {c, d} list on the city object whose entries are buildings, not the count summary', () => {
    const b = coll(entity([]));
    assert.equal(mod.buildingList(city({ buildings: b })), b);
    const withGetter = { ...city(), get_Buildings: () => b };
    assert.equal(mod.buildingList(withGetter), b);
    assert.equal(mod.buildingList({ ...city(), UNPJNJ: coll(entity([], 1, 0)) }), null, 'units are not buildings');
});

test('defenceUnits: public get_DefenseUnits(), else $DefenseUnits', () => {
    const d = coll(entity([], 1, 0));
    assert.equal(mod.defenceUnits(city({ defences: d })), d);
    assert.equal(mod.defenceUnits({ get_CityUnitsData: () => ({ $DefenseUnits: d }) }), d);
    assert.equal(mod.defenceUnits({ get_CityUnitsData: () => null }), null);
});

// ─── Helpers from the work order ────────────────────────────────────

test('lootPerCp: null without a CP cost', () => {
    assert.equal(mod.lootPerCp(1000, 10), 100);
    assert.equal(mod.lootPerCp(1000, 0), null);
    assert.equal(mod.lootPerCp(1000, null), null);
});

test('rankColor: neutral below 3 values, top third green, bottom third red', () => {
    assert.equal(mod.rankColor(5, [5, 1]), 'mid');
    const h = [1, 2, 3, 4, 5, 6, 7];
    assert.equal(mod.rankColor(7, h), 'high');
    assert.equal(mod.rankColor(1, h), 'low');
    assert.equal(mod.rankColor(4, h), 'mid');
    assert.equal(mod.rankColor(null, h), 'mid');
});

test('nearestOwnBase picks the closest base', () => {
    const c = (name, x, y) => ({ get_PosX: () => x, get_PosY: () => y, get_Name: () => name });
    const n = mod.nearestOwnBase(0, 0, [c('A', 10, 0), c('B', 3, 4)]);
    assert.equal(n.name, 'B');
    assert.equal(n.dist, 5);
    assert.equal(mod.nearestOwnBase(0, 0, []), null);
});

// ─── Panel ──────────────────────────────────────────────────────────

test('outpost panel: loot, type + level, CP from the nearest base, loot/CP', async () => {
    const { instances: w, events } = fakeQx();
    fakeGame();
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    const box = w.RegionNPCCampStatusInfo.kids[0];
    assert.ok(box, 'section added');
    const [title, res, total, info, ratio] = box.kids;
    assert.equal(title.value, 'Loot');
    assert.match(res.value, /Tib 1k/);
    assert.match(res.value, /Credits 200/);
    assert.match(total.value, /Total 1\.4k/);
    assert.match(info.value, /^Outpost level 31 · 6 CP from Near \(5\.0 fields\)$/);
    assert.match(ratio.value, /Loot\/CP 241\.7/);
    p.stop();
    assert.equal(w.RegionNPCCampStatusInfo.kids.length, 0, 'stop removes the section');
    assert.equal(w.RegionNPCCampStatusInfo.listeners.size, 0, 'stop removes the listeners');
    assert.equal(events.length, 0, 'stop detaches the cities event');
});

test('player-base widgets are not hooked', async () => {
    const { instances: w } = fakeQx();
    fakeGame();
    const p = new mod.LootSummary({});
    await p.start();
    assert.equal(w.RegionCityStatusInfoEnemy.listeners.size, 0);
    p.stop();
});

test('not loaded yet: shows loading, then fills on the Cities Change event (MHTools onCitiesChange)', async () => {
    const { instances: w, fireCities } = fakeQx();
    const state = fakeGame({ loaded: false });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCBaseStatusInfo.fire('appear');
    const box = w.RegionNPCBaseStatusInfo.kids[0];
    assert.match(box.kids[1].value, /Loading/);
    state.loaded = true;
    fireCities();
    assert.match(box.kids[1].value, /Tib 1k/);
    p.stop();
});

test('current city still the previous target (other position): loading', async () => {
    const { instances: w } = fakeQx();
    fakeGame({ current: [20, 20] });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    assert.match(w.RegionNPCCampStatusInfo.kids[0].kids[1].value, /Loading/);
    p.stop();
});

test('no Cities Change event: the 500 ms re-check fills the panel', async () => {
    const { instances: w } = fakeQx();
    const state = fakeGame({ loaded: false });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    const box = w.RegionNPCCampStatusInfo.kids[0];
    assert.match(box.kids[1].value, /Loading/);
    state.loaded = true;
    await new Promise(r => setTimeout(r, 600));
    assert.match(box.kids[1].value, /Tib 1k/);
    p.stop();
});
