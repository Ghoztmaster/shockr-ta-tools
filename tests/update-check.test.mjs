// In-game "new version available" notice (lib/update-check.js, 5.25.0).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, checkForUpdate, announceUpdateOnce, _resetUpdateNotice } from '../lib/update-check.js';

function stubFetch(status, body, calls = []) {
    return async (url, opts) => {
        calls.push({ url, opts });
        if (status === 'throw') throw new TypeError('Failed to fetch');
        return { ok: status === 200, status, json: async () => body };
    };
}

test('compareVersions is numeric per part, not a string compare', () => {
    assert.ok(compareVersions('5.26.0', '5.9.0') > 0, '5.26 > 5.9');
    assert.ok(compareVersions('5.9.0', '5.26.0') < 0);
    assert.equal(compareVersions('5.26.0', '5.26.0'), 0);
    assert.equal(compareVersions('5.26', '5.26.0'), 0, 'missing part = 0');
    assert.ok(compareVersions('6.0.0', '5.99.99') > 0);
    assert.ok(compareVersions('5.26.1', '5.26.0') > 0);
    assert.ok(compareVersions('v5.27.0', '5.26.0') > 0, 'leading v ignored');
    assert.equal(compareVersions('', '5.26.0') < 0, true, 'empty = 0.0.0');
});

test('checkForUpdate: GET {api.url}/api/version, newer only when semver-higher', async () => {
    const calls = [];
    const r = await checkForUpdate('https://packetlab.nl/shockr/', '5.26.0', stubFetch(200, { version: '5.27.0' }, calls));
    assert.deepEqual(r, { newer: true, version: '5.27.0' });
    assert.equal(calls[0].url, 'https://packetlab.nl/shockr/api/version', 'trailing slash stripped');
    assert.equal(calls[0].opts.method, 'GET');

    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch(200, { version: '5.26.0' })), { newer: false, version: '5.26.0' });
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch(200, { version: '5.9.0' })), { newer: false, version: '5.9.0' });
});

test('checkForUpdate is silent on failure: no url, HTTP error, bad body, network error', async () => {
    const silent = { newer: false, version: null };
    const calls = [];
    assert.deepEqual(await checkForUpdate('', '5.26.0', stubFetch(200, { version: '9.0.0' }, calls)), silent);
    assert.equal(calls.length, 0, 'no url -> no request');
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch(503, {})), silent);
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch(200, { date: 'no version field' })), silent);
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch(200, null)), silent);
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', stubFetch('throw')), silent);
    assert.deepEqual(await checkForUpdate('https://x', '5.26.0', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })), silent);
});

test('announceUpdateOnce: one notice per session, none when not newer', async () => {
    _resetUpdateNotice();
    const shown = [];
    const notify = (v) => shown.push(v);
    assert.equal(await announceUpdateOnce({ url: 'https://x', current: '5.26.0', notify, fetchFn: stubFetch(200, { version: '5.26.0' }) }), null);
    assert.deepEqual(shown, []);
    assert.equal(await announceUpdateOnce({ url: 'https://x', current: '5.26.0', notify, fetchFn: stubFetch(200, { version: '5.27.0' }) }), '5.27.0');
    assert.equal(await announceUpdateOnce({ url: 'https://x', current: '5.26.0', notify, fetchFn: stubFetch(200, { version: '5.28.0' }) }), null, 'second call: nothing');
    assert.deepEqual(shown, ['5.27.0']);
    _resetUpdateNotice();
});

test('announceUpdateOnce never throws, even when notify does', async () => {
    _resetUpdateNotice();
    const r = await announceUpdateOnce({ url: 'https://x', current: '1.0.0', notify: () => { throw new Error('chat gone'); },
        fetchFn: stubFetch(200, { version: '1.0.1' }) });
    assert.equal(r, '1.0.1');
    _resetUpdateNotice();
});
