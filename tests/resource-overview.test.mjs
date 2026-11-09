// ResourceOverview (plugins/resource-overview.js): storage per base, fill %, "full at".
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
            contents: `export * from './plugins/resource-overview.js'; export { renderTable } from './lib/overview-panel.js'; export { initI18n } from './lib/i18n.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const R = { Tiberium: 1, Crystal: 2, Power: 6 };
const HOUR = 3600 * 1000;

function city(id, name, { cur, max, rate }, { own = true, ghost = false } = {}) {
    return {
        IsOwnBase: () => own, get_IsGhostMode: () => ghost, get_Id: () => id, get_Name: () => name,
        GetResourceCount: (t) => cur[t],
        GetResourceMaxStorage: (t) => max[t],
        GetResourceGrowPerHour: (t, a, b) => { assert.equal(a, true); assert.equal(b, true); return rate[t]; },
    };
}

function setup(cities) {
    globalThis.ClientLib = {
        Base: { EResourceType: R },
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
        }) } },
    };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}
const stub = () => ({ register() {}, unregister() {} });

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

test('fullAt: already full = now, filling = now + remaining / rate, not filling = null', () => {
    const now = 1_000_000;
    assert.equal(mod.fullAt(100, 100, 10, now), now);
    assert.equal(mod.fullAt(50, 100, 25, now), now + 2 * HOUR);
    assert.equal(mod.fullAt(50, 100, 0, now), null);
    assert.equal(mod.fullAt(50, 100, null, now), null);
    assert.equal(mod.fullAt(null, 100, 10, now), null);
    assert.equal(mod.fullAt(50, 0, 10, now), null);
});

test('levelStyle: red when full, yellow above 75 %, nothing otherwise', () => {
    assert.match(mod.levelStyle(100), /ff5252/);
    assert.match(mod.levelStyle(76), /ffd740/);
    assert.equal(mod.levelStyle(75), '');
    assert.equal(mod.levelStyle(null), '');
});

test('formatFullAt: "full", clock time today, date on another day, "—" unknown', () => {
    const now = new Date(2026, 10, 9, 10, 0).getTime();
    assert.equal(mod.formatFullAt(now, now), 'full');
    assert.equal(mod.formatFullAt(new Date(2026, 10, 9, 14, 5).getTime(), now), '14:05');
    assert.equal(mod.formatFullAt(new Date(2026, 10, 12, 8, 30).getTime(), now), '12.11. 08:30');
    assert.equal(mod.formatFullAt(null, now), '—');
});

test('read: own bases, %, full at rounded to minutes, totals with overall %', () => {
    const a = city(1, 'A', { cur: { 1: 1000, 2: 750.6, 6: 0 }, max: { 1: 1000, 2: 1000, 6: 1000 }, rate: { 1: 50, 2: 249.4, 6: 0 } });
    const b = city(2, 'B', { cur: { 1: 0, 2: 250, 6: 500 }, max: { 1: 1000, 2: 1000, 6: 1000 }, rate: { 1: 100, 2: 0, 6: 100 } });
    setup([a, b, city(3, 'G', { cur: {}, max: {}, rate: {} }, { ghost: true })]);
    const p = new mod.ResourceOverview(fakeConfig(), stub(), stub());
    const now = Date.UTC(2026, 10, 9, 10, 0, 30);
    const d = p.read(now);
    const minute = Math.floor(now / 60000) * 60000;
    assert.equal(d.now, minute);
    assert.deepEqual(d.rows.map(r => r.name), ['A', 'B']);
    const va = d.rows[0].values;
    assert.equal(va.tib_pct, 100);
    assert.equal(va.tib_full, minute);
    assert.equal(va.cry_cur, 750);                         // stock floored
    assert.equal(va.cry_full, minute + HOUR);              // (1000 - 750.6) / 249.4 = 1 h
    assert.equal(va.power_full, null);                     // not filling
    assert.equal(d.rows[1].values.tib_full, minute + 10 * HOUR);
    assert.equal(d.total.values.tib_cur, 1000);
    assert.equal(d.total.values.tib_max, 2000);
    assert.equal(d.total.values.tib_pct, 50);
    assert.equal(d.total.values.tib_full, null);
});

test('render: total row has no "full at", full cell is red', () => {
    const a = city(1, 'A', { cur: { 1: 1000, 2: 0, 6: 0 }, max: { 1: 1000, 2: 1000, 6: 1000 }, rate: { 1: 1, 2: 1, 6: 1 } });
    setup([a]);
    const p = new mod.ResourceOverview(fakeConfig(), stub(), stub());
    const d = p.read();
    const html = mod.renderTable({ columns: mod.columns(d.now), rows: d.rows, total: d.total });
    assert.match(html, /ff5252[^>]*>full</);
    assert.match(html, />100%</);
    assert.equal(mod.columns(d.now).length, 12);
});

test('read: no bases -> null', () => {
    setup([]);
    assert.equal(new mod.ResourceOverview(fakeConfig(), stub(), stub()).read(), null);
});
