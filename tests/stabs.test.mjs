// STABS (plugins/stabs.js, plugins/stabs-stats.js). Run: npm test
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
            contents: `export * from './plugins/stabs-stats.js'; export { tabsLoaded, Stabs } from './plugins/stabs.js'; export { getHelpModel } from './lib/help.js';`,
            resolveDir: root,
        },
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
const { RES } = mod;

// ── repairCost ──

test('repairCost: no damage costs nothing', () => {
    let called = false;
    const res = mod.repairCost(() => { called = true; return []; }, { max: 100, start: 50, end: 50 });
    assert.equal(called, false);
    assert.equal(res[RES.TIB], 0);
});

test('repairCost: attack counter lowers tib/crystal/credits/research, not repair charge', () => {
    const costs = [
        { Type: RES.TIB, Count: 1000 }, { Type: RES.CRY, Count: 100 }, { Type: RES.CREDITS, Count: 10 },
        { Type: RES.RC_INF, Count: 60 }, { Type: 5, Count: 99 },   // power is not kept
    ];
    let ratio = null;
    const res = mod.repairCost((r) => { ratio = r; return costs; }, { max: 200, start: 200, end: 50 }, 2);
    assert.equal(ratio, 0.75);
    assert.ok(Math.abs(res[RES.TIB] - 1000 * 0.49) < 1e-9);
    assert.ok(Math.abs(res[RES.CRY] - 100 * 0.49) < 1e-9);
    assert.ok(Math.abs(res[RES.CREDITS] - 10 * 0.49) < 1e-9);
    assert.equal(res[RES.RC_INF], 60);
    assert.equal(res[5], undefined);
});

test('repairCost: research is scaled by the damage ratio, at least 1', () => {
    const hp = { max: 100, start: 100, end: 99 };   // ratio 0.01
    assert.equal(mod.repairCost(() => [{ Type: RES.RP, Count: 50 }], hp)[RES.RP], 1);
    assert.equal(mod.repairCost(() => [{ Type: RES.RP, Count: 5000 }], hp)[RES.RP], 50);
});

test('battleDuration: cs × 100 ms, + 3 s when the battle ended early', () => {
    assert.equal(mod.battleDuration(500, 120), 50000 + 3000);
    assert.equal(mod.battleDuration(1200, 120), 120000);
});

// ── computeStats ──

const E = {
    GDI: 1, NOD: 2, Offense: 1, Feet: 1, Wheel: 2, Track: 3, Air: 4, Air2: 5, Structure: 6, ArmorNone: 0,
    tech: { cy: 10, cc: 11, barracks: 12, factory: 13, airport: 14, df: 15, dhq: 16, support: [17, 18, 19] },
};

function env(units, info, log = []) {
    return {
        E,
        unit: (id) => units[id],
        maxHealth: (level, unit) => unit.lp * 16,
        techName: (unit) => unit.tl,
        repairCosts: (unit, mdbId, level, ratio) => [{ Type: unit.pt === 1 ? RES.RC_VEH : RES.TIB, Count: ratio * 100 }],
        buildingInfo: info,
        asAttacker: (fn) => { log.push('attacker'); fn(); },
    };
}

const UNITS = {
    1: { pt: 3, mt: 6, tl: 10, lp: 100 },   // CY
    2: { pt: 3, mt: 6, tl: 15, lp: 100 },   // DF
    3: { pt: 3, mt: 6, tl: 99, lp: 50 },    // other building
    4: { pt: 2, mt: 6, ptt: 1, lp: 40 },    // armored defense structure
    5: { pt: 2, mt: 1, ptt: 0, lp: 20 },    // non-armored defense infantry
    6: { pt: 1, mt: 2, lp: 30 },            // offense vehicle
};

function forgottenBattle() {
    return {
        d: {
            df: 3, dm: [], am: [], cs: 300, md: 120, di: 50, ai: 7,
            s: [
                { i: 1, l: 10, h: 100, ci: 1, x: 4, y: 2 },
                { i: 2, l: 12, h: 100, ci: 2, x: 1, y: 3 },
                { i: 3, l: 5, h: 50, ci: 3, x: 4, y: 5 },     // in front of the CY
            ],
            d: [
                { i: 4, l: 20, h: 40, ci: 4, x: 4, y: 0, ac: 0 },   // CY column, structure → front
                { i: 5, l: 30, h: 20, ci: 5, x: 4, y: 1, ac: 0 },   // CY column, infantry → no front
            ],
            a: [{ i: 6, l: 10, h: 30, ci: 6, x: 0, y: 0 }],
        },
        e: [
            { Key: 1, Value: { h: 800, mh: 0 } }, { Key: 2, Value: { h: 1600, mh: 0 } }, { Key: 3, Value: { h: 0, mh: 0 } },
            { Key: 4, Value: { h: 0, mh: 0 } }, { Key: 5, Value: { h: 160, mh: 0 } }, { Key: 6, Value: { h: 240, mh: 0 } },
        ],
    };
}

test('computeStats: categories, front and auto repair (Forgotten base)', () => {
    const log = [];
    const info = { cy: { x: 4, y: 2 }, cc: null, barracks: null, factory: null, airport: null, df: { x: 1, y: 3 }, dhq: null, support: null };
    const s = mod.computeStats(forgottenBattle(), env(UNITS, info, log));
    assert.equal(s.battleDuration, 30000 + 3000);
    assert.deepEqual(log, ['attacker']);
    // structure: 1600 + 1600 + 800 max; end 800 + 1600 + 0
    assert.equal(s.enemy.structure.hp.max, 4000);
    assert.equal(s.enemy.structure.hp.end, 2400);
    assert.equal(s.enemy.cy.hp.max, 1600);
    assert.equal(s.enemy.cy.hp.end, 800);
    assert.equal(s.enemy.df.hp.end, 1600);
    // CY front: the building below it (y 5 > 2) + the defense structure in column 4
    assert.equal(s.enemy.cy.hp.maxFront, 800 + 640);
    assert.equal(s.enemy.cy.hp.endFront, 0);
    // defense split by armour
    assert.equal(s.enemy.defenseArmored.hp.max, 640);
    assert.equal(s.enemy.defenseNonArmored.hp.max, 320);
    assert.equal(s.enemy.defense.hp.end, 160);
    // auto repair: lost × 0.7 × DF ratio (1) × DF level / max(DF level, unit level)
    assert.ok(Math.abs(s.enemy.defenseArmored.hp.rep - 640 * 0.7 * 12 / 20) < 1e-9);
    assert.ok(Math.abs(s.enemy.defenseNonArmored.hp.rep - 160 * 0.7 * 12 / 30) < 1e-9);
    // overall = structure + defense
    assert.equal(s.enemy.overall.hp.max, 4000 + 960);
    // offense: vehicle lost 240 of 480
    assert.equal(s.offense.vehicle.hp.end, 240);
    assert.equal(s.offense.overall.res[RES.RC_VEH], 50);
    assert.equal(s.offense.infantry.hp.max, 0);
    assert.equal(mod.battleOutcome(s), 'victory');
});

test('computeStats: a player base takes building HP from the simulation', () => {
    const data = forgottenBattle();
    data.d.df = E.GDI;
    data.e[0].Value = { h: 500, mh: 9000 };
    const s = mod.computeStats(data, env(UNITS, {}));
    // TABS takes both start and end from the simulation's h here
    assert.equal(s.enemy.cy.hp.max, 9000);
    assert.equal(s.enemy.cy.hp.start, 500);
    assert.equal(s.enemy.cy.hp.end, 500);
});

test('computeStats: unknown target = no front totals', () => {
    const s = mod.computeStats(forgottenBattle(), env(UNITS, {}));
    assert.equal(s.enemy.cy.hp.maxFront, 0);
});

// ── formation + cache ──

test('formationKey: order independent, ignores disabled and dead units', () => {
    const a = [{ x: 1, y: 0, i: 5, l: 3, enabled: true, h: 10 }, { x: 0, y: 2, i: 7, l: 1, enabled: true, h: 5 }];
    const b = [a[1], a[0], { x: 3, y: 3, i: 9, l: 9, enabled: false, h: 5 }, { x: 4, y: 3, i: 9, l: 9, enabled: true, h: 0 }];
    assert.equal(mod.formationKey(a, 7), mod.formationKey(b, 7));
    assert.notEqual(mod.formationKey(a, 7), mod.formationKey(a, 8));
    assert.notEqual(mod.formationKey(a, 7), mod.formationKey([{ ...a[0], x: 2 }, a[1]], 7));
});

test('mergeFormation: copies the simulation fields onto matching units', () => {
    const f = [{ id: 1, gs: 0, i: 5, l: 3, x: 1, y: 0, h: 10 }, { id: 2, gs: 0, i: 5, l: 3, x: 2, y: 0, h: 10 }];
    mod.mergeFormation(f, [{ gs: 0, i: 5, l: 3, x: 2, y: 0, h: 9, ci: 44 }]);
    assert.equal(f[0].ci, undefined);
    assert.equal(f[1].ci, 44);
    assert.equal(f[1].h, 9);
});

test('SimCache: target version, repair state and POI bonuses invalidate', () => {
    const c = new mod.SimCache();
    const own = (recovery, poi) => ({ version: 1, recovery, poi });
    const poi = { air: 1, inf: 2, veh: 3 };
    assert.equal(c.check(50, 'k', { version: 3, own: own(false, poi) }), null);
    c.add(50, 'k', { recovery: false, stats: {} });
    assert.ok(c.check(50, 'k', { version: 3, own: own(false, poi) }));
    assert.equal(c.count(50), 1);
    // own base starts repairing → this entry no longer counts
    assert.equal(c.check(50, 'k', { version: 3, own: own(true, poi) }), null);
    c.add(50, 'k', { recovery: false, stats: {} });
    // POI bonus changed while not repairing → all invalid
    assert.equal(c.check(50, 'k', { version: 3, own: own(false, { ...poi, air: 9 }) }), null);
    c.add(50, 'k', { recovery: false, stats: {} });
    // target changed (version) → all invalid, still counted until reset
    assert.equal(c.check(50, 'k', { version: 4, own: own(false, { ...poi, air: 9 }) }), null);
    assert.equal(c.count(50), 1);
    c.clear(50);
    assert.equal(c.count(50), 0);
});

// ── presets ──

/** Stats with the given CY / overall HP left (of 100), offense repair time and duration. */
function presetStats({ cy = 100, cyFront = 0, all = 100, repair = 0, own = 100, ms = 60000 }) {
    const s = mod.emptyStats();
    Object.assign(s.enemy.cy.hp, { max: 100, end: cy, maxFront: 50, endFront: cyFront });
    Object.assign(s.enemy.overall.hp, { max: 100, end: all });
    Object.assign(s.offense.overall.hp, { max: 100, end: own });
    s.offense.overall.res[RES.RC_VEH] = repair;
    s.battleDuration = ms;
    return s;
}
const entry = (stats, valid = true) => ({ stats, valid });
const cy = mod.PRESETS.cy.criteria;

test('CY preset: least CY (front included) first', () => {
    const list = [
        { key: 'a', entry: entry(presetStats({ cy: 40 })) },
        { key: 'b', entry: entry(presetStats({ cy: 0, cyFront: 30 })) },
        { key: 'c', entry: entry(presetStats({ cy: 0, cyFront: 10 })) },
    ];
    assert.equal(mod.bestEntry(list, cy).key, 'c');
});

test('CY preset: ties go to less enemy left, then faster repair, then fewer own losses, then shorter battle', () => {
    const tie = (o) => presetStats({ cy: 0, ...o });
    assert.equal(mod.bestEntry([{ key: 'a', entry: entry(tie({ all: 50 })) }, { key: 'b', entry: entry(tie({ all: 20 })) }], cy).key, 'b');
    assert.equal(mod.bestEntry([{ key: 'a', entry: entry(tie({ repair: 900 })) }, { key: 'b', entry: entry(tie({ repair: 300 })) }], cy).key, 'b');
    assert.equal(mod.bestEntry([{ key: 'a', entry: entry(tie({ own: 60 })) }, { key: 'b', entry: entry(tie({ own: 90 })) }], cy).key, 'b');
    assert.equal(mod.bestEntry([{ key: 'a', entry: entry(tie({ ms: 90000 })) }, { key: 'b', entry: entry(tie({ ms: 40000 })) }], cy).key, 'b');
    // duration counts up to 2 minutes only
    assert.equal(mod.compareByCriteria(tie({ ms: 200000 }), tie({ ms: 120000 }), cy), 0);
});

test('CY preset: best valid entry, else the best invalid one; null without entries', () => {
    const list = [
        { key: 'best-invalid', entry: entry(presetStats({ cy: 0 }), false) },
        { key: 'valid', entry: entry(presetStats({ cy: 50 })) },
    ];
    assert.equal(mod.bestEntry(list, cy).key, 'valid');
    assert.equal(mod.bestEntry([list[0]], cy).key, 'best-invalid');
    assert.equal(mod.bestEntry([], cy), null);
    const c = new mod.SimCache();
    c.add(7, 'x', { stats: presetStats({ cy: 30 }) });
    c.add(7, 'y', { stats: presetStats({ cy: 10 }) });
    assert.equal(c.best(7, cy).key, 'y');
    assert.equal(c.best(8, cy), null);
});

// ── statistics window cells ──

const fmt = { time: (s) => `t${Math.round(s)}`, number: (n) => `n${Math.round(n)}` };

test('visibleEnemyRows: Total, Base, CY always; Def, DF, CC, … only when the live target has them', () => {
    assert.deepEqual(mod.visibleEnemyRows(null), ['overall', 'structure', 'cy']);
    const s = mod.emptyStats();
    for (const k of ['overall', 'structure', 'cy', 'defense', 'df']) s.enemy[k].hp.max = 10;
    assert.deepEqual(mod.visibleEnemyRows(s), ['overall', 'defense', 'structure', 'cy', 'df']);
});

test('columnCells: empty column shows dashes', () => {
    const c = mod.columnCells(null, fmt);
    assert.equal(c.battle.outcome, null);
    assert.equal(c.battle.duration.text, '-:--');
    assert.equal(c.enemy.df.text, '-');
    assert.equal(c.repair.crystal.text, '-');
    assert.equal(c.loot.total.text, '-');
});

test('columnCells: percentages, repair times with the bottleneck glowing, crystal as a number, loot', () => {
    const s = mod.emptyStats();
    Object.assign(s.enemy.overall.hp, { max: 200, end: 50 });
    Object.assign(s.enemy.df.hp, { max: 100, end: 100 });
    s.enemy.overall.res[RES.TIB] = 300;
    Object.assign(s.offense.overall.hp, { max: 100, end: 60 });
    Object.assign(s.offense.vehicle.hp, { max: 100, end: 60 });
    s.offense.overall.res[RES.RC_VEH] = 4260;
    s.offense.overall.res[RES.RC_INF] = 120;
    s.offense.overall.res[RES.CRY] = 89846;
    s.battleDuration = 56000;
    const c = mod.columnCells({ stats: s, base: 'Grote Base', storage: 122, loot: { [RES.TIB]: 600 } }, fmt);
    assert.equal(c.battle.outcome, 'victory');
    assert.equal(c.battle.duration.text, 't56');
    assert.equal(c.battle.base.text, 'Grote Base');
    assert.equal(c.enemy.overall.text, '25.0 %');
    assert.equal(c.enemy.df.text, '100 %');
    assert.equal(c.repair.storage.text, 't122');
    assert.equal(c.repair.overall.text, 't4260');
    assert.equal(c.repair.overall.glow, true);
    assert.equal(c.repair.vehicle.text, 't4260');
    assert.equal(c.repair.crystal.text, 'n89846');
    assert.equal(c.loot.tiberium.text, 'n300');
    assert.equal(c.loot.tiberium.color, mod.colorFromRatio(0.5));
});

// ── display ──

test('formatPercent: TABS digits', () => {
    assert.equal(mod.formatPercent(0, 100), '0 %');
    assert.equal(mod.formatPercent(100, 100), '100 %');
    assert.equal(mod.formatPercent(37.54, 100), '37.5 %');
    assert.equal(mod.formatPercent(3.456, 100), '3.46 %');
});

test('colorFromRatio: green → yellow → red', () => {
    assert.equal(mod.colorFromRatio(0), 'hsl(120, 100%, 35%)');
    assert.equal(mod.colorFromRatio(0.5), 'hsl(60, 100%, 30%)');
    assert.equal(mod.colorFromRatio(1), 'hsl(0, 100%, 55%)');
    assert.equal(mod.colorFromRatio(NaN), null);
});

test('battleOutcome', () => {
    const s = mod.emptyStats();
    s.offense.overall.hp.end = 1;
    s.enemy.overall.hp.end = 0;
    assert.equal(mod.battleOutcome(s), 'total-victory');
    s.offense.overall.hp.end = 0;
    assert.equal(mod.battleOutcome(s), 'total-defeat');
});

test('tabsLoaded: global TABS or the qx class', () => {
    assert.equal(mod.tabsLoaded({}), false);
    assert.equal(mod.tabsLoaded({ TABS: {} }), true);
    assert.equal(mod.tabsLoaded({ qx: { Class: { getByName: (n) => (n === 'TABS' ? {} : null) } } }), true);
});

test('/st status: "inactive — TABS detected" when TABS loaded after STABS, else no override', () => {
    const toolbar = { register() {}, unregister() {} };
    const config = { get: (k, d) => d, set() {} };
    globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {} };
    globalThis.window = globalThis;     // tabsLoaded() looks at window, the page in the game
    const stabs = new mod.Stabs(config, toolbar);
    stabs.running = true;                // started while TABS was not there yet
    delete globalThis.TABS;
    globalThis.qx = undefined;
    assert.equal(stabs.statusState(), null);
    globalThis.TABS = {};                // TABS loads later
    try {
        assert.equal(stabs.statusState(), 'inactive — TABS detected');
        assert.equal(stabs.tabsActive, true);
        assert.match(stabs.statusText(), /turn one off/);
    } finally {
        delete globalThis.TABS;
    }
    stabs.running = false;
    assert.equal(stabs.statusState(), null);
});

test('STABS is parked: off by default and not offered in /st help', () => {
    const stabs = new mod.Stabs({ get: (k, d) => d, set() {} }, { register() {}, unregister() {} });
    assert.equal(stabs.defaultEnabled, false);
    assert.equal(stabs.parked, true);
    const model = mod.getHelpModel('5.27.0', [{ name: 'CampTracker', description: 'c' }, stabs], {});
    const names = model.sections[0].sub.rows.map(r => r[0]);
    assert.deepEqual(names, ['camp-tracker']);
});
