// Loot Summary: lootable resources of a Forgotten target in the region info panel (plugins/loot-summary.js).
// Loot = MHTools getLoots / MaelstromTools getResourcesPart; table = MaelstromTools createResourceLabels.
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
        constructor(value = '') {
            this.value = value; this.kids = []; this.parent = null; this.color = null; this.font = null; this.pos = null;
        }
        set(o) { if (o && 'value' in o) this.value = o.value; return this; }
        setValue(v) { this.value = v; }
        setTextColor(c) { this.color = c; }
        setFont(f) { this.font = f; }
        setWidth() {} setHeight() {} setScale() {} setTextAlign() {}
        add(w, pos) {
            if (w.parent) w.parent.remove(w);
            w.parent = this; w.pos = pos || null; this.kids.push(w);
        }
        remove(w) { this.kids.splice(this.kids.indexOf(w), 1); w.parent = null; }
        removeAll() { for (const k of [...this.kids]) this.remove(k); }
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
            basic: { Label: class extends Widget {}, Image: class extends Widget {} },
            layout: { Grid: class {} },
        },
    };
    const events = [];
    globalThis.webfrontend = {
        gui: { region },
        phe: { cnc: {
            Util: {
                attachNetEvent: (src, name, type, ctx, cb) => events.push({ name, ctx, cb }),
                detachNetEvent: (src, name, type, ctx, cb) => events.splice(events.findIndex(e => e.cb === cb), 1),
            },
            gui: { util: { Numbers: { formatNumbersCompact: (v) => Math.round(v).toLocaleString('en-US') } } },
        } },
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
const req = (Type, Count) => ({ Type, Count });

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
        get_PosX: () => x, get_PosY: () => y,
    };
}

/**
 * The live comparison camp: Research 110,800 · Tiberium 97,981 · Crystal 91,039 · Credits 29,341
 * (half of it in a building at 100 %, half in a defence unit at 50 % of twice the cost).
 */
function fakeGame({ loaded = true, current = [10, 10], own = [14, 13], range = 10, cp = 11, available = 154 } = {}) {
    const state = { loaded };
    const half = (n) => n / 2;
    const target = city({
        x: current[0], y: current[1],
        buildings: coll(entity([req(6, half(110800)), req(1, half(97981)), req(2, half(91039)), req(3, half(29341))])),
        defences: coll(entity([req(6, 110800), req(1, 97981), req(2, 91039), req(3, 29341)], 0.5, 0)),
        offences: coll(entity([req(1, 999999)], 1, 3)),
    });
    const ownCity = {
        get_PosX: () => own[0], get_PosY: () => own[1], get_Name: () => 'Home',
        CalculateAttackCommandPointCostToCoord: () => cp,
    };
    globalThis.ClientLib = {
        File: { FileManager: { GetInstance: () => ({ GetPhysicalPath: (p) => `/res/${p}` }) } },
        Vis: {
            VisMain: {
                GetInstance: () => ({ get_SelectedObject: () => ({ get_RawX: () => 10, get_RawY: () => 10 }) }),
            },
        },
        Data: {
            CitiesChange: 'CitiesChange',
            MainData: {
                GetInstance: () => ({
                    get_Cities: () => ({
                        get_CurrentCity: () => (state.loaded ? target : null),
                        get_CurrentOwnCity: () => ownCity,
                    }),
                    get_Server: () => ({ get_MaxAttackDistance: () => range }),
                    get_Player: () => ({ GetCommandPointCount: () => available }),
                }),
            },
        },
    };
    return state;
}

/** Grid cells as rows: row → [{col, text, font, color}] sorted by column; images have their path as text. */
function rows(grid) {
    const out = {};
    for (const k of grid.kids) {
        const r = (out[k.pos.row] = out[k.pos.row] || []);
        r.push({ col: k.pos.column, text: k.value, font: k.font, color: k.color });
    }
    for (const r of Object.values(out)) r.sort((a, b) => a.col - b.col);
    return Object.keys(out).map(Number).sort((a, b) => a - b).map(n => out[n]);
}

// ─── Loot formula ───────────────────────────────────────────────────

test('getLoots: hp% * Count per EResourceType (1 tib, 2 cry, 3 credits, 6 research), other types kept by number', () => {
    const r = mod.getLoots(coll(
        entity([req(1, 1000), req(3, 200)]),
        entity([req(2, 500), req(6, 50), req(9, 4), 'x'], 0.5),
    ));
    assert.deepEqual(r, { tib: 1000, cred: 200, cry: 250, rp: 25, 9: 2 });
});

test('calcLoot: buildings + defence; total includes research (MaelstromTools Total)', () => {
    const loot = mod.calcLoot(coll(entity([req(1, 100)])), coll(entity([req(2, 40), req(6, 8)], 0.25)));
    assert.deepEqual(loot, { rp: 2, tib: 100, cry: 10, cred: 0, total: 112 });
});

test('lootRows: Maelstrom modifiers 1, CP, 2 CP, 3 CP; bold only when the modifier <= 1', () => {
    assert.deepEqual(mod.lootRows(11), [
        ['lootLootable', 1, true], ['lootPerCpRow', 11, false], ['loot2nd', 22, false], ['loot3rd', 33, false],
    ]);
    assert.deepEqual(mod.lootRows(null), [['lootLootable', 1, true]]);
    assert.equal(mod.lootRows(1)[1][2], true);
});

test('possibleAttacks: floor(available CP / CP needed)', () => {
    assert.equal(mod.possibleAttacks(154, 11), 14);
    assert.equal(mod.possibleAttacks(160, 11), 14);
    assert.equal(mod.possibleAttacks(154, 0), null);
    assert.equal(mod.possibleAttacks(NaN, 11), null);
});

test('buildingList: the {c, d} list on the city object whose entries are buildings, not the count summary', () => {
    const b = coll(entity([]));
    assert.equal(mod.buildingList(city({ buildings: b })), b);
    assert.equal(mod.buildingList({ ...city(), get_Buildings: () => b }), b);
    assert.equal(mod.buildingList({ ...city(), UNPJNJ: coll(entity([], 1, 0)) }), null, 'units are not buildings');
});

test('defenceUnits: public get_DefenseUnits(), else $DefenseUnits', () => {
    const d = coll(entity([], 1, 0));
    assert.equal(mod.defenceUnits(city({ defences: d })), d);
    assert.equal(mod.defenceUnits({ get_CityUnitsData: () => ({ $DefenseUnits: d }) }), d);
    assert.equal(mod.defenceUnits({ get_CityUnitsData: () => null }), null);
});

test('rankColor: neutral below 3 values, top third green, bottom third red', () => {
    assert.equal(mod.rankColor(5, [5, 1]), 'mid');
    const h = [1, 2, 3, 4, 5, 6, 7];
    assert.equal(mod.rankColor(7, h), 'high');
    assert.equal(mod.rankColor(1, h), 'low');
    assert.equal(mod.rankColor(4, h), 'mid');
    assert.equal(mod.rankColor(null, h), 'mid');
});

// ─── Panel ──────────────────────────────────────────────────────────

test('table: identical to MHTools on screen - 110.8k under the tib icon, then crystal, credits, research, sum', async () => {
    const { instances: w, events } = fakeQx();
    fakeGame();
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    const grid = w.RegionNPCCampStatusInfo.kids[0];
    assert.ok(grid, 'section added');
    const r = rows(grid);
    assert.equal(r[0][0].text, 'Possible attacks from this base (available CP): 14');
    const values = (row) => row.slice(1).filter(c => /\d/.test(c.text)).map(c => c.text);
    const icons = (row) => row.filter(c => String(c.text).startsWith('/res/ui/common/icn_')).length;
    assert.equal(r[1][0].text, 'Lootable resources:');
    assert.equal(r[1][0].font, 'bold');
    assert.equal(icons(r[1]), 5, 'an icon before each value');
    const iconPaths = r[1].filter(c => String(c.text).startsWith('/res/')).map(c => c.text.replace('/res/ui/common/', ''));
    assert.deepEqual(iconPaths, ['icn_res_tiberium.png', 'icn_res_chrystal.png', 'icn_res_dollar.png',
        'icn_res_research_mission.png', 'icn_build_slots.png'], 'Tib · Crystal · Credits · Research · Sum');
    assert.deepEqual(values(r[1]), ['110,800', '97,981', '91,039', '29,341', '329,161']);
    assert.equal(r[2][0].text, 'per CP:');
    assert.equal(r[2][0].font, null, 'per CP is not bold at CP > 1 (Maelstrom)');
    assert.deepEqual(values(r[2]), ['10,073', '8,907', '8,276', '2,667', '29,924']);
    assert.equal(r[3][0].text, '2nd run:');
    assert.deepEqual(values(r[3]), ['5,036', '4,454', '4,138', '1,334', '14,962']);
    assert.equal(r[4][0].text, '3rd run:');
    assert.deepEqual(values(r[4]), ['3,358', '2,969', '2,759', '889', '9,975']);
    assert.equal(r[5][0].text, '11 CP from Home');
    p.stop();
    assert.equal(w.RegionNPCCampStatusInfo.kids.length, 0, 'stop removes the section');
    assert.equal(w.RegionNPCCampStatusInfo.listeners.size, 0, 'stop removes the listeners');
    assert.equal(events.length, 0, 'stop detaches the cities event');
});

test('out of range of the current own base: Maelstrom message, no numbers', async () => {
    const { instances: w } = fakeQx();
    fakeGame({ own: [40, 40] });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCBaseStatusInfo.fire('appear');
    const r = rows(w.RegionNPCBaseStatusInfo.kids[0]);
    assert.equal(r.length, 1);
    assert.equal(r[0][0].text, 'Target out of range, no resource calculation possible');
    p.stop();
});

test('player-base widgets are not hooked', async () => {
    const { instances: w } = fakeQx();
    fakeGame();
    const p = new mod.LootSummary({});
    await p.start();
    assert.equal(w.RegionCityStatusInfoEnemy.listeners.size, 0);
    p.stop();
});

test('not loaded yet: calculating, then the table on the Cities Change event', async () => {
    const { instances: w, fireCities } = fakeQx();
    const state = fakeGame({ loaded: false });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCBaseStatusInfo.fire('appear');
    const grid = w.RegionNPCBaseStatusInfo.kids[0];
    assert.equal(rows(grid)[0][0].text, 'Calculating resources...');
    state.loaded = true;
    fireCities();
    assert.equal(rows(grid)[1][0].text, 'Lootable resources:');
    p.stop();
});

test('no Cities Change event: the 500 ms re-check fills the table', async () => {
    const { instances: w } = fakeQx();
    const state = fakeGame({ loaded: false });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    const grid = w.RegionNPCCampStatusInfo.kids[0];
    state.loaded = true;
    await new Promise(r => setTimeout(r, 600));
    assert.equal(rows(grid)[1][0].text, 'Lootable resources:');
    p.stop();
});

test('current city still the previous target (other position): calculating', async () => {
    const { instances: w } = fakeQx();
    fakeGame({ current: [12, 12] });
    const p = new mod.LootSummary({});
    await p.start();
    w.RegionNPCCampStatusInfo.fire('appear');
    assert.equal(rows(w.RegionNPCCampStatusInfo.kids[0])[0][0].text, 'Calculating resources...');
    p.stop();
});
