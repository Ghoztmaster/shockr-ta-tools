// UpgradePriority (plugins/upgrade-priority.js): gain/h, factor, ETA, state, top pick, filters, upgrade.
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
        stdin: { contents: `export * from './plugins/upgrade-priority.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const R = { Tiberium: 1, Crystal: 2, Gold: 3, Power: 4 };
const T = { Harvester: 10, Harvester_Crystal: 11, Silo: 12, PowerPlant: 13, Accumulator: 14, Refinery: 15 };
const M = { TiberiumPackageSize: 20, TiberiumProduction: 21, CrystalPackageSize: 22, CrystalProduction: 23,
    PowerPackageSize: 24, PowerProduction: 25, CreditsPackageSize: 26, CreditsProduction: 27, PackageTime: 30 };

/** A refinery: credits production +gain/h on the next level, cost tib/power. */
function building(id, { tech = T.Refinery, level = 10, gain = 100, tib = 1000, power = 500, x = 1, y = 2 } = {}) {
    return {
        get_Id: () => id, get_CurrentLevel: () => level, get_TechName: () => tech,
        get_CoordX: () => x, get_CoordY: () => y, get_MainModifierTypeId: () => M.PackageTime,
        get_TechGameData_Obj: () => ({ tib, power }),
        dv: { OwnProdModifiers: { d: { [M.CreditsProduction]: { TotalValue: 0, NewLvlDelta: gain } } } },
    };
}

function city(id, name, buildings, { tib = 5000, power = 5000, prodTib = 1000, prodPower = 500 } = {}) {
    return {
        IsOwnBase: () => true, get_IsGhostMode: () => false, get_Id: () => id, get_Name: () => name,
        get_Buildings: () => ({ d: Object.fromEntries(buildings.map(b => [b.get_Id(), b])) }),
        GetBuildingDetailViewInfo: (b) => b.dv,
        GetResourceCount: (type) => ({ [R.Tiberium]: tib, [R.Power]: power, [R.Crystal]: 0 }[type] || 0),
        GetResourceGrowPerHour: (type) => ({ [R.Tiberium]: prodTib, [R.Power]: prodPower, [R.Crystal]: 0 }[type] || 0),
        GetResourceBonusGrowPerHour: () => 0,
        get_CityCreditsProduction: () => null,
    };
}

const sent = [];
function setup(cities, { cap = 100 } = {}) {
    sent.length = 0;
    globalThis.ClientLib = {
        Base: {
            EResourceType: R, ETechName: T, EModifierType: M,
            Util: { GetTechLevelResourceRequirements_Obj: (lvl, tgd) => [{ Type: R.Tiberium, Count: tgd.tib }, { Type: R.Power, Count: tgd.power }, { Type: 0, Count: 9 }] },
            Resource: { GetResourceGrowPerHour: () => 0, GetResourceBonusGrowPerHour: () => 0 },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
            get_Server: () => ({ get_PlayerUpgradeCap: () => cap }),
            get_Alliance: () => null,
        }) } },
        Vis: { VisMain: { FormatTimespan: (s) => `${Math.round(s)}s` } },
        Net: {
            CommandResult: 'CR',
            CommunicationManager: { GetInstance: () => ({ SendCommand: (name, args, cb) => { sent.push([name, args]); cb(null, 0); } }) },
        },
    };
    globalThis.phe = { cnc: { Util: { createEventDelegate: (type, ctx, fn) => fn } } };
    globalThis.qx = { core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ showMessage() {} }) }) }) } } };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; }, data };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

test('gainPerHour: production NewLvlDelta + package size via the main modifier', () => {
    setup([]);
    // packages every 3600 s of 100 now; next level every 1800 s of 150 -> 300/h - 100/h = +200/h; + 10 production
    const mods = {
        [M.PackageTime]: { TotalValue: 3600, NewLvlDelta: -1800 },
        [M.TiberiumPackageSize]: { TotalValue: 100, NewLvlDelta: 50 },
        [M.TiberiumProduction]: { TotalValue: 500, NewLvlDelta: 10 },
        [M.CrystalProduction]: { TotalValue: 1, NewLvlDelta: 99 },
    };
    assert.equal(mod.gainPerHour(mods, M.PackageTime, M.TiberiumPackageSize, M.TiberiumProduction), 210);
    assert.equal(mod.gainPerHour({ [M.TiberiumPackageSize]: { TotalValue: 1, NewLvlDelta: 1 } }, M.PackageTime, M.TiberiumPackageSize, M.TiberiumProduction), 0);
});

test('rate: factor = max 3600*(cost/gain)/prod, ETA from missing tib/power, states', () => {
    setup([]);
    const base = { gain: 100, costs: { [R.Tiberium]: 1000, [R.Power]: 500 }, perHour: { [R.Tiberium]: 1000, [R.Power]: 100 } };
    const ok = mod.rate({ ...base, have: { [R.Tiberium]: 1000, [R.Power]: 500 }, totalTib: 0 });
    assert.equal(ok.factor, 3600 * 5 / 100);                 // power: 3600 * 5 / 100 = 180 > tib 36
    assert.equal(ok.eta, 0);
    assert.equal(ok.state, mod.STATE.AFFORDABLE);
    const tr = mod.rate({ ...base, have: { [R.Tiberium]: 400, [R.Power]: 500 }, totalTib: 2000 });
    assert.equal(tr.state, mod.STATE.TRANSFER);
    assert.equal(tr.eta, 3600 * 600 / 1000);
    const no = mod.rate({ ...base, have: { [R.Tiberium]: 1000, [R.Power]: 450 }, totalTib: 9999 });
    assert.equal(no.state, mod.STATE.NO);
    assert.equal(no.eta, 3600 * 50 / 100);
});

test('topRows: first not affordable, the one before the first affordable, first affordable; each once', () => {
    const A = mod.STATE.AFFORDABLE, N = mod.STATE.NO;
    const rows = [{ i: 0, state: N }, { i: 1, state: N }, { i: 2, state: A }, { i: 3, state: A }];
    assert.deepEqual(mod.topRows(rows).map(r => r.i), [0, 1, 2]);
    assert.deepEqual(mod.topRows([{ i: 0, state: N }, { i: 1, state: A }]).map(r => r.i), [0, 1]);
    assert.deepEqual(mod.topRows([{ i: 0, state: N }, { i: 1, state: N }, { i: 2, state: N }]).map(r => r.i), [0, 2]);
    assert.deepEqual(mod.topRows([{ i: 0, state: A }, { i: 1, state: A }]).map(r => r.i), [0]);
    assert.deepEqual(mod.topRows([]), []);
});

test('readPriority: credits tab, sorted by factor, cap and type filter, base filter, affordable filter', () => {
    const cheap = building(1, { gain: 200, tib: 1000, power: 500 });
    const dear = building(2, { gain: 100, tib: 1000, power: 500 });
    const tooDear = building(3, { gain: 100, tib: 99999, power: 500 });
    const capped = building(4, { level: 100 });
    const silo = building(5, { tech: T.Silo });
    const a = city(100, 'A', [dear, cheap, tooDear, capped, silo]);
    const b = city(200, 'B', [building(6)]);
    setup([a, b]);
    const all = mod.readPriority({ tab: 'credits', top: false, affordable: false, cityOn: (id) => id !== 200 });
    assert.deepEqual(all.rows.map(r => r.id), [1, 2, 3]);
    assert.deepEqual(all.cities, [{ id: 100, name: 'A', on: true }, { id: 200, name: 'B', on: false }]);
    assert.equal(all.rows[0].type, 'Refinery');
    assert.equal(all.rows[0].level, 11);
    assert.equal(all.rows[0].tibPerGain, 5);
    assert.equal(all.rows[2].state, mod.STATE.NO);
    const aff = mod.readPriority({ tab: 'credits', top: false, affordable: true, cityOn: () => true });
    assert.deepEqual(aff.rows.map(r => r.id), [1, 2, 6]);
    const html = mod.renderPriority(all);
    assert.match(html, /data-id="1" data-view="upgrade"/);
    assert.doesNotMatch(html, /data-id="3" data-view="upgrade"/);
    assert.match(html, /☐ B/);
    assert.match(html, /Refinery \(1:2\)/);
});

test('plugin: filters persist per tab, upgrade sends UpgradeBuilding for affordable rows', async () => {
    setup([city(100, 'A', [building(1, { x: 3, y: 4 }), building(2, { tib: 99999 })])]);
    const cfg = fakeConfig();
    const p = new mod.UpgradePriority(cfg, { register() {}, unregister() {} }, { register() {}, unregister() {} });
    p.running = true;
    p.panel.refresh = () => {};
    assert.equal(p.tab(), 'credits');
    p._onClick(0, 'tab');
    assert.equal(p.tab(), 'tib');
    p._onClick(0, 'top');
    assert.equal(cfg.data['upgradeprio.top.tib'], false);
    p._onClick(100, 'city');
    assert.equal(p.filters().cityOn(100), false);
    assert.equal(p.filters().cityOn(7), true);
    p.config.set('upgradeprio.tab', 'credits');
    p.panel.data = mod.readPriority({ ...p.filters(), top: false, affordable: false });
    const l = console.log; console.log = () => {};
    const ok = await p.upgrade(p.panel.data.rows.filter(r => r.state === mod.STATE.AFFORDABLE));
    console.log = l;
    assert.equal(ok, 1);
    assert.deepEqual(sent, [['UpgradeBuilding', { cityid: 100, posX: 3, posY: 4, isPaid: true }]]);
    assert.equal(p.name, 'UpgradePriority');
});
