// PvpAlert: own base under attack while the tab is in the background (plugins/pvp-alert.js).
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
        stdin: { contents: `export * from './plugins/pvp-alert.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

// ─── Fakes ──────────────────────────────────────────────────────────

function fakeLink(attrs = {}) {
    const a = { ...attrs };
    return {
        parentNode: null,
        get href() { return a.href; }, set href(v) { a.href = v; },
        get rel() { return a.rel; }, set rel(v) { a.rel = v; },
        get type() { return a.type; }, set type(v) { a.type = v; },
        getAttribute(k) { return a[k] ?? null; },
        setAttribute(k, v) { a[k] = v; },
        removeAttribute(k) { delete a[k]; },
    };
}

function setup({ bases = [], focus = true, icon = 'game.ico' } = {}) {
    const state = { focus, bases, logs: [] };
    const head = {
        children: [],
        appendChild(el) { el.parentNode = this; this.children.push(el); },
        removeChild(el) { el.parentNode = null; this.children.splice(this.children.indexOf(el), 1); },
    };
    if (icon) head.appendChild(fakeLink({ rel: 'icon', href: icon }));
    globalThis.document = {
        title: 'Tiberium Alliances',
        hasFocus: () => state.focus,
        getElementsByTagName: () => [head],
        querySelectorAll: () => head.children.filter(el => /icon/.test(el.rel)),
        createElement: () => fakeLink(),
    };
    state.audio = [];
    globalThis.Audio = class {
        constructor(src) { this.src = src; this.playing = false; this.currentTime = 0; state.audio.push(this); }
        play() { this.playing = true; return Promise.resolve(); }
        pause() { this.playing = false; }
    };
    globalThis.ClientLib = { Data: { MainData: { GetInstance: () => ({
        get_Cities: () => ({ get_AllCities: () => ({
            d: Object.fromEntries(state.bases.map((b, i) => [i, {
                get_Name: () => b.name, get_isAlerted: () => !!b.alerted,
            }])),
        }) }),
    }) } } };
    const store = {};
    const config = { get: (k, d) => (k.toLowerCase() in store ? store[k.toLowerCase()] : d), set: (k, v) => { store[k.toLowerCase()] = v; } };
    const origLog = console.log;
    console.log = (...a) => state.logs.push(a.join(' '));
    state.restoreLog = () => { console.log = origLog; };
    const plugin = new mod.PvpAlert(config);
    plugin.running = true; // no timer in tests: call check() directly
    return { state, head, plugin, config };
}

const icons = (head) => head.children.map(el => el.getAttribute('href'));

// ─── Tests ──────────────────────────────────────────────────────────

test('background + alerted base → title, alert favicon, siren, console line', () => {
    const { state, head, plugin } = setup({ bases: [{ name: 'Alpha' }, { name: 'Bravo', alerted: true }], focus: false });
    plugin.check();
    state.restoreLog();
    assert.equal(document.title, 'ALERT - Base Bravo under attack!');
    assert.ok(icons(head).some(h => h && h.startsWith('data:image/svg+xml')));
    assert.equal(state.audio.length, 1);
    assert.equal(state.audio[0].playing, true);
    assert.ok(state.logs.includes('[ST] PvP Alert: (unknown) attacks Bravo'));
});

test('focused tab → no alarm (as the original), console line still once', () => {
    const { state, plugin } = setup({ bases: [{ name: 'Alpha', alerted: true }], focus: true });
    plugin.check();
    plugin.check();
    state.restoreLog();
    assert.equal(document.title, 'Tiberium Alliances');
    assert.equal(state.audio.length, 0);
    assert.equal(state.logs.filter(l => l.includes('attacks Alpha')).length, 1);
});

test('alarm fires once, resets on return: title, favicon, siren', () => {
    const { state, head, plugin } = setup({ bases: [{ name: 'Alpha', alerted: true }], focus: false });
    plugin.check();
    plugin.check();
    state.restoreLog();
    assert.equal(state.audio.length, 1);
    state.focus = true;
    plugin.check();
    assert.equal(document.title, 'Tiberium Alliances');
    assert.deepEqual(icons(head), ['game.ico']);
    assert.equal(state.audio[0].playing, false);
    assert.equal(state.audio[0].currentTime, 0);
});

test('PvpAlert.sound false → no siren, title still changes', () => {
    const { state, plugin, config } = setup({ bases: [{ name: 'Alpha', alerted: true }], focus: false });
    config.set('PvpAlert.sound', false);
    plugin.check();
    state.restoreLog();
    assert.equal(state.audio.length, 0);
    assert.match(document.title, /ALERT - Base Alpha/);
});

test('stop() during an alarm restores title and favicon', () => {
    const { state, head, plugin } = setup({ bases: [{ name: 'Alpha', alerted: true }], focus: false });
    plugin.check();
    plugin.stop();
    state.restoreLog();
    assert.equal(document.title, 'Tiberium Alliances');
    assert.deepEqual(icons(head), ['game.ico']);
    assert.equal(plugin.running, false);
});

test('no own favicon → the neutral Shockr icon after the alarm', () => {
    const { state, head, plugin } = setup({ bases: [{ name: 'Alpha', alerted: true }], focus: false, icon: null });
    plugin.check();
    state.focus = true;
    plugin.check();
    state.restoreLog();
    assert.equal(head.children.length, 1);
    assert.ok(icons(head)[0].startsWith('data:image/svg+xml'));
    assert.ok(icons(head)[0].includes('546e7a'), 'the grey shield, not the red alert icon');
});

test('ClientLib not ready → nothing alerted, no throw', () => {
    const { state } = setup();
    globalThis.ClientLib = {};
    state.restoreLog();
    assert.deepEqual(mod.alertedBases(), []);
});
