// ProductionOverview (plugins/production-overview.js) + the shared table (lib/overview-panel.js).
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
            contents: `export * from './plugins/production-overview.js';
                export { compact, renderTable, ownBases } from './lib/overview-panel.js';
                export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const R = { Tiberium: 1, Crystal: 2, Power: 6 };

function city(id, name, prod, { own = true, ghost = false } = {}) {
    return {
        IsOwnBase: () => own, get_IsGhostMode: () => ghost, get_Id: () => id, get_Name: () => name,
        GetResourceGrowPerHour: (type, a, b) => { assert.equal(a, false); assert.equal(b, false); return prod.cont[type]; },
        GetResourceBonusGrowPerHour: (type) => {
            if (prod.bonus[type] === 'throw') throw new Error('x');
            return prod.bonus[type];
        },
        get_CityCreditsProduction: () => ({ cont: prod.credits, bonus: prod.creditsBonus }),
    };
}

function setup(cities, { poi = { 1: 100, 2: 200, 6: 300 }, alliance = true } = {}) {
    globalThis.ClientLib = {
        Base: {
            EResourceType: R,
            Resource: {
                GetResourceGrowPerHour: (p, flag) => { assert.equal(flag, false); return p.cont; },
                GetResourceBonusGrowPerHour: (p, flag) => { assert.equal(flag, false); return p.bonus; },
            },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
            get_Alliance: () => (alliance ? { get_Exists: () => true, GetPOIBonusFromResourceType: (t) => poi[t] } : { get_Exists: () => false }),
        }) } },
    };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

const P1 = { cont: { 1: 1000, 2: 2000, 6: 3000 }, bonus: { 1: 10, 2: 20, 6: 30 }, credits: 500, creditsBonus: 50 };
const P2 = { cont: { 1: 4000, 2: 5000, 6: 6000 }, bonus: { 1: 40, 2: 'throw', 6: 60 }, credits: 700, creditsBonus: 70 };

function toolbarStub() { return { register() {}, unregister() {} }; }
function cliStub() { return { register() {}, unregister() {} }; }

test('readCity: continuous, bonus, POI and total per resource; credits without POI', () => {
    setup([]);
    const p = mod.readCity(city(1, 'A', P1), { GetPOIBonusFromResourceType: (t) => ({ 1: 100, 2: 200, 6: 300 })[t] });
    assert.deepEqual(p.tib, { cont: 1000, bonus: 10, poi: 100, total: 1110 });
    assert.deepEqual(p.power, { cont: 3000, bonus: 30, poi: 300, total: 3330 });
    assert.deepEqual(p.credits, { cont: 500, bonus: 50, poi: 0, total: 550 });
});

test('read: own non-ghost bases only, failing getter is null and left out of the totals', () => {
    setup([city(1, 'A', P1), city(2, 'B', P2), city(3, 'Ghost', P1, { ghost: true }), city(4, 'Foreign', P1, { own: false })]);
    const plugin = new mod.ProductionOverview(fakeConfig(), toolbarStub(), cliStub());
    const d = plugin.read();
    assert.deepEqual(d.rows.map(r => r.name), ['A', 'B']);
    assert.equal(d.rows[1].values.cry_bonus, null);
    assert.equal(d.rows[1].values.cry_total, 5200);                // 5000 + POI 200, bonus unknown
    assert.equal(d.total.values.tib_total, 1110 + 4140);
    assert.equal(d.total.values.cry_bonus, 20);                    // only A's
    assert.equal(d.total.values.credits_total, 550 + 770);
});

test('read: no alliance -> POI 0; no bases -> null', () => {
    setup([city(1, 'A', P1)], { alliance: false });
    const plugin = new mod.ProductionOverview(fakeConfig(), toolbarStub(), cliStub());
    assert.equal(plugin.read().rows[0].values.tib_poi, 0);
    setup([]);
    assert.equal(plugin.read(), null);
});

test('columns: 4 resources x 4 parts, minus credits POI', () => {
    const cols = mod.columns();
    assert.equal(cols.length, 15);
    assert.ok(!cols.some(c => c.key === 'credits_poi'));
    assert.equal(cols[0].group, 'Tiberium');
});

test('renderTable: base names carry data-id, total row, escaped names', () => {
    const html = mod.renderTable({
        columns: [{ key: 'a', label: 'A', group: 'G' }],
        rows: [{ id: 7, name: '<x>', values: { a: 1234567 } }],
        total: { values: { a: null } },
        jumpHint: 'open',
    });
    assert.match(html, /data-id="7"/);
    assert.match(html, /&lt;x&gt;/);
    assert.match(html, /1\.23M/);
    assert.match(html, /Total/);
    assert.match(html, /—/);
});

test('compact', () => {
    assert.equal(mod.compact(950), '950');
    assert.equal(mod.compact(12345), '12.3k');
    assert.equal(mod.compact(-2500000), '-2.50M');
    assert.equal(mod.compact(3e9), '3.00G');
    assert.equal(mod.compact(null), '—');
});
