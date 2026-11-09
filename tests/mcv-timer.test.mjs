// McvTimer (plugins/mcv-timer.js): progress to the next MCV.
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
        stdin: { contents: `export * from './plugins/mcv-timer.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const GOLD = 3;
const RP = 6;

function setup({ next = { rr: [{ t: GOLD, c: 1000000 }, { t: RP, c: 400000 }, { t: 0, c: 5 }] }, item = true,
    credits = 250000, rp = 500000, delta = 10, bonus = 5, stepsPerHour = 1200 } = {}) {
    globalThis.ClientLib = {
        Base: {
            EResourceType: { Gold: GOLD, ResearchPoints: RP },
            ETechName: { Research_BaseFound: 'BF' },
            Tech: { GetTechIdFromTechNameAndFaction: (name, faction) => { assert.equal(name, 'BF'); assert.equal(faction, 1); return 42; } },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Player: () => ({
                get_Faction: () => 1,
                get_PlayerResearch: () => ({
                    GetResearchItemFomMdbId: (id) => { assert.equal(id, 42); return item ? { get_NextLevelInfo_Obj: () => next } : null; },
                }),
                GetCreditsCount: () => credits,
                get_ResearchPoints: () => rp,
                get_Credits: () => ({ Delta: delta, ExtraBonusDelta: bonus }),
            }),
            get_Time: () => ({ get_StepsPerHour: () => stepsPerHour }),
        }) } },
    };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

test('readMcv: needed credits / RP from rr, credits per hour = (Delta + Bonus) x steps per hour', () => {
    setup();
    assert.deepEqual(mod.readMcv(), { credits: 250000, creditsNeeded: 1000000, rp: 500000, rpNeeded: 400000, creditsPerHour: 18000 });
});

test('readMcv: no next level -> null, no research item -> undefined', () => {
    setup({ next: null });
    assert.equal(mod.readMcv(), null);
    setup({ item: false });
    assert.equal(mod.readMcv(), undefined);
});

test('progress: %, ok flags and hours left; no growth -> null', () => {
    const p = mod.progress({ credits: 250000, creditsNeeded: 1000000, rp: 500000, rpNeeded: 400000, creditsPerHour: 18000 });
    assert.equal(p.credits.pct, 25);
    assert.equal(p.credits.ok, false);
    assert.ok(Math.abs(p.credits.hoursLeft - 750000 / 18000) < 1e-9);
    assert.equal(p.rp.pct, 125);
    assert.equal(p.rp.ok, true);
    assert.equal(mod.progress({ credits: 1, creditsNeeded: 10, rp: 0, rpNeeded: 1, creditsPerHour: 0 }).credits.hoursLeft, null);
});

test('daysFromHours: MaelstromTools format d.hh:mm', () => {
    assert.equal(mod.daysFromHours(41.6667), '1d.17:40');
    assert.equal(mod.daysFromHours(0.5), '0d.00:30');
});

test('render: extended shows both lines with colours; compact shows T$ / RP (+...)', () => {
    const p = mod.progress({ credits: 250000, creditsNeeded: 1000000, rp: 500000, rpNeeded: 400000, creditsPerHour: 18000 });
    const ext = mod.renderExtended(p);
    assert.match(ext, /ff8a7f;">Credits</);       // red: not enough
    assert.match(ext, /92ff7f;">RP</);            // green: enough
    assert.match(ext, /25%/);
    assert.match(ext, /1d\.17:39/);           // 41.666... h, minutes floored as MaelstromTools
    const cmp = mod.renderCompact(p);
    assert.match(cmp, /T\$ 1d\.17:39/);
    assert.match(cmp, /RP \(\+100\.0k\)/);
});

test('plugin metadata: off by default', () => {
    const p = new mod.McvTimer(fakeConfig(), { register() {}, unregister() {} });
    assert.equal(p.name, 'McvTimer');
    assert.equal(p.defaultEnabled, false);
});
