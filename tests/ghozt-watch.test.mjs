// GhoztWatch (plugins/ghozt-watch.js): enemy player surveillance, phase 1 (passive).
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
        stdin: { contents: `export * from './plugins/ghozt-watch.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
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
mod.initI18n({ get: (k, d) => (k === 'language' ? 'en' : d), set() {} });

const MIN = 60 * 1000;

/** Answers as seen live on game 26.1 (hemd1337, 2026-11-17). */
function hemd(over = {}) {
    return {
        a: 231, an: 'ANAKONDA XXL', bd: 0, bde: 0, f: 2, i: 775, n: 'hemd1337', p: 8359, r: 519,
        c: [{ i: 234882, n: 'hemd1337 1', p: 5243, x: 278, y: 57 }, { i: 501864, n: 'hemd1337 2', p: 3116, x: 286, y: 64 }],
        ...over,
    };
}

/** Game stub: `players` = id -> answer (mutable); records every command sent. */
function setupGame(players) {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
    };
    const sent = [];
    globalThis.webfrontend = { phe: { cnc: { Util: { createEventDelegate: (type, ctx, fn) => fn } } } };
    globalThis.ClientLib = {
        Net: {
            CommandResult: function () {},
            CommunicationManager: { GetInstance: () => ({
                SendSimpleCommand(name, params, cb) {
                    sent.push({ name, params });
                    let data = null;
                    if (name === 'GetPublicPlayerInfo') data = players[params.id] || null;
                    if (name === 'GetPublicPlayerInfoByName') data = Object.values(players).find(p => p.n.toLowerCase() === params.name.toLowerCase()) || null;
                    Promise.resolve().then(() => cb(null, data && JSON.parse(JSON.stringify(data))));
                },
            }) },
        },
        Data: { MainData: { GetInstance: () => ({ get_Server: () => ({ get_WorldId: () => 477 }) }) } },
    };
    globalThis.__chat = [];
    return { store, sent };
}

function makePlugin() {
    const toolbar = { items: {}, register(i) { this.items[i.id] = i; }, unregister(id) { delete this.items[id]; } };
    const cli = { commands: {}, register(n, h) { this.commands[n] = h; }, unregister(n) { delete this.commands[n]; } };
    const p = new mod.GhoztWatch({ get: (k, d) => d, set() {} }, toolbar, cli);
    p.gapMs = 0;
    return { p, toolbar, cli };
}

/** Run `fn` with Date.now() fixed at `ms`. */
async function at(ms, fn) {
    const real = Date.now;
    Date.now = () => ms;
    try { return await fn(); } finally { Date.now = real; }
}

test('applyInfo: first answer is the baseline, no events', () => {
    const rec = mod.newRecord(775, 0);
    assert.deepEqual(mod.applyInfo(rec, hemd(), 0), []);
    assert.equal(rec.name, 'hemd1337');
    assert.equal(rec.alliance, 'ANAKONDA XXL');
    assert.equal(rec.baseCount, 2);
    assert.equal(rec.points, 8359);
    assert.equal(rec.faction, 2);
    assert.equal(rec.rank, 519);
    assert.equal(rec.lastActive, null);
    assert.equal(mod.statusOf(rec, 0), 'grey');
});

test('applyInfo: activity transitions active -> inactive, once each (dedup by state)', () => {
    const rec = mod.newRecord(775, 0);
    mod.applyInfo(rec, hemd(), 0);
    let ev = mod.applyInfo(rec, hemd({ p: 9000 }), 5 * MIN);
    assert.deepEqual(ev.map(e => e.event), ['active']);
    assert.equal(ev[0].detail, '+641');
    assert.equal(mod.statusOf(rec, 5 * MIN), 'green');
    // more growth while active: no second alert
    assert.deepEqual(mod.applyInfo(rec, hemd({ p: 9500 }), 10 * MIN), []);
    assert.equal(rec.lastActive, 10 * MIN);
    assert.equal(mod.statusOf(rec, 30 * MIN), 'yellow');
    // no growth, still < 60 min: nothing
    assert.deepEqual(mod.applyInfo(rec, hemd({ p: 9500 }), 60 * MIN), []);
    // 60 min without growth: inactive, once
    assert.deepEqual(mod.applyInfo(rec, hemd({ p: 9500 }), 70 * MIN).map(e => e.event), ['inactive']);
    assert.deepEqual(mod.applyInfo(rec, hemd({ p: 9500 }), 75 * MIN), []);
    assert.equal(mod.statusOf(rec, 75 * MIN), 'grey');
    assert.deepEqual(rec.history.map(e => e.event), ['active', 'inactive']);
});

test('applyInfo: base count, attacks, alliance and name changes', () => {
    const rec = mod.newRecord(775, 0);
    mod.applyInfo(rec, hemd(), 0);
    const next = hemd({
        n: 'hemd2', a: 300, an: 'NewGuys', bd: 3, bde: 1,
        c: [...hemd().c, { i: 900001, n: 'hemd1337 3', p: 10, x: 1, y: 1 }],
    });
    const ev = mod.applyInfo(rec, next, MIN);
    const by = Object.fromEntries(ev.map(e => [e.event, e.detail]));
    assert.equal(by.name_change, 'hemd1337 → hemd2');
    assert.equal(by.alliance_change, 'ANAKONDA XXL → NewGuys');
    assert.equal(by.base_count, '2 → 3 (+hemd1337 3)');
    assert.equal(by.attack, 'PvP +2 · PvE +1');
    // base lost
    const lost = mod.applyInfo(rec, hemd({ n: 'hemd2', a: 300, an: 'NewGuys', bd: 3, bde: 1, c: [hemd().c[0]] }), 2 * MIN);
    assert.deepEqual(lost.map(e => [e.event, e.detail]), [['base_count', '3 → 1 (-hemd1337 2, -hemd1337 3)']]);
});

test('history: max 100 entries, only known event types (phase-2 types accepted)', () => {
    const rec = mod.newRecord(1, 0);
    for (let i = 0; i < 130; i++) mod.pushEvent(rec, { ts: i, event: 'attack', detail: String(i) });
    mod.pushEvent(rec, { ts: 999, event: 'bogus', detail: '' });
    assert.equal(rec.history.length, 100);
    assert.equal(rec.history[0].detail, '30');
    mod.pushEvent(rec, { ts: 1000, event: 'defense_changed', detail: 'x' });
    mod.pushEvent(rec, { ts: 1001, event: 'unit_upgrade', detail: 'y' });
    assert.deepEqual(rec.history.slice(-2).map(e => e.event), ['defense_changed', 'unit_upgrade']);
    assert.equal(rec.history.length, 100);
});

test('add: resolves the name to the player id, confirms, stores per world', async () => {
    const { store, sent } = setupGame({ 775: hemd() });
    const { p, cli, toolbar } = makePlugin();
    await p.start();
    assert.ok(toolbar.items.ghoztwatch);
    await cli.commands.ghoztwatch(['add', 'HEMD1337']);
    assert.deepEqual(sent.map(s => s.name), ['GetPublicPlayerInfoByName']);
    assert.equal(p.players.length, 1);
    assert.equal(p.players[0].playerId, 775);
    assert.match(__chat.at(-1), /^\[GW\] 🔍 Watching hemd1337 \(ANAKONDA XXL, 2 bases, 8359 points\) — 1\/20$/);
    const saved = JSON.parse(store.get('st-ghoztwatch-477'));
    assert.equal(saved.players[0].playerId, 775);
    // again: already watched, no new lookup
    await cli.commands.ghoztwatch(['add', 'hemd1337']);
    assert.match(__chat.at(-1), /already on the watchlist/);
    assert.equal(sent.length, 1);
    // unknown player
    await cli.commands.ghoztwatch(['add', 'nobody']);
    assert.match(__chat.at(-1), /Player nobody not found/);
    p.stop();
});

test('poll: mocked GetPublicPlayerInfo, activity switch and base growth -> chat alerts + history', async () => {
    const players = { 775: hemd() };
    setupGame(players);
    const { p, cli } = makePlugin();
    await p.start();
    await at(0, () => cli.commands.ghoztwatch(['add', 'hemd1337']));
    __chat.length = 0;

    // poll 1: nothing changed
    await at(5 * MIN, () => p.poll());
    assert.deepEqual(__chat, []);

    // poll 2: points up (active) and a new base
    players[775] = hemd({ p: 12000, c: [...hemd().c, { i: 900001, n: 'hemd1337 3', p: 10, x: 1, y: 1 }] });
    await at(10 * MIN, () => p.poll());
    assert.deepEqual(__chat, [
        '[GW] 🔍 hemd1337: bases 2 → 3 (+hemd1337 3)',
        '[GW] 🔍 hemd1337: is active (+3641 points)',
    ]);

    // poll 3: same state, no repeat
    __chat.length = 0;
    await at(15 * MIN, () => p.poll());
    assert.deepEqual(__chat, []);

    // poll 4: 60+ min without growth -> inactive
    await at(75 * MIN, () => p.poll());
    assert.deepEqual(__chat, ['[GW] 🔍 hemd1337: no activity for 60 min']);

    assert.deepEqual(p.players[0].history.map(e => e.event), ['base_count', 'active', 'inactive']);
    p.stop();
});

test('reload keeps the snapshot: no repeated alert after restart', async () => {
    const players = { 775: hemd() };
    const { store } = setupGame(players);
    const first = makePlugin();
    await first.p.start();
    await first.cli.commands.ghoztwatch(['add', 'hemd1337']);
    players[775] = hemd({ bd: 1 });
    await first.p.poll();
    assert.match(__chat.at(-1), /destroyed bases: PvP \+1/);
    first.p.stop();

    __chat.length = 0;
    const second = makePlugin();
    await second.p.start();      // start() polls right away when players are stored
    await second.p.poll();
    assert.deepEqual(__chat, []);
    assert.equal(JSON.parse(store.get('st-ghoztwatch-477')).players[0].bd, 1);
    second.p.stop();
});

test('max 20 players; remove, list and clear', async () => {
    const players = {};
    for (let i = 1; i <= 21; i++) players[i] = hemd({ i, n: `p${i}` });
    setupGame(players);
    const { p, cli } = makePlugin();
    await p.start();
    for (let i = 1; i <= 21; i++) await cli.commands.ghoztwatch(['add', `p${i}`]);
    assert.equal(p.players.length, 20);
    assert.match(__chat.at(-1), /Watchlist full \(max 20 players\)/);

    await cli.commands.ghoztwatch(['remove', 'P3']);
    assert.equal(p.players.length, 19);
    assert.match(__chat.at(-1), /p3 removed/);
    await cli.commands.ghoztwatch(['remove', 'p3']);
    assert.match(__chat.at(-1), /p3 is not on the watchlist/);

    __chat.length = 0;
    await cli.commands.ghoztwatch(['list']);
    assert.equal(__chat.length, 20);   // header + 19 players
    assert.match(__chat[1], /^\[GW\] ⚫ p1 \[ANAKONDA XXL\] · 8359 · 2 bases · no activity seen yet$/);

    await cli.commands.ghoztwatch(['clear']);
    assert.equal(p.players.length, 0);
    assert.match(__chat.at(-1), /Watchlist cleared \(19 players\)/);
    p.stop();
});

test('renderTable: status, last 3 events, empty defense column, expanded history', () => {
    const rec = mod.newRecord(775, 0);
    mod.applyInfo(rec, hemd(), 0);
    mod.applyInfo(rec, hemd({ p: 9000 }), MIN);
    const html = mod.renderTable([rec], 2 * MIN, new Set([775]));
    assert.match(html, /🟢/);
    assert.match(html, /is active \(\+641 points\)/);
    assert.match(html, /data-remove="775"/);
    assert.match(html, /colspan="7"/);
    assert.match(mod.renderTable([], 0), /Nobody watched yet/);
});
