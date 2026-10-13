// TunnelInfo: tunnel level / required offense / influence range on the world map (plugins/tunnel-info.js).
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
        stdin: { contents: `export * from './plugins/tunnel-info.js';`, resolveDir: root },
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
    const parent = { children: [], appendChild(el) { el.parentElement = parent; parent.children.push(el); } };
    const make = () => {
        const el = {
            style: {}, parentElement: null, className: '', textContent: '', title: '',
            remove() {
                if (!el.parentElement) return;
                const p = el.parentElement;
                p.children.splice(p.children.indexOf(el), 1);
                el.parentElement = null;
            },
        };
        return el;
    };
    globalThis.document = {
        createElement: make,
        querySelector: (sel) => (sel === 'canvas' ? { parentElement: parent } : null),
    };
    return parent;
}

const POI = 7;

// Grid 100x80 px, zoom 1, origin 0 -> screen px = world px. Objects keyed by cell "x:y".
function fakeGame({ mode = 'region', objects = {}, offense = [40], diff = 3, announcement = '' } = {}) {
    const state = { mode };
    const region = {
        get_GridWidth: () => 100, get_GridHeight: () => 80,
        get_ViewWidth: () => 2000, get_ViewHeight: () => 1600,
        get_PosX: () => 0, get_PosY: () => 0, get_ZoomFactor: () => 1,
        GetObjectFromPosition: (px, py) => objects[`${px / 100}:${py / 80}`] || null,
    };
    globalThis.ClientLib = {
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisObject: { EObjectType: { RegionPointOfInterest: POI } },
            VisMain: { GetInstance: () => ({
                get_Mode: () => state.mode,
                get_Region: () => region,
                ScreenPosFromWorldPosX: (v) => v,
                ScreenPosFromWorldPosY: (v) => v,
            }) },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Server: () => ({ get_POIActivationLevelDifference: () => diff }),
            get_Alliance: () => ({ get_Announcement: () => announcement }),
            get_Cities: () => ({ get_AllCities: () => ({
                d: Object.fromEntries(offense.map((o, i) => [i + 1, { get_LvlOffense: () => o }])),
            }) }),
        }) } },
    };
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    return state;
}

function poi(x, y, level, type = 0) {
    return {
        get_VisObjectType: () => POI, get_Type: () => type,
        get_RawX: () => x, get_RawY: () => y, get_Level: () => level,
    };
}

const labels = (parent) => parent.children.filter(e => e.className === 'st-tunnel-info');
const circles = (parent) => parent.children.filter(e => e.className === 'st-tunnel-range');

test('parseInfluenceRange: [tir]N[/tir] tag, else 6', () => {
    assert.equal(mod.parseInfluenceRange('Hello [tir]4[/tir] bye'), 4);
    assert.equal(mod.parseInfluenceRange('no tag here'), 6);
    assert.equal(mod.parseInfluenceRange(null), 6);
    assert.equal(mod.parseInfluenceRange('[tir]0[/tir]'), 6);
});

test('label and colour: green when max offense reaches level - activation diff, red otherwise', async () => {
    const parent = fakeDom();
    fakeGame({
        objects: { '2:2': poi(2, 2, 42), '5:3': poi(5, 3, 45), '8:8': poi(8, 8, 30, 1) },
        offense: [38, 40],   // max 40
        diff: 3,
        announcement: '[tir]5[/tir]',
    });
    const p = new mod.TunnelInfo({});
    await p.start();
    try {
        const ls = labels(parent);
        assert.equal(ls.length, 2);   // non-tunnel POI (type 1) ignored
        const t42 = ls.find(l => l.textContent === 'T42 · ≥39');
        const t45 = ls.find(l => l.textContent === 'T45 · ≥42');
        assert.ok(t42 && t45);
        assert.equal(t42.style.color, '#06ff00');
        assert.equal(t45.style.color, '#ff3600');
        // Circle: radius 5 cells around the centre of cell (2,2): centre (250, 200), rx 500, ry 400
        const cs = circles(parent);
        assert.equal(cs.length, 2);
        const c = cs.find(e => e.style.left === '-250px');
        assert.ok(c);
        assert.equal(c.style.top, '-200px');
        assert.equal(c.style.width, '1000px');
        assert.equal(c.style.height, '800px');
    } finally {
        p.stop();
    }
});

test('nothing off the world map; cleared when leaving it', async () => {
    const parent = fakeDom();
    const state = fakeGame({ mode: 'city', objects: { '2:2': poi(2, 2, 42) } });
    const p = new mod.TunnelInfo({});
    await p.start();
    try {
        assert.equal(parent.children.length, 0);
        state.mode = 'region';
        p.update();
        assert.equal(parent.children.length, 2);
        state.mode = 'city';
        p.update();
        assert.equal(parent.children.length, 0);
    } finally {
        p.stop();
    }
});

test('stop() removes everything', async () => {
    const parent = fakeDom();
    fakeGame({ objects: { '2:2': poi(2, 2, 42), '4:4': poi(4, 4, 20) } });
    const p = new mod.TunnelInfo({});
    await p.start();
    assert.equal(parent.children.length, 4);
    p.stop();
    assert.equal(parent.children.length, 0);
    assert.equal(p.tunnels.size, 0);
    p.update();   // after stop: no-op
    assert.equal(parent.children.length, 0);
});
