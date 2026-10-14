// Config-loss mitigation (5.24.0): /st config export|import (lib/config-transfer.js),
// the default api.url and the re-register guard (lib/api-client.js).
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
            contents: `export { exportConfig, parseImport, applyImport } from './lib/config-transfer.js';
                       export { ApiClient, DEFAULT_API_URL } from './lib/api-client.js';
                       export { Config } from './lib/config.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stub-main',
            setup(b) {
                // './main.js' from lib/ - the real one would start the whole tool
                b.onResolve({ filter: /(^|\/)main\.js$/ }, () => ({ path: 'main', namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function chatMessage() {}' }));
            },
        }],
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

const store = {};
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};

function freshConfig(data) {
    for (const k of Object.keys(store)) delete store[k];
    if (data) store['st-config'] = JSON.stringify(data);
    return new mod.Config('st-config');
}

// ─── export / import ────────────────────────────────────────────────

test('export -> import round trip restores every key, incl. the personal key', () => {
    const src = freshConfig({ 'api.url': 'https://example.test', 'api.playerkey': 'abc', 'api.playerkeyid': 164,
        'camptracker.size': 30, 'movablemenu.positions': { mail: { left: 5, top: 9 } } });
    const text = mod.exportConfig(src.data);
    assert.ok(!text.includes('\n'), 'one line, so it fits a chat line / copy');

    const dst = freshConfig({ 'language': 'nl', 'camptracker.size': 24 });
    const parsed = mod.parseImport(text);
    assert.equal(parsed.ok, true);
    assert.equal(mod.applyImport(dst, parsed.data), 5);
    assert.equal(dst.get('api.playerKey'), 'abc');
    assert.equal(dst.get('CampTracker.size'), 30, 'imported keys overwrite');
    assert.equal(dst.get('language'), 'nl', 'other local keys stay');
    assert.deepEqual(JSON.parse(store['st-config'])['movablemenu.positions'], { mail: { left: 5, top: 9 } }, 'saved');
});

test('import accepts a bare object and lower-cases keys like Config does', () => {
    const parsed = mod.parseImport('  {"API.URL":"https://x.test","Help.Popup":false}  ');
    assert.deepEqual(parsed, { ok: true, data: { 'api.url': 'https://x.test', 'help.popup': false } });
});

test('import rejects anything that is not a config export', () => {
    for (const bad of ['', 'hello', '[1,2]', '42', '{}', '{"st-config":{}}', '{"st-config":[1]}', 'null']) {
        assert.equal(mod.parseImport(bad).ok, false, bad);
    }
});

// ─── default api.url ───────────────────────────────────────────────

test('api.url falls back to the alliance server; a set value wins', () => {
    assert.equal(mod.DEFAULT_API_URL, 'https://packetlab.nl/shockr');
    assert.equal(new mod.ApiClient(freshConfig())._url, 'https://packetlab.nl/shockr');
    assert.equal(new mod.ApiClient(freshConfig({ 'api.url': 'https://own.test' }))._url, 'https://own.test');
});

// ─── re-register guard ─────────────────────────────────────────────

function fakeGame() {
    globalThis.location = { pathname: '/477/index.aspx' };
    globalThis.ClientLib = { Data: { MainData: { GetInstance: () => ({
        get_Player: () => ({ id: 164, name: 'GhoztMasters', get_AllianceId: () => 100 }),
        get_Server: () => ({ get_WorldId: () => 477 }),
        get_Alliance: () => ({ get_Id: () => 100 }),
    }) } } };
}

function stubFetch(responses) {
    const sent = [];
    globalThis.fetch = async (url, opts) => {
        sent.push(JSON.parse(opts.body));
        const [status, body] = responses.shift();
        return { ok: status === 200, status, json: async () => body };
    };
    return sent;
}

test('own key in this browser: ask first, nothing sent; confirmed -> replace: true', async () => {
    fakeGame();
    const api = new mod.ApiClient(freshConfig({ 'api.playerkey': 'old', 'api.playerkeyid': 164 }));
    const sent = stubFetch([[200, { playerKey: 'new' }]]);
    assert.deepEqual(await api.enroll('code'), { ok: false, message: 'registerAlreadyHasKey', confirm: true });
    assert.equal(sent.length, 0);
    const r = await api.enroll('code', true);
    assert.equal(r.ok, true);
    assert.equal(sent[0].replace, true);
    assert.equal(api.config.get('api.playerKey'), 'new');
});

test('no key here but the server has one (other host): 409 -> ask', async () => {
    fakeGame();
    const api = new mod.ApiClient(freshConfig());
    const sent = stubFetch([[409, { detail: 'Already registered' }]]);
    assert.deepEqual(await api.enroll('code'), { ok: false, message: 'registerAlreadyHasKey', confirm: true });
    assert.equal(sent[0].replace, false, 'first attempt never replaces');
    assert.equal(api.config.get('api.playerKey'), undefined);
});

test('a key of another account in this browser does not trigger the warning', async () => {
    fakeGame();
    const api = new mod.ApiClient(freshConfig({ 'api.playerkey': 'x', 'api.playerkeyid': 999 }));
    stubFetch([[200, { playerKey: 'mine' }]]);
    assert.equal((await api.enroll('code')).ok, true);
});
