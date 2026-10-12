// Scan send queue held while the scanners are paused (lib/api-client.js, 5.12.1).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// main.js would boot the whole script, so it is replaced by a chat stub.
async function load() {
    const out = await esbuild.build({
        stdin: {
            contents: `export { ApiClient } from './lib/api-client.js';
                       export { OnlineStateWatch } from './lib/online-state.js';`,
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

const config = { get: (k, d) => ({ 'api.url': 'https://example.test', 'api.key': 'k' })[k] ?? d, set() {} };

/** fetch stub that counts /api/scan POSTs; onSend runs inside each call. */
function stubFetch(onSend) {
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        if (!url.endsWith('/api/scan')) return { ok: true, status: 200, json: async () => ({}) };
        sent.push(JSON.parse(opts.body));
        if (onSend) onSend(sent.length);
        return { ok: true, status: 200, json: async () => ({}) };
    };
    return sent;
}

function quiet() {
    const orig = { log: console.log, warn: console.warn };
    const lines = [];
    console.log = (...a) => lines.push(a.join(' '));
    console.warn = (...a) => lines.push(a.join(' '));
    return { lines, restore: () => Object.assign(console, orig) };
}

function newClient(paused) {
    const api = new mod.ApiClient(config);
    api._paceScan = async () => {}; // no 2 s pacing in tests
    api.setSendGate(() => paused.value);
    return api;
}

test('held: send() and flush() make no request, scans stay buffered', async () => {
    const log = quiet();
    try {
        const paused = { value: true };
        const sent = stubFetch();
        const api = newClient(paused);
        for (let i = 0; i < 30; i++) api.send({ n: i }); // > MAX_BATCH would normally flush
        await api.flush();
        assert.equal(sent.length, 0);
        assert.equal(api.queue.length, 30);
        assert.equal(api._flushTimer, null, 'no flush timer while held');
        assert.equal(log.lines.filter(l => l.includes('sending held')).length, 1, 'one line per hold');

        paused.value = false;
        api.resumeQueue();
        await api.flush();
        assert.equal(sent.length, 30, 'everything sent after resume');
        assert.deepEqual(sent.map(s => s.n), [...Array(30).keys()], 'original order');
        assert.ok(log.lines.some(l => l.includes('sending resumed — 30')));
    } finally {
        log.restore();
    }
});

test('pause mid-batch: the rest of the batch goes back to the queue', async () => {
    const log = quiet();
    try {
        const paused = { value: false };
        const sent = stubFetch((n) => { if (n === 3) paused.value = true; });
        const api = newClient(paused);
        for (let i = 0; i < 10; i++) api.queue.push({ n: i });
        await api.flush();
        assert.equal(sent.length, 3, 'no request after the pause');
        assert.deepEqual(api.queue.map(s => s.n), [3, 4, 5, 6, 7, 8, 9]);
        assert.ok(log.lines.some(l => l.includes('3 scan(s) sent')));

        paused.value = false;
        api.resumeQueue();
        await api.flush();
        assert.equal(sent.length, 10);
    } finally {
        log.restore();
    }
});

test('resume via OnlineStateWatch sends the buffer; request() is not held', async () => {
    const log = quiet();
    try {
        let state = 1;
        const watch = new mod.OnlineStateWatch(() => state);
        const sent = stubFetch();
        const api = new mod.ApiClient(config);
        api._paceScan = async () => {};
        api.setSendGate(() => watch.isPaused);
        watch.on('resume', () => api.resumeQueue());
        watch.check();
        api.send({ n: 1 });
        await api.flush();
        assert.equal(sent.length, 0);

        assert.notEqual(await api.request('GET', '/api/target-watch'), null);
        assert.equal(sent.length, 0, 'request() bypasses the scan queue');

        state = 2;
        watch.check();
        await api.flush();
        assert.deepEqual(sent, [{ n: 1 }]);
    } finally {
        log.restore();
    }
});
