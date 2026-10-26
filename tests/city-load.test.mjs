// Poll-on-demand city loading (lib/city-util.js waitForCity) and the
// view-dependent pause between base scans (lib/scanner-util.js scanDelayMs).
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
            contents: `export * from './lib/city-util.js';
                       export { scanDelayMs, SCAN_DELAY_FAST_MS, SCAN_DELAY_SAFE_MS } from './lib/scanner-util.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

/**
 * Fake client: the city appears `pollsNeeded` $Poll() calls after the start
 * (0 = already loaded). `poll: false` leaves $Poll off the CommunicationManager.
 */
function fakeClient({ pollsNeeded = 0, poll = true, pollThrows = false, appearAfterMs = null, mode = 'Region' } = {}) {
    const state = { polls: [], start: Date.now() };
    const city = {
        get_IsGhostMode: () => false,
        GetBuildingsConditionInPercent: () => 100,
    };
    const loaded = () => {
        if (appearAfterMs !== null) return Date.now() - state.start >= appearAfterMs;
        return state.polls.length >= pollsNeeded;
    };
    const comm = {};
    if (poll) {
        comm.$Poll = () => {
            state.polls.push(Date.now() - state.start);
            if (pollThrows) throw new Error('poll failed');
        };
    }
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ GetCity: () => (loaded() ? city : null) }),
        }) } },
        Net: { CommunicationManager: { GetInstance: () => comm } },
        Vis: {
            Mode: { Region: 1, City: 2, CombatSetup: 3 },
            VisMain: { GetInstance: () => ({ get_Mode: () => globalThis.ClientLib.Vis.Mode[mode] }) },
        },
    };
    return { state, city };
}

test('already loaded city: returned at once, no $Poll', async () => {
    const { state, city } = fakeClient({ pollsNeeded: 0 });
    assert.equal(await mod.waitForCity(1), city);
    assert.equal(state.polls.length, 0);
});

test('missing city: $Poll is forced immediately, not after a few tries', async () => {
    const { state, city } = fakeClient({ pollsNeeded: 1 });
    const t0 = Date.now();
    assert.equal(await mod.waitForCity(1), city);
    assert.equal(state.polls.length, 1);
    assert.ok(state.polls[0] < 10, `first poll at ${state.polls[0]} ms`);
    assert.ok(Date.now() - t0 < 100, 'returned within one check interval');
});

test('repeated $Poll calls are throttled to the minimum gap', async () => {
    const { state, city } = fakeClient({ pollsNeeded: 4 });
    assert.equal(await mod.waitForCity(1), city);
    assert.equal(state.polls.length, 4);
    for (let i = 1; i < state.polls.length; i++) {
        const gap = state.polls[i] - state.polls[i - 1];
        assert.ok(gap >= mod.CITY_POLL_MIN_GAP_MS - 5, `gap ${gap} ms between poll ${i - 1} and ${i}`);
    }
});

test('city that never loads: null after the timeout', async () => {
    const { state } = fakeClient({ pollsNeeded: Infinity });
    const t0 = Date.now();
    assert.equal(await mod.waitForCity(1, 250), null);
    const took = Date.now() - t0;
    assert.ok(took >= 250 && took < 400, `took ${took} ms`);
    // ~250 / 70 -> at most 4-5 server requests, not one per 20 ms check
    assert.ok(state.polls.length <= 5, `${state.polls.length} polls`);
});

test('without $Poll it still waits for the city', async () => {
    const { city } = fakeClient({ poll: false, appearAfterMs: 60 });
    assert.equal(await mod.waitForCity(1), city);
});

test('a throwing $Poll does not break the wait', async () => {
    const { state, city } = fakeClient({ pollThrows: true, appearAfterMs: 100 });
    assert.equal(await mod.waitForCity(1), city);
    assert.ok(state.polls.length >= 1);
});

test('scan delay: fast on the world map, safe elsewhere', () => {
    fakeClient({ mode: 'Region' });
    assert.equal(mod.scanDelayMs(), mod.SCAN_DELAY_FAST_MS);
    assert.equal(mod.SCAN_DELAY_FAST_MS, 100);
    fakeClient({ mode: 'City' });
    assert.equal(mod.scanDelayMs(), mod.SCAN_DELAY_SAFE_MS);
    fakeClient({ mode: 'CombatSetup' });
    assert.equal(mod.scanDelayMs(), mod.SCAN_DELAY_SAFE_MS);
    globalThis.ClientLib = {};   // view unreadable -> safe
    assert.equal(mod.scanDelayMs(), mod.SCAN_DELAY_SAFE_MS);
});
