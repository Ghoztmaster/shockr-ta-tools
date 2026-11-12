// ClientLib patches (lib/clientlib-patch.js): the wrapper functions TABS V2 calls.
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
        stdin: { contents: `export * from './lib/clientlib-patch.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    const url = 'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64');
    return import(url + '#' + Math.random());
}

// Minified shapes as the game ships them (names made up, structure as in the client).
const HAS_UNIT = 'function(e){var t,i;for(t in{d:this.TBXDNO}.d.d)if(this.TBXDNO.d[t].get_MdbUnitId()==e)return!0;for(i in{d:this.IPEJRQ}.d.d)if(this.IPEJRQ.d[i].get_MdbUnitId()==e)return!0;return!1}';
const START_WRAPPER = 'function(e,t){this.QWERTY=(new $I.SIMCLS).$ctor(e,t);this.ZZZ=1;if(this.ABC){this.QWERTY.STEPFN(!1)}}';
const START_SPACED = `function (e, t) {
    this.qwerty = new $I.SimCls(e, t);
    while (this.qwerty.stepFn(false)) {}
}`;

function setup({ hasUnit = HAS_UNIT, startBattle = START_WRAPPER, simClass = 'SIMCLS', step = 'STEPFN', extraBg = {} } = {}) {
    const CityUnits = function () {};
    CityUnits.prototype.HasUnitMdbId = new Function('return ' + hasUnit)();
    const Battleground = function () {};
    if (startBattle) Battleground.prototype.StartBattle = new Function('return ' + startBattle)();
    Object.assign(Battleground.prototype, extraBg);
    const Sim = function () {};
    Sim.prototype[step] = function (x) { return `stepped:${x}`; };
    globalThis.$I = { [simClass]: Sim };
    globalThis.ClientLib = {
        Data: { CityUnits, WorldSector: {} },
        Vis: { Battleground: { Battleground } },
        Net: {},
    };
    return { CityUnits, Battleground, Sim };
}

function only(PATCHES, name) { return PATCHES.filter(p => p.name === name); }

test('CityUnits: get_OffenseUnits / get_DefenseUnits methods return the two collections', async () => {
    const { applyPatches, PATCHES } = await load();
    const { CityUnits } = setup();
    const [r] = applyPatches(only(PATCHES, 'CityUnits'));
    assert.equal(r.ok, true, JSON.stringify(r));
    const cu = new CityUnits();
    cu.TBXDNO = { d: { a: 1 } };
    cu.IPEJRQ = { d: { b: 2 } };
    assert.equal(typeof CityUnits.prototype.get_OffenseUnits, 'function');
    assert.equal(cu.get_OffenseUnits(), cu.TBXDNO);
    assert.equal(cu.get_DefenseUnits(), cu.IPEJRQ);
    assert.equal(cu.$OffenseUnits, cu.TBXDNO);
});

test('CityUnits: fallback pattern with whitespace and longer names', async () => {
    const { applyPatches, PATCHES } = await load();
    const { CityUnits } = setup({ hasUnit: 'function (e) { for (var t in { d: this.offenseUnitsX }) {} for (var i in { d: this.defenseUnitsY }) {} }' });
    const [r] = applyPatches(only(PATCHES, 'CityUnits'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.matched.get_OffenseUnits, 'offenseUnitsX');
    assert.equal(r.matched.get_DefenseUnits, 'defenseUnitsY');
    const cu = new CityUnits();
    cu.defenseUnitsY = 7;
    assert.equal(cu.get_DefenseUnits(), 7);
});

test('CityUnits: an existing method (infernal wrapper still installed) is kept', async () => {
    const { applyPatches, PATCHES } = await load();
    const { CityUnits } = setup();
    const theirs = function () { return 'wrapper'; };
    CityUnits.prototype.get_OffenseUnits = theirs;
    applyPatches(only(PATCHES, 'CityUnits'));
    assert.equal(CityUnits.prototype.get_OffenseUnits, theirs);
});

test('Battleground: get_Simulation and DoStep from the wrapper fingerprint', async () => {
    const { applyPatches, PATCHES } = await load();
    const { Battleground, Sim } = setup();
    const [r] = applyPatches(only(PATCHES, 'Battleground'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.matched.get_Simulation, 'QWERTY');
    assert.equal(r.matched.DoStep, '$I.SIMCLS.prototype.STEPFN');
    const bg = new Battleground();
    bg.QWERTY = new Sim();
    assert.equal(bg.get_Simulation(), bg.QWERTY);
    assert.equal(bg.get_Simulation().DoStep(false), 'stepped:false');
});

test('Battleground: fallback pattern (no parentheses, whitespace, while-loop call)', async () => {
    const { applyPatches, PATCHES } = await load();
    setup({ startBattle: START_SPACED, simClass: 'SimCls', step: 'stepFn' });
    const [r] = applyPatches(only(PATCHES, 'Battleground'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.matched.get_Simulation, 'qwerty');
    assert.equal(typeof $I.SimCls.prototype.DoStep, 'function');
});

test('Battleground: StartBattle renamed - found in another Battleground function', async () => {
    const { applyPatches, PATCHES } = await load();
    setup({ startBattle: null, extraBg: { BeginCombat: new Function('return ' + START_WRAPPER)() } });
    const [r] = applyPatches(only(PATCHES, 'Battleground'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.matched.get_Simulation, 'QWERTY');
});

test('Battleground: step method missing on the $I class = failure, not a wrong patch', async () => {
    const { applyPatches, PATCHES } = await load();
    const { Battleground } = setup({ step: 'otherName' });
    const [r] = applyPatches(only(PATCHES, 'Battleground'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.failed, ['get_Simulation', 'DoStep']);
    assert.equal(Battleground.prototype.get_Simulation, undefined);
});

test('phe: webfrontend.phe becomes the global phe', async () => {
    const { globalizePhe } = await load();
    const phe = { cnc: { Util: {} } };
    const root = { webfrontend: { phe } };
    assert.equal(await globalizePhe({ root, intervalMs: 1 }), 'set');
    assert.equal(root.phe, phe);
});

test('phe: waits for webfrontend.phe to appear', async () => {
    const { globalizePhe } = await load();
    const root = {};
    const done = globalizePhe({ root, intervalMs: 5, maxAttempts: 100 });
    setTimeout(() => { root.webfrontend = { phe: { late: true } }; }, 30);
    assert.equal(await done, 'set');
    assert.equal(root.phe.late, true);
});

test('phe: an existing global phe is kept', async () => {
    const { globalizePhe } = await load();
    const theirs = { mine: false };
    const root = { phe: theirs, webfrontend: { phe: {} } };
    assert.equal(await globalizePhe({ root, intervalMs: 1 }), 'existing');
    assert.equal(root.phe, theirs);
});

test('phe: gives up after maxAttempts instead of polling forever', async () => {
    const { globalizePhe } = await load();
    const root = { webfrontend: {} };
    const t0 = Date.now();
    assert.equal(await globalizePhe({ root, intervalMs: 2, maxAttempts: 10 }), false);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal('phe' in root, false);
});

test('Battleground: no fingerprint at all = both reported failed', async () => {
    const { applyPatches, PATCHES } = await load();
    setup({ startBattle: 'function(){return 1}' });
    const [r] = applyPatches(only(PATCHES, 'Battleground'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.failed, ['get_Simulation', 'DoStep']);
});
