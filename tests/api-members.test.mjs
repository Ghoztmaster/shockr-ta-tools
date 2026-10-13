// Alliance member list on the scan POST (lib/api-client.js, 5.17.0): first scan
// batch after login, then once per hour; unreadable list = not sent.
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
        stdin: { contents: `export { ApiClient, readAllianceMembers } from './lib/api-client.js';`, resolveDir: root },
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

function fakeGame(memberData) {
    globalThis.ClientLib = { Data: { MainData: { GetInstance: () => ({
        get_Player: () => ({ id: 164, name: 'GhoztMasters' }),
        get_Server: () => ({ get_WorldId: () => 477 }),
        get_Alliance: () => ({ get_Id: () => 100, get_MemberData: () => ({ d: memberData }) }),
    }) } } };
}

function stubFetch(status = 200) {
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        sent.push(JSON.parse(opts.body));
        return { ok: status === 200, status, statusText: '', json: async () => ({}) };
    };
    return sent;
}

function newClient() {
    const api = new mod.ApiClient(config);
    api._paceScan = async () => {};
    return api;
}

const MEMBERS = { 164: { Id: 164, Name: 'GhoztMasters' }, 87: { Id: 87, Name: 'delta3dany' } };

test('readAllianceMembers: {playerId, playerName} per member; no alliance / empty = null', () => {
    fakeGame(MEMBERS);
    assert.deepEqual(mod.readAllianceMembers().sort((a, b) => a.playerId - b.playerId),
        [{ playerId: 87, playerName: 'delta3dany' }, { playerId: 164, playerName: 'GhoztMasters' }]);
    fakeGame({});
    assert.equal(mod.readAllianceMembers(), null);
    globalThis.ClientLib = undefined;
    assert.equal(mod.readAllianceMembers(), null);
});

test('first scan after login carries the list, then only once per hour', async () => {
    fakeGame(MEMBERS);
    const sent = stubFetch();
    const api = newClient();
    for (let i = 0; i < 3; i++) api.send({ n: i });
    await api.flush();
    assert.equal(sent.length, 3);
    assert.equal(sent[0].allianceMembers.length, 2, 'first scan of the first batch');
    assert.ok(!('allianceMembers' in sent[1]) && !('allianceMembers' in sent[2]));
    assert.ok(!('allianceMembers' in api.queue), 'queued payloads are not changed');

    api.send({ n: 3 });
    await api.flush();
    assert.ok(!('allianceMembers' in sent[3]), 'within the hour: not again');

    api._membersSentAt -= 3600 * 1000;
    api.send({ n: 4 });
    await api.flush();
    assert.equal(sent[4].allianceMembers.length, 2, 'an hour later: again');
});

test('a failed scan does not count as sent: the next scan carries the list', async () => {
    fakeGame(MEMBERS);
    let sent = stubFetch(400);
    const api = newClient();
    const origWarn = console.warn; console.warn = () => {};
    try {
        api.send({ n: 0 });
        await api.flush();
    } finally { console.warn = origWarn; }
    assert.ok(sent[0].allianceMembers);
    sent = stubFetch(200);
    api.send({ n: 1 });
    await api.flush();
    assert.ok(sent[0].allianceMembers);
});
