// Registration via `/st config set api.url <url>?code=<code>` (lib/auto-enroll.js, 5.36.0).
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
        stdin: { contents: `export * from './lib/auto-enroll.js';`, resolveDir: root },
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
const { splitEnrollCode, setApiUrl } = await load();

function fakeConfig() {
    const data = {};
    return { data, get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
}
function fakeApi(registration, result) {
    const calls = [];
    return { calls, registration, enroll: async (code) => { calls.push(code); return result; } };
}

test('splitEnrollCode: code split off, rest of the URL kept', () => {
    assert.deepEqual(splitEnrollCode('https://packetlab.nl/shockr?code=ABC123'), { url: 'https://packetlab.nl/shockr', code: 'ABC123' });
    assert.deepEqual(splitEnrollCode('https://packetlab.nl/shockr/?code=ABC123'), { url: 'https://packetlab.nl/shockr/', code: 'ABC123' });
    assert.deepEqual(splitEnrollCode('https://x.nl/s?a=1&code=Z9&b=2'), { url: 'https://x.nl/s?a=1&b=2', code: 'Z9' });
});

test('splitEnrollCode: without code the value is untouched', () => {
    assert.deepEqual(splitEnrollCode('https://packetlab.nl/shockr'), { url: 'https://packetlab.nl/shockr', code: '' });
    assert.deepEqual(splitEnrollCode('https://packetlab.nl/shockr?code='), { url: 'https://packetlab.nl/shockr?code=', code: '' });
    assert.deepEqual(splitEnrollCode('not a url'), { url: 'not a url', code: '' });
    assert.deepEqual(splitEnrollCode(42), { url: 42, code: '' });
});

test('setApiUrl: with code -> URL stored without code, enrolled, success in chat', async () => {
    const config = fakeConfig();
    const api = fakeApi('none', { ok: true, message: 'registerSuccess', playerKey: 'k' });
    const lines = [];
    await setApiUrl(config, api, 'https://packetlab.nl/shockr?code=ABC123', l => lines.push(l));
    assert.equal(config.data['api.url'], 'https://packetlab.nl/shockr');
    assert.ok(!JSON.stringify(config.data).includes('ABC123'));
    assert.deepEqual(api.calls, ['ABC123']);
    assert.match(lines[1], /Registering\.\.\./);
    assert.match(lines[2], /Registered successfully/);
});

test('setApiUrl: without code -> stored, no enrollment', async () => {
    const config = fakeConfig();
    const api = fakeApi('none', null);
    const lines = [];
    await setApiUrl(config, api, 'https://packetlab.nl/shockr', l => lines.push(l));
    assert.equal(config.data['api.url'], 'https://packetlab.nl/shockr');
    assert.deepEqual(api.calls, []);
    assert.equal(lines.length, 1);
});

test('setApiUrl: already registered -> code skipped, URL still stored without code', async () => {
    const config = fakeConfig();
    const api = fakeApi('player', null);
    const lines = [];
    await setApiUrl(config, api, 'https://packetlab.nl/shockr?code=ABC123', l => lines.push(l));
    assert.equal(config.data['api.url'], 'https://packetlab.nl/shockr');
    assert.deepEqual(api.calls, []);
    assert.match(lines[1], /Already registered/);
});

test('setApiUrl: failure shows "Registration failed: <reason>"', async () => {
    const lines = [];
    await setApiUrl(fakeConfig(), fakeApi('shared', { ok: false, message: 'registerInvalidCode' }), 'https://x.nl?code=BAD', l => lines.push(l));
    assert.match(lines.at(-1), /Registration failed: Invalid enrollment code/);
    assert.ok(!lines.at(-1).includes('❌ Invalid'));

    const net = [];
    await setApiUrl(fakeConfig(), fakeApi('none', { ok: false, message: 'registerFailed', vars: { error: 'HTTP 500' } }), 'https://x.nl?code=C', l => net.push(l));
    assert.match(net.at(-1), /Registration failed: HTTP 500/);
});

test('setApiUrl: key held elsewhere (409) -> points to /st register', async () => {
    const lines = [];
    await setApiUrl(fakeConfig(), fakeApi('none', { ok: false, message: 'registerAlreadyHasKey', confirm: true }), 'https://x.nl?code=C', l => lines.push(l));
    assert.match(lines.at(-1), /another browser.*\/st register/);
});
