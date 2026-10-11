// WatchList userscript side (plugins/watchlist.js) + the AttackTracker auto-unclaim hook.
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
            contents: `export * from './plugins/watchlist.js'; export { AttackTracker } from './plugins/attack-tracker.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stub-main',
            setup(b) {
                b.onResolve({ filter: /lib\/main\.js$/ }, () => ({ path: 'main', namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    contents: 'export function chatMessage(m) { (globalThis.__chat ||= []).push(m); }',
                }));
            },
        }],
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

const MODE = { Region: 1, City: 2, CombatSetup: 3, Battleground: 4 };
const VIS = { RegionCityType: 1, RegionNPCBase: 2, RegionNPCCamp: 3, RegionPOI: 4 };

/**
 * Game stub. view: {mode, selected?: {type, x, y, id}, city?: {...}}; world: "x:y" → world object.
 */
function setupGame({ mode = MODE.Region, selected = null, city = null, world = {}, me = 164 } = {}) {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
    };
    const cityObj = city && {
        get_IsGhostMode: () => false,
        IsOwnBase: () => !!city.own,
        get_CityFaction: () => city.faction ?? 4,
        get_PosX: () => city.x,
        get_PosY: () => city.y,
        get_LvlBase: () => city.level ?? 17.6,
    };
    const md = {
        get_Cities: () => ({ get_CurrentCity: () => cityObj, GetCity: () => null }),
        get_World: () => ({ GetObjectFromPosition: (x, y) => world[`${x}:${y}`] || null }),
        get_Server: () => ({ get_WorldId: () => 477 }),
        get_Player: () => ({ get_Id: () => me }),
    };
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => md } },
        Vis: {
            Mode: MODE,
            VisObject: { EObjectType: VIS },
            VisMain: { GetInstance: () => ({
                get_Mode: () => mode,
                get_SelectedObject: () => selected && {
                    get_VisObjectType: () => selected.type,
                    get_RawX: () => selected.x,
                    get_RawY: () => selected.y,
                    get_Id: () => selected.id || 1,
                },
            }) },
        },
    };
    globalThis.__chat = [];
}

function fakeApi(responses = {}) {
    const calls = [];
    return {
        calls,
        isConfigured: true,
        async request(method, p, body) {
            calls.push({ method, path: p, body });
            const r = responses[body && body.action];
            return typeof r === 'function' ? r(body) : (r === undefined ? { status: 'ok' } : r);
        },
    };
}

function plugin(api) {
    const cli = { commands: {}, register(n, h) { this.commands[n] = h; } };
    const p = new mod.WatchList({ get: () => undefined }, cli, api);
    p.running = true;
    return { p, cli };
}

const OUTPOST = { Type: 3, $CampType: 3, $Level: 18 };

// ─── Target reading ──────────────────────────────────────────────────

test('world map selection → camp / outpost / base with the world-object level', () => {
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 84, y: 293 }, world: { '84:293': OUTPOST } });
    assert.deepEqual(mod.readSelectedTarget(),
        { targetType: 'outpost', targetLevel: 18, targetX: 84, targetY: 293, worldId: 477 });

    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 1, y: 2 }, world: { '1:2': { Type: 3, $CampType: 2, $Level: 20 } } });
    assert.equal(mod.readSelectedTarget().targetType, 'camp');

    setupGame({ selected: { type: VIS.RegionNPCBase, x: 1, y: 2 }, world: { '1:2': { Type: 2, $Level: 31 } } });
    assert.deepEqual([mod.readSelectedTarget().targetType, mod.readSelectedTarget().targetLevel], ['base', 31]);
});

test('destroyed camp, POI, nothing selected → null; player base → notForgotten', () => {
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 1, y: 2 }, world: { '1:2': { Type: 3, $CampType: 0 } } });
    assert.equal(mod.readSelectedTarget(), null);
    setupGame({ selected: { type: VIS.RegionPOI, x: 1, y: 2 } });
    assert.equal(mod.readSelectedTarget(), null);
    setupGame();
    assert.equal(mod.readSelectedTarget(), null);
    setupGame({ selected: { type: VIS.RegionCityType, x: 1, y: 2 } });
    assert.deepEqual(mod.readSelectedTarget(), { notForgotten: true });
});

test('base view → the base on screen (own base ignored, player base refused)', () => {
    setupGame({ mode: MODE.CombatSetup, city: { x: 84, y: 293 }, world: { '84:293': OUTPOST },
        selected: { type: VIS.RegionNPCBase, x: 9, y: 9 } });
    assert.equal(mod.readSelectedTarget().targetX, 84, 'the base in view wins over a stale map selection');
    setupGame({ mode: MODE.City, city: { x: 5, y: 6, level: 22.4 } });       // world object not loaded
    assert.deepEqual(mod.readSelectedTarget(),
        { targetType: 'base', targetLevel: 22.4, targetX: 5, targetY: 6, worldId: 477 });
    setupGame({ mode: MODE.City, city: { x: 5, y: 6, own: true } });
    assert.equal(mod.readSelectedTarget(), null);
    setupGame({ mode: MODE.City, city: { x: 5, y: 6, faction: 1 } });
    assert.deepEqual(mod.readSelectedTarget(), { notForgotten: true });
});

// ─── Commands ────────────────────────────────────────────────────────

test('/st watch posts the claim and confirms in the chat', async () => {
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 84, y: 293 }, world: { '84:293': OUTPOST } });
    const api = fakeApi({ claim: { status: 'claimed', claim: { id: 'a', playerId: 164 }, others: [] } });
    const { p, cli } = plugin(api);
    await p.start();
    assert.ok(cli.commands.watch && cli.commands.unwatch);
    await p.watch([]);
    assert.deepEqual(api.calls[0], { method: 'POST', path: '/api/watchlist', body: {
        action: 'claim', targetType: 'outpost', targetLevel: 18, targetX: 84, targetY: 293, worldId: 477, force: false } });
    assert.deepEqual(globalThis.__chat, ['[ST] WatchList: outpost lvl 18 @ 84:293 claimed']);
    p.stop();
});

test('/st watch on a claimed target warns; /st watch force sends force', async () => {
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 84, y: 293 }, world: { '84:293': OUTPOST } });
    const api = fakeApi({ claim: (b) => (b.force
        ? { status: 'claimed', claim: { id: 'b', playerId: 164 }, others: [{ id: 'a', playerId: 200, playerName: 'OzookerO' }] }
        : { status: 'conflict', claim: null, others: [{ id: 'a', playerId: 200, playerName: 'OzookerO' }] }) });
    const { p } = plugin(api);
    await p.watch([]);
    assert.match(globalThis.__chat[0], /^\[ST\] WatchList: ⚠ this target is already claimed by OzookerO/);
    await p.watch(['force']);
    assert.equal(api.calls[1].body.force, true);
    assert.match(globalThis.__chat[1], /claimed \(also claimed by OzookerO\)$/);
});

test('/st watch without a usable selection sends nothing', async () => {
    setupGame({ selected: { type: VIS.RegionCityType, x: 1, y: 1 } });
    const api = fakeApi();
    const { p } = plugin(api);
    await p.watch([]);
    assert.equal(api.calls.length, 0);
    assert.match(globalThis.__chat[0], /only Forgotten targets/);
});

test('/st unwatch and /st unwatch all', async () => {
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 84, y: 293 }, world: { '84:293': OUTPOST } });
    const api = fakeApi({
        unclaim: { status: 'ok', removed: [{ id: 'a' }] },
        unclaim_all: { status: 'ok', removed: [{ id: 'a' }, { id: 'b' }] },
    });
    const { p } = plugin(api);
    await p.unwatch([]);
    assert.deepEqual(api.calls[0].body, { action: 'unclaim', targetX: 84, targetY: 293, worldId: 477 });
    assert.equal(globalThis.__chat[0], '[ST] WatchList: claim on outpost @ 84:293 removed');
    await p.unwatch(['all']);
    assert.deepEqual(api.calls[1].body, { action: 'unclaim_all', worldId: 477 });
    assert.equal(globalThis.__chat[1], '[ST] WatchList: 2 claim(s) removed');
});

// ─── Warning while viewing ───────────────────────────────────────────

test('viewing a target claimed by someone else warns once per view; own claims stay quiet', async () => {
    const twoHoursAgo = Date.now() - 2 * 3600_000;
    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 84, y: 293 },
        world: { '84:293': OUTPOST, '90:310': { Type: 3, $CampType: 2, $Level: 20 } } });
    const api = fakeApi({ list: { status: 'ok', serverTime: Date.now(), claims: [
        { id: 'a', playerId: 200, playerName: 'OzookerO', targetX: 84, targetY: 293, claimedAt: twoHoursAgo },
        { id: 'b', playerId: 164, playerName: 'GhoztMasters', targetX: 90, targetY: 310, claimedAt: twoHoursAgo },
    ] } });
    const { p } = plugin(api);
    p._tick();                                  // fetches the list
    await new Promise(r => setTimeout(r, 5));
    p._tick();                                  // warns
    p._tick();                                  // same view: no repeat
    assert.deepEqual(globalThis.__chat, ['[ST] ⚠ This target is claimed by OzookerO (2 hours ago)']);
    assert.equal(api.calls.filter(c => c.body.action === 'list').length, 1, 'list cached');

    setupGame({ selected: { type: VIS.RegionNPCCamp, x: 90, y: 310 },
        world: { '90:310': { Type: 3, $CampType: 2, $Level: 20 } } });
    p._tick();
    assert.deepEqual(globalThis.__chat, [], 'own claim → no warning');
});

// ─── Auto-unclaim hook ───────────────────────────────────────────────

test('AttackTracker passes the server\'s unclaimed claims to the hook', async () => {
    setupGame();
    const claim = { id: 'a', playerId: 164, targetType: 'outpost', targetX: 84, targetY: 293 };
    const attack = { targetType: 'outpost', targetLevel: 18, targetX: 84, targetY: 293, worldId: 477,
        timestamp: Date.now(), reportId: 1 };
    localStorage.setItem('st-attacks-outbox', JSON.stringify([{ attack, failures: 0 }]));
    const api = { isConfigured: true, async request() { return { status: 'ok', stored: 1, unclaimed: [claim] }; } };
    const tracker = new mod.AttackTracker({ get: () => undefined }, api);
    tracker.running = true;
    const { p } = plugin(fakeApi());
    tracker.onUnclaimed = (c) => p.notifyDefeated(c);
    const origLog = console.log;
    console.log = () => {};
    try { await tracker.flush(); } finally { console.log = origLog; tracker.stop(); }
    assert.deepEqual(globalThis.__chat, ['[ST] WatchList: outpost @ 84:293 defeated — claim removed']);
});

test('ago() buckets', () => {
    setupGame();
    assert.equal(mod.ago(20_000), 'just now');
    assert.equal(mod.ago(45 * 60_000), '45 min ago');
    assert.equal(mod.ago(65 * 60_000), '1 hour ago');
    assert.equal(mod.ago(3 * 3600_000), '3 hours ago');
});
