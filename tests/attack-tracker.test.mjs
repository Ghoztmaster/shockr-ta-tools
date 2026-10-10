// Alliance Attack Tracker userscript side (plugins/attack-tracker.js).
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
        stdin: { contents: `export * from './plugins/attack-tracker.js';`, resolveDir: root },
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

const NOW = Date.now();

function header(over = {}) {
    return { i: 1, t: NOW - 60_000, tp: 2, s: true, ad: { cr: 4, dbl: 18, dbn: '3', dbx: 84, dby: 293 }, ...over };
}

// ─── Game + browser stubs ────────────────────────────────────────────

function setupGame(headers, loot = { 2: 120000, 3: 85000, 4: 42000 }) {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
    };
    let delivered = null;
    const requested = [];
    const forbidden = [];
    const reports = {
        RequestReportData(id) {
            requested.push(id);
            setTimeout(() => delivered({
                get_Id: () => id,
                GetAttackerTotalResourceReceived: (r) => loot[r] || 0,
            }), 1);
        },
        MarkReportsAsRead() { forbidden.push('MarkReportsAsRead'); },
        DeleteReports() { forbidden.push('DeleteReports'); },
    };
    globalThis.ClientLib = {
        Data: {
            MainData: { GetInstance: () => ({ get_Server: () => ({ get_WorldId: () => 477 }), get_Reports: () => reports }) },
            Reports: { ReportDelivered: 'ReportDelivered' },
        },
        Net: {
            CommandResult: 'CommandResult',
            CommunicationManager: { GetInstance: () => ({
                SendSimpleCommand(name, args, cb) {
                    assert.equal(name, 'GetReportHeaderAll');
                    assert.equal(args.type, 1);
                    setTimeout(() => cb(null, headers), 1);
                },
            }) },
        },
        Base: { EResourceType: { Tiberium: 2, Crystal: 3, Gold: 4, ResearchPoints: 6 } },
    };
    globalThis.webfrontend = { phe: { cnc: { Util: {
        createEventDelegate: (type, ctx, fn) => fn,
        attachNetEvent: (src, name, type, ctx, fn) => { delivered = fn; },
    } } } };
    return { requested, forbidden, store };
}

function fakeApi() {
    const posts = [];
    return {
        posts,
        isConfigured: true,
        ok: true,
        async request(method, p, body) {
            posts.push({ method, path: p, body, at: Date.now() });
            return this.ok ? { status: 'ok' } : null;
        },
    };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Pure filter / payload ───────────────────────────────────────────

test('only won attacks on FG camp/outpost/base are loggable', () => {
    assert.equal(mod.isLoggable(header()), true);
    assert.equal(mod.isLoggable(header({ s: false })), false, 'lost');
    assert.equal(mod.isLoggable(header({ tp: 1 })), false, 'PvP (EReportType.Combat)');
    assert.equal(mod.isLoggable(header({ ad: { dbl: 18, dbn: '6', dbx: 1, dby: 1 } })), false, 'fortress');
    assert.equal(mod.isLoggable(header({ ad: { dbl: 18, dbn: '1', dbx: 1, dby: 1 } })), true, 'camp');
    assert.equal(mod.isLoggable(header({ ad: { dbl: 18, dbn: '4', dbx: 1, dby: 1 } })), true, 'base');
});

test('payload matches the server schema', () => {
    const a = mod.buildAttack(header(), 477, { tib: 120000.4, cry: 85000, credits: -3 });
    assert.deepEqual(a, {
        targetType: 'outpost', targetLevel: 18, targetX: 84, targetY: 293,
        lootTib: 120000, lootCrystal: 85000, lootCredits: 0,
        worldId: 477, timestamp: NOW - 60_000, reportId: 1,
    });
});

test('done list keeps 100 ids and moves the cutoff', () => {
    setupGame([]);
    for (let i = 1; i <= 105; i++) mod.markDone(477, i, NOW - 200_000 + i);
    const state = mod.loadDone(477);
    assert.equal(state.done.length, 100);
    assert.equal(state.cutoff, NOW - 200_000 + 5);
});

// ─── End to end with stubs ───────────────────────────────────────────

test('poll → report → one batched POST; lost/PvP never sent; nothing marked read', async () => {
    const headers = [
        header({ i: 4, t: NOW - 10_000 }),
        header({ i: 3, t: NOW - 20_000, s: false }),         // lost
        header({ i: 2, t: NOW - 30_000, tp: 1 }),            // PvP
        header({ i: 1, t: NOW - 40_000, ad: { dbl: 17, dbn: '1', dbx: 80, dby: 290 } }),
    ];
    const game = setupGame(headers);
    const api = fakeApi();
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    const tracker = new mod.AttackTracker({ get: () => undefined }, api);
    tracker.running = true;
    try {
        tracker.poll();
        await sleep(1500);                    // two reports, 1 s apart
        assert.equal(api.posts.length, 1, 'second report waits for the 5 s POST slot');
        tracker._lastPostAt -= 5000;
        await tracker.flush();
    } finally {
        console.log = origLog;
        tracker.stop();
    }
    assert.deepEqual(game.requested, [1, 4], 'only the won FG reports, oldest first');
    assert.deepEqual(game.forbidden, []);
    const sent = api.posts.flatMap(p => p.body);
    assert.deepEqual(sent.map(a => a.reportId).sort(), [1, 4]);
    assert.equal(sent.find(a => a.reportId === 1).targetType, 'camp');
    assert.ok(logs.includes('[ST] Attack logged: outpost lvl 18 @ 84:293'), logs.join('\n'));

    // A second poll sends nothing new
    const again = fakeApi();
    const tracker2 = new mod.AttackTracker({ get: () => undefined }, again);
    tracker2.running = true;
    tracker2.poll();
    await sleep(50);
    await tracker2.flush();
    tracker2.stop();
    assert.equal(again.posts.length, 0);
});

test('at most one POST per 5 s; failed POST keeps the outbox', async () => {
    setupGame([]);
    const api = fakeApi();
    api.ok = false;
    const tracker = new mod.AttackTracker({ get: () => undefined }, api);
    tracker.running = true;
    tracker._commit({ header: header({ i: 7 }), worldId: 477 }, { tib: 1, cry: 1, credits: 1 });
    await tracker.flush();
    await tracker.flush();                       // within 5 s: no second POST
    assert.equal(api.posts.length, 1);
    assert.equal(JSON.parse(localStorage.getItem('st-attacks-outbox')).length, 1, 'kept after failure');
    tracker._lastPostAt = Date.now() - 5000;
    api.ok = true;
    await tracker.flush();
    assert.equal(api.posts.length, 2);
    assert.equal(JSON.parse(localStorage.getItem('st-attacks-outbox')).length, 0);
    tracker.stop();
});
