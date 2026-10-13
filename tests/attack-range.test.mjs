// AttackRange: one range circle per own base on the world map (plugins/attack-range.js).
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
        stdin: { contents: `export * from './plugins/attack-range.js';`, resolveDir: root },
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

// Minimal DOM: elements with style, parentElement, remove(); one canvas parent.
function fakeDom() {
    const parent = { children: [], appendChild(el) { el.parentElement = parent; parent.children.push(el); } };
    const make = () => {
        const el = {
            style: {}, parentElement: null, className: '',
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

// Grid 100x80 px per cell, zoom 1, region origin at world px 0 -> screen = world px.
function fakeGame({ mode = 'region', bases = [{ id: 1, x: 10, y: 10 }, { id: 2, x: 30, y: 12 }] } = {}) {
    const state = { mode, bases };
    const region = {
        get_GridWidth: () => 100, get_GridHeight: () => 80,
        get_ViewWidth: () => 4000, get_ViewHeight: () => 3000,
    };
    globalThis.ClientLib = {
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisMain: { GetInstance: () => ({
                get_Mode: () => state.mode,
                get_Region: () => region,
                ScreenPosFromWorldPosX: (v) => v,
                ScreenPosFromWorldPosY: (v) => v,
            }) },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Server: () => ({ get_MaxAttackDistance: () => 10 }),
            get_Cities: () => ({ get_AllCities: () => ({
                d: Object.fromEntries(state.bases.map(b => [b.id, {
                    get_Id: () => b.id, get_PosX: () => b.x, get_PosY: () => b.y,
                }])),
            }) }),
        }) } },
    };
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    return state;
}

function quiet(fn) {
    const orig = console.log;
    console.log = () => {};
    try { return fn(); } finally { console.log = orig; }
}

test('one circle per own base, centred on the cell with the attack range as radius', async () => {
    const parent = fakeDom();
    fakeGame();
    const p = new mod.AttackRange({});
    await quiet(() => p.start());
    try {
        assert.equal(parent.children.length, 2);
        const c = p.circles.get(1).el.style;
        // centre (10.5*100, 10.5*80) = (1050, 840); radius 10 cells = 1000 x 800 px
        assert.equal(c.left, '50px');
        assert.equal(c.top, '40px');
        assert.equal(c.width, '2000px');
        assert.equal(c.height, '1600px');
        assert.equal(c.borderRadius, '50%');
        assert.equal(c.pointerEvents, 'none');
    } finally {
        p.stop();
    }
});

test('hidden outside the world map, shown again on return', async () => {
    const parent = fakeDom();
    const state = fakeGame({ mode: 'city' });
    const p = new mod.AttackRange({});
    await quiet(() => p.start());
    try {
        assert.equal(parent.children.length, 0);
        state.mode = 'region';
        p._reposition();
        assert.equal(parent.children.length, 2);
    } finally {
        p.stop();
    }
});

test('off-screen circle is not shown; new and removed bases follow on update', async () => {
    const parent = fakeDom();
    const state = fakeGame({ bases: [{ id: 1, x: 10, y: 10 }, { id: 3, x: 500, y: 500 }] });
    const p = new mod.AttackRange({});
    await quiet(() => p.start());
    try {
        assert.equal(parent.children.length, 1);   // base 3 far outside the 4000x3000 view
        state.bases = [{ id: 1, x: 10, y: 10 }, { id: 4, x: 20, y: 20 }];
        p._update();
        assert.deepEqual([...p.circles.keys()].sort(), [1, 4]);
        assert.equal(parent.children.length, 2);
    } finally {
        p.stop();
    }
});

test('stop() removes every circle', async () => {
    const parent = fakeDom();
    fakeGame();
    const p = new mod.AttackRange({});
    await quiet(() => p.start());
    p.stop();
    assert.equal(parent.children.length, 0);
    assert.equal(p.circles.size, 0);
    assert.equal(p.running, false);
});
