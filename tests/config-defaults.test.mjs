// Changed plugin defaults reach fresh installs only (lib/config.js pinChangedDefaults).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../lib/config.js';

function fakeStorage(initial = {}) {
    const store = { ...initial };
    globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    };
    return store;
}

const plugins = [{ name: 'TargetWatcher' }, { name: 'LayoutScanner' }, { name: 'RepairGuard', defaultEnabled: false }];
const legacy = { TargetWatcher: false };

test('fresh install: TargetWatcher on', () => {
    fakeStorage();
    const c = new Config('st-config');
    assert.equal(c.isNew, true);
    c.pinChangedDefaults(plugins, legacy);
    assert.equal(c.get('TargetWatcher.enabled'), true);
    assert.equal(c.get('LayoutScanner.enabled'), undefined);   // untouched, default on
    assert.equal(c.get('RepairGuard.enabled'), undefined);
});

test('fresh install stays on at the next startup', () => {
    const store = fakeStorage();
    new Config('st-config').pinChangedDefaults(plugins, legacy);
    const c2 = new Config('st-config');
    assert.equal(c2.isNew, false);
    c2.pinChangedDefaults(plugins, legacy);
    assert.equal(c2.get('TargetWatcher.enabled'), true);
    assert.ok(store['st-config']);
});

test('existing install without a choice keeps the old default (off)', () => {
    fakeStorage({ 'st-config': JSON.stringify({ 'api.url': 'https://x' }) });
    const c = new Config('st-config');
    assert.equal(c.isNew, false);
    c.pinChangedDefaults(plugins, legacy);
    assert.equal(c.get('TargetWatcher.enabled'), false);
});

test('existing install keeps an explicit choice', () => {
    fakeStorage({ 'st-config': JSON.stringify({ 'targetwatcher.enabled': true }) });
    const c = new Config('st-config');
    c.pinChangedDefaults(plugins, legacy);
    assert.equal(c.get('TargetWatcher.enabled'), true);
});
