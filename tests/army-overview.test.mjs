// ArmyOverview (plugins/army-overview.js): MaelstromTools-style overview + repair charges.
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
            contents: `export * from './plugins/army-overview.js'; export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const G = { Infantry: 1, Vehicle: 2, Aircraft: 3 };
const CHARGE = 9;

function city(id, name, o = {}) {
    const {
        rt = { 1: 600, 2: 1200, 3: 900 }, charges = 3000, chargesMax = 54000,
        offHealth = 100, defHealth = 100, baseHealth = 100,
        slots = [33, 33], def = [90, 95], off = [200, 200], ghost = false,
    } = o;
    const ud = {
        GetRepairTimeFromEUnitGroup: (g, flag) => { assert.equal(flag, false); return rt[g]; },
        get_TotalDefenseHeadCount: () => def[0], get_UnitLimitDefense: () => def[1],
        get_TotalOffenseHeadCount: () => off[0], get_UnitLimitOffense: () => off[1],
    };
    return {
        IsOwnBase: () => true, get_IsGhostMode: () => ghost, get_Id: () => id, get_Name: () => name,
        get_LvlBase: () => 30.258, get_LvlDefense: () => 28.5, get_LvlOffense: () => 31.049,
        GetBuildingSlotCount: () => slots[0], GetBuildingSlotLimit: () => slots[1],
        GetBuildingsConditionInPercent: () => baseHealth,
        GetDefenseConditionInPercent: () => defHealth,
        GetOffenseConditionInPercent: () => offHealth,
        get_CityUnitsData: () => ud,
        GetResourceCount: (type) => { assert.equal(type, CHARGE); return charges; },
        GetResourceMaxStorage: (type) => { assert.equal(type, CHARGE); return chargesMax; },
    };
}

function setup(cities) {
    globalThis.ClientLib = {
        Base: { EResourceType: { RepairChargeInf: CHARGE } },
        Data: {
            EUnitGroup: G,
            MainData: { GetInstance: () => ({
                get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
            }) },
        },
    };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}
const stub = () => ({ register() {}, unregister() {} });

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

test('repairStats: ceil(charges / RT), one less + * when unhealthy, max = ceil(max / RT)', () => {
    let s = mod.repairStats(3000, 54000, 1200, 100);
    assert.equal(s.cur, 3);              // ceil(2.5)
    assert.equal(s.star, false);
    assert.equal(s.max, 45);
    assert.equal(s.next, 600);           // 3 × 1200 − 3000
    assert.equal(s.maxNext, 45 * 1200 - 3000);
    s = mod.repairStats(1000, 54000, 1200, 80);
    assert.equal(s.cur, 0);              // ceil(0.83) − 1
    assert.equal(s.star, true);
    assert.equal(s.next, 200);
});

test('repairStats: no repair time -> 0 / 0; exact multiple -> no next; level above storage -> nextOver', () => {
    assert.deepEqual(mod.repairStats(3000, 54000, 0, 100), { cur: 0, star: false, max: 0, next: null, nextOver: false, maxNext: null });
    assert.equal(mod.repairStats(2400, 54000, 1200, 100).next, null);
    assert.equal(mod.repairStats(500, 1000, 1200, 100).nextOver, true);
    assert.equal(mod.repairStats(null, 1000, 1200, 100).cur, null);
});

test('formatDuration: fallback m:ss, h:mm:ss, d:hh:mm:ss over 24 h; game formatter when there', () => {
    setup([]);
    assert.equal(mod.formatDuration(330), '5:30');
    assert.equal(mod.formatDuration(3930), '1:05:30');
    assert.equal(mod.formatDuration(4 * 86400 + 12 * 3600 + 11 * 60 + 42), '4:12:11:42');
    assert.equal(mod.formatDuration(null), '—');
    globalThis.ClientLib.Vis = { VisMain: { FormatTimespan: (s) => `game:${s}` } };
    assert.equal(mod.formatDuration(70), 'game:70');
    delete globalThis.ClientLib.Vis;
});

test('level: floored to 2 decimals', () => {
    assert.equal(mod.level(30.258), '30.25');
    assert.equal(mod.level(28.5), '28.50');
    assert.equal(mod.level(null), '—');
});

test('readCity: buildings, head counts, healths, charges as a number', () => {
    setup([]);
    const v = mod.readCity(city(1, 'A', { charges: 3000.7, defHealth: -5 }));
    assert.deepEqual([v.base_cur, v.base_max, v.def_cur, v.def_max, v.off_cur, v.off_max], [33, 33, 90, 95, 200, 200]);
    assert.equal(v.def_health, 0);       // negative → 0, as MaelstromTools
    assert.equal(v.charges, 3000);
    assert.equal(v.rt_max, 1200);
    assert.equal(v.att_cur, 3);
    assert.equal(v.att_max, 45);
});

test('render: two sections; repair section only bases with an army; offense view on repair names', () => {
    setup([
        city(7, 'Army', { offHealth: 80, charges: 1000 }),
        city(8, 'NoArmy', { off: [0, 0] }),
        city(9, 'Ghost', { ghost: true }),
    ]);
    const p = new mod.ArmyOverview(fakeConfig(), stub(), stub());
    const html = mod.render(p.read());
    const [overview, repair] = html.split('Repair charges');
    assert.match(overview, /33 \/ 33/);
    assert.match(overview, /200 \/ 200/);
    assert.match(overview, />NoArmy</);
    assert.doesNotMatch(overview, /Ghost/);
    assert.doesNotMatch(repair, /NoArmy/);
    assert.match(repair, /data-id="7" data-view="offense"/);
    assert.match(repair, />0\* \/ 45</);            // unhealthy: ceil(1000/1200) − 1, marked *
    assert.match(repair, />16:40</);                // charges 1000 s as a timespan (fallback formatter)
    assert.match(repair, /ffd740[^>]*>20:00</);     // vehicles = longest RT, yellow
    assert.doesNotMatch(overview, /data-view/);
});

test('render: defense/army cells empty when that unit limit is 0; free-slot colours', () => {
    setup([city(1, 'A', { off: [0, 0], slots: [32, 33], def: [85, 95] })]);
    const p = new mod.ArmyOverview(fakeConfig(), stub(), stub());
    const html = mod.render(p.read());
    assert.match(html, /ff5252[^>]*>32 \/ 33</);    // a free base slot: red
    assert.match(html, /ff5252[^>]*>85 \/ 95</);    // 10 free defense: red
    assert.doesNotMatch(html, /0 \/ 0/);
    assert.match(html, /No base with an army/);
});
