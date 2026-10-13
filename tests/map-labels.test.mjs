// MapLabels plugin (plugins/map-labels.js): 👁/📌/⚔ labels on FG targets on the world map.
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
            contents: `export { MapLabels, mergeLabels, truncateName, isFgTarget } from './plugins/map-labels.js';`,
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

function fakeDom() {
    const parent = { children: [] };
    parent.appendChild = (el) => {
        if (el.parentElement) el.remove();
        parent.children.push(el);
        el.parentElement = parent;
    };
    globalThis.document = {
        querySelector: (sel) => (sel === 'canvas' ? { parentElement: parent } : null),
        createElement: () => {
            const el = { style: {}, attrs: {}, parentElement: null, title: '', children: [] };
            let text = '';
            Object.defineProperty(el, 'textContent', {
                get: () => text + el.children.map(c => c.textContent).join(''),
                set: (v) => { text = v; el.children = []; },
            });
            el.appendChild = (c) => { el.children.push(c); };
            el.setAttribute = (k, v) => { el.attrs[k] = v; };
            el.remove = () => {
                if (el.parentElement) {
                    const c = el.parentElement.children;
                    c.splice(c.indexOf(el), 1);
                    el.parentElement = null;
                }
            };
            return el;
        },
    };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    return parent;
}

function fakeGame(state) {
    const sent = [];
    globalThis.webfrontend = { phe: { cnc: { Util: {
        attachNetEvent() {}, detachNetEvent() {},
        createEventDelegate: (type, ctx, fn) => fn,
    } } } };
    globalThis.ClientLib = {
        Net: {
            CommandResult: {},
            CommunicationManager: { GetInstance: () => ({
                SendSimpleCommand: (name, args, cb) => { sent.push(name); cb(null, state.headers || []); },
            }) },
        },
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisMain: { GetInstance: () => ({
                get_Mode: () => state.mode,
                get_Region: () => ({
                    get_GridWidth: () => 10, get_GridHeight: () => 10, get_ZoomFactor: () => 1,
                    get_PosX: () => 0, get_PosY: () => 0, get_ViewWidth: () => 100, get_ViewHeight: () => 100,
                }),
                ScreenPosFromWorldPosX: (px) => px,
                ScreenPosFromWorldPosY: (py) => py,
            }) },
        },
        Data: {
            MainData: { GetInstance: () => ({
                get_Player: () => ({ id: 42, name: 'GhoztMasters' }),
                get_Server: () => ({ get_WorldId: () => 455 }),
                get_World: () => ({ GetObjectFromPosition: (x, y) => state.objects[`${x}:${y}`] || null }),
            }) },
        },
    };
    return sent;
}

function fakeApi(data) {
    const calls = [];
    return {
        calls,
        isConfigured: true,
        request: async (method, p, body) => {
            calls.push(`${method} ${p}`);
            if (p.startsWith('/api/target-watch/')) return { targets: data.targets || [] };
            if (p === '/api/watchlist') return { claims: data.claims || [] };
            return null;
        },
    };
}

const flush = () => new Promise(r => setTimeout(r, 0));

test('mergeLabels: per player the highest status wins; players stacked attacked > claimed > viewing', () => {
    const m = mod.mergeLabels({
        watches: [
            { x: 3, y: 4, targetId: 9, playerId: 1, playerName: 'Ghozt' },
            { x: 3, y: 4, targetId: 9, playerId: 2, playerName: 'zed' },
        ],
        claims: [{ x: 3, y: 4, playerId: 1, playerName: 'Ghozt' }],
        attacks: [{ x: 3, y: 4, playerId: 3, playerName: 'delta3dany' }],
    });
    const lines = m.get('3:4').lines.map(l => `${l.status}:${l.playerName}`);
    assert.deepEqual(lines, ['attacked:delta3dany', 'claimed:Ghozt', 'viewing:zed']);
});

test('mergeLabels: own 👁 only while the local TargetWatcher views that target', () => {
    const data = { watches: [{ x: 1, y: 1, targetId: 9, playerId: 42, playerName: 'me' }] };
    assert.equal(mod.mergeLabels(data, { ownId: 42, ownCurrentTargetId: 9 }).get('1:1').lines.length, 1);
    assert.equal(mod.mergeLabels(data, { ownId: 42, ownCurrentTargetId: null }).has('1:1'), false);
    assert.equal(mod.mergeLabels(data, { ownId: 42, ownCurrentTargetId: 7 }).has('1:1'), false);
});

test('truncateName', () => {
    assert.equal(mod.truncateName('GhoztMasters'), 'GhoztMast…');
    assert.equal(mod.truncateName('Ghozt'), 'Ghozt');
    assert.equal(mod.truncateName('0123456789'), '0123456789');
});

test('isFgTarget: NPC base / live camp only, never player base or destroyed camp', () => {
    const objects = { '1:1': { Type: 2 }, '2:2': { Type: 3, $CampType: 2 }, '3:3': { Type: 3, $CampType: 0 }, '4:4': { Type: 1 } };
    const world = { GetObjectFromPosition: (x, y) => objects[`${x}:${y}`] || null };
    assert.equal(mod.isFgTarget(world, 1, 1), true);
    assert.equal(mod.isFgTarget(world, 2, 2), true);
    assert.equal(mod.isFgTarget(world, 3, 3), false);
    assert.equal(mod.isFgTarget(world, 4, 4), false);
    assert.equal(mod.isFgTarget(world, 5, 5), false);
});

test('render: labels on FG targets, none on player bases; target disappears → label gone', async () => {
    const parent = fakeDom();
    const state = { mode: 'region', objects: { '2:2': { Type: 3, $CampType: 3 }, '5:5': { Type: 1 } } };
    fakeGame(state);
    const api = fakeApi({ claims: [
        { targetX: 2, targetY: 2, playerId: 7, playerName: 'GhoztMasters' },
        { targetX: 5, targetY: 5, playerId: 7, playerName: 'GhoztMasters' },
    ] });
    const p = new mod.MapLabels({ get: (k, d) => d }, api, {});
    await p.start();
    await flush();
    assert.equal(parent.children.length, 1);
    const el = parent.children[0];
    assert.equal(el.textContent, '📌 GhoztMast…');
    assert.equal(el.style.left, '25px');
    assert.equal(el.style.top, '29.5px');
    assert.match(el.title, /GhoztMasters/);

    state.objects['2:2'].$CampType = 0;   // defeated
    p.render();
    assert.equal(parent.children.length, 0);
    state.objects['2:2'] = { Type: 3, $CampType: 3 };
    p.render();
    assert.equal(parent.children.length, 1);
    delete state.objects['2:2'];           // gone from the map
    p.render();
    assert.equal(parent.children.length, 0);
    p.stop();
});

test('own won attacks become ⚔ with the own name; lost/PvP/old reports ignored', async () => {
    const parent = fakeDom();
    const now = Date.now();
    const header = (over) => ({ i: Math.random(), t: now - 1000, tp: 2, s: true, ad: { dbn: '3', dbx: 2, dby: 2, dbl: 18 }, ...over });
    const state = {
        mode: 'region',
        objects: { '2:2': { Type: 3, $CampType: 3 }, '3:3': { Type: 2 }, '4:4': { Type: 2 } },
        headers: [
            header({}),
            header({ s: false, ad: { dbn: '4', dbx: 3, dby: 3 } }),
            header({ tp: 1, ad: { dbn: '4', dbx: 3, dby: 3 } }),
            header({ t: now - 8 * 86400000, ad: { dbn: '4', dbx: 4, dby: 4 } }),
        ],
    };
    const sent = fakeGame(state);
    const p = new mod.MapLabels({ get: (k, d) => d }, { isConfigured: false }, {});
    await p.start();
    assert.deepEqual(sent, ['GetReportHeaderAll']);
    assert.equal(parent.children.length, 1);
    assert.equal(parent.children[0].textContent, '⚔ GhoztMast…');
    p.stop();
    assert.equal(parent.children.length, 0);
});

test('off the world map: no polling, no labels', async () => {
    const parent = fakeDom();
    const state = { mode: 'city', objects: { '2:2': { Type: 2 } } };
    const sent = fakeGame(state);
    const api = fakeApi({ claims: [{ targetX: 2, targetY: 2, playerId: 7, playerName: 'x' }] });
    const p = new mod.MapLabels({ get: (k, d) => d }, api, {});
    await p.start();
    await flush();
    assert.deepEqual(api.calls, []);
    assert.deepEqual(sent, []);
    assert.equal(parent.children.length, 0);

    // On the map: polls; back to the base view: labels removed
    state.mode = 'region';
    p.poll(Date.now() + 61000);
    await flush();
    assert.ok(api.calls.includes('GET /api/target-watch/455'));
    assert.ok(api.calls.includes('POST /api/watchlist'));
    assert.equal(parent.children.length, 1);
    state.mode = 'city';
    p.render();
    assert.equal(parent.children.length, 0);
    p.stop();
});

test('own 👁 follows the local TargetWatcher', async () => {
    const parent = fakeDom();
    const state = { mode: 'region', objects: { '2:2': { Type: 2 } } };
    fakeGame(state);
    const api = fakeApi({ targets: [{ targetId: 9, targetX: 2, targetY: 2, watchers: [{ playerId: 42, playerName: 'GhoztMasters' }] }] });
    const tw = { running: true, _currentId: 9 };
    const p = new mod.MapLabels({ get: (k, d) => d }, api, { targetWatcher: tw });
    await p.start();
    await flush();
    assert.equal(parent.children[0].textContent, '👁 GhoztMast…');
    tw._currentId = null;
    p.render();
    assert.equal(parent.children.length, 0);
    p.stop();
});

// Safety net: a failing assertion before p.stop() must not keep the run alive.
