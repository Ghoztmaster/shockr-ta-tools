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

function setGame({ memberState, playerGetter, allianceId = 7 } = {}) {
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => ({
            get_Alliance: () => ({
                get_Id: () => allianceId,
                get_MemberData: () => ({ d: memberState === undefined ? {} : { 42: { OnlineState: memberState } } }),
            }),
            get_Player: () => {
                const p = { id: 42 };
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
        '[ST] Scanner: gepauzeerd (speler online)',
        '[ST] Scanner: hervat (speler away)',
        '[ST] Scanner: gepauzeerd (speler online)',
        '[ST] Scanner: hervat (speler offline)',
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
    assert.equal(log.lines.filter(l => l.includes('niet leesbaar')).length, 1);
    assert.ok(log.lines.includes('[ST] Scanner: hervat (status onbekend)'));
});

function fakeDeps() {
    const idle = { isIdle: true, l: { idle: [], active: [] }, on(e, f) { this.l[e].push(f); } };
    const online = new mod.OnlineStateWatch(() => online._s);
    online._s = 2;
    const api = { isConfigured: true, _url: 'x', send() {}, flush: async () => {} };
    const cli = { cmds: {}, register(n, f) { this.cmds[n] = f; } };
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
