// Scanner auto-pause on the player's own online status (lib/online-state.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Bundle the two scanners + the watcher; main.js would boot the whole script,
// so it is replaced by a chat stub.
async function load() {
    const out = await esbuild.build({
        stdin: {
            contents: `export { OnlineStateWatch, readOwnOnlineState } from './lib/online-state.js';
                       export { LayoutScanner } from './plugins/layout-scanner.js';
                       export { AllianceScanner } from './plugins/alliance-scanner.js';
                       export { releaseScanLock } from './lib/scanner-util.js';`,
            resolveDir: root,
        },
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

function captureLog() {
    const lines = [];
    const orig = { log: console.log, warn: console.warn };
    console.log = (...a) => lines.push(a.join(' '));
    console.warn = (...a) => lines.push(a.join(' '));
    return { lines, restore: () => Object.assign(console, orig) };
}

function setGame({ memberState, playerGetter, allianceId = 7, idField = true, idGetter = false } = {}) {
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => ({
            get_Alliance: () => ({
                get_Id: () => allianceId,
                get_MemberData: () => ({ d: memberState === undefined ? {} : { 42: { OnlineState: memberState } } }),
            }),
            get_Player: () => {
                const p = idField ? { id: 42 } : {};
                if (idGetter) p.get_Id = () => 42;
                if (playerGetter !== undefined) p.get_OnlineState = () => playerGetter;
                return p;
            },
        }) } },
    };
}

test('readOwnOnlineState: member data first, player getter as fallback, else null', () => {
    setGame({ memberState: 2, playerGetter: 1 });
    assert.equal(mod.readOwnOnlineState(), 2);
    setGame({ allianceId: 0, playerGetter: 1 });
    assert.equal(mod.readOwnOnlineState(), 1);
    setGame({});
    assert.equal(mod.readOwnOnlineState(), null);
    delete globalThis.ClientLib;
    assert.equal(mod.readOwnOnlineState(), null);
});

test('readOwnOnlineState: own id via get_Id() when the player has no plain .id', () => {
    setGame({ memberState: 1, idField: false, idGetter: true });
    assert.equal(mod.readOwnOnlineState(), 1);
    setGame({ memberState: 1, idField: false, idGetter: false });
    assert.equal(mod.readOwnOnlineState(), null);
    delete globalThis.ClientLib;
});

test('watcher: start() polls every 10 s', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let reads = 0;
    const w = new mod.OnlineStateWatch(() => { reads++; return 2; });
    w.start();
    w.start();                         // idempotent: no second interval
    assert.equal(reads, 1, 'immediate check on start');
    t.mock.timers.tick(9999);
    assert.equal(reads, 1);
    t.mock.timers.tick(1);
    assert.equal(reads, 2);
    t.mock.timers.tick(20000);
    assert.equal(reads, 4);
    w.stop();
});

test('watcher: pauses on Online, resumes on Away/Offline, one line per transition', () => {
    let state = 1;
    const w = new mod.OnlineStateWatch(() => state);
    const ev = [];
    w.on('pause', () => ev.push('pause'));
    w.on('resume', () => ev.push('resume'));
    const log = captureLog();
    try {
        w.check(); w.check();          // online, twice -> one pause
        state = 2; w.check(); w.check(); // away -> one resume
        state = 1; w.check();
        state = 0; w.check();          // offline -> resume
        state = 3; w.check();          // hidden: not Online -> stays resumed
    } finally { log.restore(); }
    assert.deepEqual(ev, ['pause', 'resume', 'pause', 'resume']);
    assert.deepEqual(log.lines, [
        '[ST] Scanner paused (player online)',
        '[ST] Scanner resumed (player away)',
        '[ST] Scanner paused (player online)',
        '[ST] Scanner resumed (player offline)',
    ]);
    assert.equal(w.isPaused, false);
});

test('watcher: unreadable state never pauses (old behaviour), warns once', () => {
    let state = 1;
    const w = new mod.OnlineStateWatch(() => state);
    const log = captureLog();
    try {
        w.check();
        state = null; w.check(); w.check();
    } finally { log.restore(); }
    assert.equal(w.isPaused, false);
    assert.equal(log.lines.filter(l => l.includes('not readable')).length, 1);
    assert.ok(log.lines.includes('[ST] Scanner resumed (state unknown)'));
});

function fakeDeps() {
    const idle = { isIdle: true, l: { idle: [], active: [] }, on(e, f) { this.l[e].push(f); } };
    const online = new mod.OnlineStateWatch(() => online._s);
    online._s = 2;
    const api = { isConfigured: true, _url: 'x', send() {}, flush: async () => {} };
    const cli = { cmds: {}, register(n, f) { this.cmds[n] = f; }, unregister(n) { delete this.cmds[n]; } };
    const config = { get: () => true, set() {} };
    return { idle, online, api, cli, config };
}

for (const [Name, cmd] of [['LayoutScanner', 'scan'], ['AllianceScanner', 'scanalliance']]) {
    test(`${Name}: automatic scans blocked while Online, manual still runs, resume triggers a scan`, async () => {
        const d = fakeDeps();
        const s = new mod[Name](d.config, d.cli, d.api, d.idle, d.online);
        const log = captureLog();
        let calls = [];
        try {
            await s.start();
            s.scanAll = (opts) => { calls.push(opts?.manual ? 'manual' : 'auto'); };

            d.online._s = 1; d.online.check();            // player online
            d.idle.l.idle.forEach(f => f());              // idle trigger
            await new Promise(r => setTimeout(r, 0));
            assert.deepEqual(calls, [], 'no automatic scan while online');

            d.cli.cmds[cmd]();                            // manual command
            assert.equal(calls.length, 1, 'manual scan not blocked');

            calls = [];
            d.online._s = 2; d.online.check();            // away -> resume
            await new Promise(r => setTimeout(r, 0));
            assert.deepEqual(calls, ['auto'], 'resume starts one automatic scan');

            calls = [];
            d.idle.isIdle = false;
            d.online._s = 1; d.online.check();
            d.online._s = 0; d.online.check();            // resume, but player not idle
            await new Promise(r => setTimeout(r, 0));
            assert.deepEqual(calls, [], 'resume respects the idle rule');
        } finally {
            s.stop();
            log.restore();
        }
    });
}

// Running automatic batch: stops at the next base once the player is Online.
// city-util/scanner-util are stubbed so the loop runs without a game client.
async function loadWithFakeScanUtils() {
    const stubs = {
        'city-util': `export function getAllNearbyObjects() {
                          return [1, 2, 3, 4].map(id => ({ id, object: { Type: 2 } }));
                      }
                      export async function waitForCity(id) {
                          return { get_Version: () => globalThis.__scanVersion, get_Id: () => id };
                      }`,
        'scanner-util': `let holder = null;
                         export function extractScan(city) { return { city_id: city.get_Id() }; }
                         export function acquireScanLock(o) { if (holder) return false; holder = o; return true; }
                         export function releaseScanLock(o) { if (holder === o) holder = null; }
                         export function scanLockHolder() { return holder; }
                         export function scanDelayMs() { return 0; }`,
        main: 'export function chatMessage() {}',
    };
    const out = await esbuild.build({
        stdin: {
            contents: `export { LayoutScanner } from './plugins/layout-scanner.js';
                       export { AllianceScanner } from './plugins/alliance-scanner.js';
                       export { OnlineStateWatch } from './lib/online-state.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stubs',
            setup(b) {
                b.onResolve({ filter: /lib\/(main|city-util|scanner-util)\.js$/ }, (a) => ({
                    path: a.path.match(/(main|city-util|scanner-util)/)[1], namespace: 'stub',
                }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path] }));
            },
        }],
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const fake = await loadWithFakeScanUtils();

function setScanGame() {
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_CurrentCityId: () => 99, set_CurrentCityId() {}, GetCity: () => null }),
            get_Alliance: () => ({ get_Id: () => 7, get_MemberDataAsArray: () => [{ Id: 42 }] }),
        }) } },
        Net: { CommunicationManager: { GetInstance: () => ({
            SendSimpleCommand: (_n, _a, cb) => cb(null, { c: [1, 2, 3, 4].map(i => ({ i })) }),
        }) }, CommandResult: {} },
    };
    globalThis.webfrontend = { phe: { cnc: { Util: { createEventDelegate: (_t, _c, fn) => fn } } } };
}

for (const Name of ['LayoutScanner', 'AllianceScanner']) {
    for (const manual of [false, true]) {
        test(`${Name}: ${manual ? 'manual batch ignores' : 'running automatic batch stops on'} Online`, async () => {
            setScanGame();
            globalThis.__scanVersion = (globalThis.__scanVersion || 0) + 1; // scanners dedup per version
            const realTimeout = globalThis.setTimeout;
            globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
            const online = new fake.OnlineStateWatch(() => online._s);
            online._s = 2;
            const sent = [];
            const api = {
                isConfigured: true, _url: 'x', flush: async () => {},
                send(p) {
                    sent.push(p.city_id);
                    if (sent.length === 1) { online._s = 1; online.check(); } // player comes online
                },
            };
            const idle = { isIdle: true, on() {} };
            const cli = { register() {}, unregister() {} };
            const s = new fake[Name]({ get: () => true, set() {} }, cli, api, idle, online);
            const log = captureLog();
            try {
                s.running = true;
                await s.scanAll({ manual });
            } finally {
                globalThis.setTimeout = realTimeout;
                log.restore();
                delete globalThis.ClientLib;
                delete globalThis.webfrontend;
            }
            if (manual) {
                assert.deepEqual(sent, [1, 2, 3, 4], 'manual scan runs to the end');
            } else {
                assert.deepEqual(sent, [1], 'no base sent after the player came online');
                assert.ok(log.lines.some(l => l.includes('aborted: player online')), log.lines.join(' | '));
            }
        });
    }
}

// 5.13.0: the watch refreshes the member data itself (every 3rd poll) and reports its state.
test('OnlineStateWatch: refreshes member data on start and every 3rd poll; describe()', () => {
    let refreshes = 0;
    let state = 1;
    const log = captureLog();
    const w = new mod.OnlineStateWatch(() => state, () => { refreshes++; });
    assert.equal(w.describe(), 'stopped');
    w.start();
    try {
        assert.equal(refreshes, 1);
        assert.equal(w.describe(), 'paused');
        w._tick(); w._tick();
        assert.equal(refreshes, 1);
        w._tick();
        assert.equal(refreshes, 2);
        state = 2;
        w._tick();
        assert.equal(w.describe(), 'active');
        state = null;
        w._tick();
        assert.equal(w.describe(), 'unknown');
    } finally {
        w.stop();
        log.restore();
    }
    assert.ok(log.lines.some(l => l.startsWith('[ST] Scanner paused (player online)')));
    assert.ok(log.lines.some(l => l.startsWith('[ST] Scanner resumed')));
});

test('main.js starts the online watch before the plugins', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.join(root, 'lib/main.js'), 'utf8');
    const startAt = src.indexOf('online.start()');
    assert.ok(startAt > 0);
    assert.ok(startAt < src.indexOf('await manager.start(plugin)'));   // 5.28.0: plugins start via PluginManager
    assert.equal(src.indexOf('online.start()', startAt + 1), -1);
});
