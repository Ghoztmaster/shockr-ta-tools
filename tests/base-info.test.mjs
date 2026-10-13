// BaseInfo plugin (plugins/base-info.js): labels on player bases on the world map.
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
            contents: `export { BaseInfo, labelText, baseNumber } from './plugins/base-info.js';`,
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

// Fake DOM: one canvas parent collecting appended elements.
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
            const el = { style: {}, attrs: {}, parentElement: null, textContent: '', title: '' };
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

// Fake game: objects keyed "x:y"; a 10x10 view at cells 0..9.
function fakeGame({ objects, ownCities = [], loaded = {}, mode = 'region' }) {
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    globalThis.ClientLib = {
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisMain: { GetInstance: () => ({
                get_Mode: () => mode,
                get_Region: () => ({
                    get_GridWidth: () => 10, get_GridHeight: () => 10, get_ZoomFactor: () => 1,
                    get_PosX: () => 0, get_PosY: () => 0, get_ViewWidth: () => 100, get_ViewHeight: () => 100,
                }),
                ScreenPosFromWorldPosX: (px) => px,
                ScreenPosFromWorldPosY: (py) => py,
            }) },
        },
        Data: {
            WorldSector: { ObjectType: { City: 1 } },
            MainData: { GetInstance: () => ({
                get_Player: () => ({ id: 42 }),
                get_World: () => ({ GetObjectFromPosition: (x, y) => objects[`${x}:${y}`] || null }),
                get_Cities: () => ({
                    get_AllCities: () => ({ d: Object.fromEntries(ownCities.map(id => [id, { get_Id: () => id }])) }),
                    GetCity: (id) => (loaded[id]
                        ? { get_LvlOffense: () => loaded[id][0], get_LvlDefense: () => loaded[id][1] }
                        : null),
                }),
            }) },
        },
    };
}

const city = (id, playerId) => ({ Type: 1, $Id: id, $PlayerId: playerId });

function texts(parent) {
    return parent.children.map(el => el.textContent).sort();
}

test('labelText / baseNumber', () => {
    assert.equal(mod.labelText(2, null), '#2');
    assert.equal(mod.labelText(1, { off: 23.44, def: 21 }), '#1 23.4/21.0');
    assert.equal(mod.baseNumber([30, 10, 20], 20), 2);
});

test('own bases numbered from the full own list, others from bases seen; FG skipped', () => {
    const parent = fakeDom();
    fakeGame({
        objects: {
            '1:1': city(500, 42),            // own, 2nd of [100, 500]
            '2:2': city(700, 9),             // other player, seen 2nd
            '3:3': city(600, 9),             // other player, seen 1st
            '4:4': { Type: 2, $Id: 900 },    // FG base
            '5:5': { Type: 3, $Id: 901, $CampType: 2 }, // FG camp
        },
        ownCities: [100, 500],
        loaded: { 500: [25.55, 22.04], 600: [18, 15.5] },
    });
    const p = new mod.BaseInfo({ get: () => undefined });
    p.running = true;
    p.update();
    assert.deepEqual(texts(parent), ['#1 18.0/15.5', '#2', '#2 25.6/22.0']);
    const own = parent.children.find(el => el.textContent.startsWith('#2 25'));
    assert.equal(own.style.color, '#00bcd4');
});

test('levels are cached once the client had the base loaded', () => {
    const parent = fakeDom();
    const loaded = { 700: [20, 19] };
    fakeGame({ objects: { '2:2': city(700, 9) }, loaded });
    const p = new mod.BaseInfo({ get: () => undefined });
    p.running = true;
    p.update();
    assert.deepEqual(texts(parent), ['#1 20.0/19.0']);
    delete loaded[700];
    p.update();
    assert.deepEqual(texts(parent), ['#1 20.0/19.0']);
});

test('nothing rendered outside the world map, labels removed on leaving it', () => {
    const parent = fakeDom();
    fakeGame({ objects: { '1:1': city(500, 42) }, ownCities: [500], mode: 'city' });
    const p = new mod.BaseInfo({ get: () => undefined });
    p.running = true;
    p.update();
    assert.equal(parent.children.length, 0);

    fakeGame({ objects: { '1:1': city(500, 42) }, ownCities: [500] });
    p.update();
    assert.equal(parent.children.length, 1);
    fakeGame({ objects: { '1:1': city(500, 42) }, ownCities: [500], mode: 'city' });
    p.update();
    assert.equal(parent.children.length, 0);
});
