// POI Analyser (plugins/poi-analyser.js) + Sector HUD (plugins/sector-hud.js) + lib/poi-util.js.
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
            contents: `export * as util from './lib/poi-util.js';
                       export { PoiAnalyser, labelText, ownerKind, bonusLines, COLORS } from './plugins/poi-analyser.js';
                       export { SectorHud, ownReserveMarker, viewCenter, parseCoords, insertAt, STATUS_COLORS } from './plugins/sector-hud.js';`,
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
const { util } = mod;

// ─── Fakes ───────────────────────────────────────────────────────────

const EPOI = { TiberiumBonus: 2, CrystalBonus: 3, PowerBonus: 4, InfanteryBonus: 5, VehicleBonus: 6, AirBonus: 7, DefenseBonus: 8, RankedTypeBegin: 2 };
const OWN = 100;

function fakeElement(tag) {
    const el = { tag, style: {}, attrs: {}, children: [], parentElement: null, title: '', listeners: {} };
    let text = '';
    Object.defineProperty(el, 'textContent', {
        get: () => text + el.children.map(c => c.textContent).join(''),
        set: (v) => { text = v; el.children = []; },
    });
    el.appendChild = (c) => { el.children.push(c); c.parentElement = el; };
    el.append = (...cs) => cs.forEach(c => el.appendChild(c));
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.addEventListener = (n, fn) => { el.listeners[n] = fn; };
    el.remove = () => {
        if (el.parentElement) {
            const c = el.parentElement.children;
            c.splice(c.indexOf(el), 1);
            el.parentElement = null;
        }
    };
    return el;
}

function fakeDom() {
    const mapParent = fakeElement('map');
    const body = fakeElement('body');
    globalThis.document = {
        body,
        querySelector: (sel) => (sel === 'canvas' ? { parentElement: mapParent } : null),
        createElement: fakeElement,
    };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    return { mapParent, body };
}

/** state.pois: {"x:y": {type, level, owner, ownerName}} (type = EPOIType value). */
function fakeGame(state) {
    const visObj = (p) => ({
        get_VisObjectType: () => 'poi',
        get_Type: () => p.type, get_Level: () => p.level,
        get_OwnerAllianceId: () => p.owner || 0, get_OwnerAllianceName: () => p.ownerName || '',
    });
    // One Alliance object (as the client keeps); state.allianceObj = makeAlliance() swaps it.
    state.makeAlliance = () => {
        return {
            get_Exists: () => state.alliance !== false,
            get_Id: () => (state.alliance === false ? 0 : OWN), get_Name: () => 'SoO',
            get_OwnedPOIs: () => state.owned || [],
            get_Markers: () => ({ l: state.markers || [] }),
            get_POIRankScore: () => [{ r: 3, s: 500 }, { r: 1, s: 900 }],
            get_POITiberiumBonus: () => 12300, get_POICrystalBonus: () => 0, get_POIPowerBonus: () => 0,
            get_POIInfantryBonus: () => 10, get_POIVehicleBonus: () => 0, get_POIAirBonus: () => 0, get_POIDefenseBonus: () => 0,
        };
    };
    state.allianceObj = state.makeAlliance();
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    globalThis.qx = undefined;
    globalThis.ClientLib = {
        Base: {
            EPOIType: EPOI,
            PointOfInterestTypes: {
                GetPOITypeFromWorldPOIType: (t) => t,
                GetScoreByLevel: (l) => l * 10,
            },
        },
        Vis: {
            Mode: { Region: 'region', City: 'city' },
            VisObject: { EObjectType: { RegionPointOfInterest: 'poi' } },
            VisMain: { GetInstance: () => ({
                get_Mode: () => state.mode,
                get_Region: () => ({
                    get_GridWidth: () => 10, get_GridHeight: () => 10, get_ZoomFactor: () => 1,
                    get_PosX: () => state.posX || 0, get_PosY: () => state.posY || 0,
                    get_ViewWidth: () => 100, get_ViewHeight: () => 100,
                    GetObjectFromPosition: (px, py) => {
                        const p = state.pois[`${px / 10}:${py / 10}`];
                        return p ? visObj(p) : null;
                    },
                }),
                ScreenPosFromWorldPosX: (px) => px,
                ScreenPosFromWorldPosY: (py) => py,
            }) },
        },
        Data: {
            WorldSector: { ObjectType: { PointOfInterest: 4 }, WorldObjectPointOfInterest: { EPOIType: { TunnelExit: 99 } } },
            MainData: { GetInstance: () => ({
                get_Player: () => ({ id: 1, name: 'GhoztMasters', get_Name: () => 'GhoztMasters' }),
                get_Server: () => ({ get_WorldWidth: () => 1000, get_WorldHeight: () => 1000, get_SectorCount: () => 8 }),
                get_World: () => ({ GetObjectFromPosition: (x, y) => (state.pois[`${x}:${y}`] ? { Type: 4 } : null) }),
                get_Alliance: () => state.allianceObj,
            }) },
        },
    };
}

const flush = () => new Promise(r => setTimeout(r, 0));

// ─── Pure logic ──────────────────────────────────────────────────────

test('sectorNo: WarChiefs formula, compass sectors around the world centre', () => {
    assert.equal(util.sectorNo(500, 900, 1000, 1000, 8), 0);   // south
    assert.equal(util.sectorNo(100, 500, 1000, 1000, 8), 2);   // west
    assert.equal(util.sectorNo(500, 100, 1000, 1000, 8), 4);   // north
    assert.equal(util.sectorNo(900, 500, 1000, 1000, 8), 6);   // east
    assert.equal(util.sectorNo(800, 200, 1000, 1000, 8), 5);   // north-east
});

test('sectorSummary: own green when own >= enemy, enemy red, none grey', () => {
    const geo = { width: 1000, height: 1000, count: 8 };
    const s = util.sectorSummary([
        { x: 500, y: 100, ownerId: OWN }, { x: 510, y: 100, ownerId: 7 },      // north: 1 own, 1 enemy → own
        { x: 900, y: 500, ownerId: 7 }, { x: 910, y: 500, ownerId: 0 },        // east: enemy
        { x: 500, y: 900, ownerId: 0 },                                          // south: only free → none
    ], OWN, geo);
    assert.deepEqual([s[4].own, s[4].enemy, s[4].status], [1, 1, 'own']);
    assert.deepEqual([s[6].enemy, s[6].free, s[6].status], [1, 1, 'enemy']);
    assert.deepEqual([s[0].free, s[0].status], [1, 'none']);
    assert.equal(s.length, 8);
});

test('realPoiDelta: TA Real POI Bonus direct cases', () => {
    const total = (rank, score) => score / 10 * (rank === 1 ? 2 : 1);
    // Loss without a rank change (no previous alliance)
    assert.deepEqual(util.realPoiDelta({ own: true, poiScore: 100, rank: 2, score: 500, prevScore: 0 }, total), { kind: 'loss', value: 10 });
    // Loss that drops below the previous alliance: needs rankings
    assert.equal(util.realPoiDelta({ own: true, poiScore: 100, rank: 2, score: 500, prevScore: 450 }, total).value, null);
    // Gain at rank 1
    assert.deepEqual(util.realPoiDelta({ own: false, poiScore: 100, rank: 1, score: 500, nextScore: 0 }, total), { kind: 'gain', value: 20 });
    // Gain from another alliance's POI below rank 1: needs rankings
    assert.equal(util.realPoiDelta({ own: false, ownerIsAlliance: true, poiScore: 100, rank: 3, score: 500, nextScore: 800 }, total).value, null);
    // Free POI, stays below the next alliance
    assert.equal(util.realPoiDelta({ own: false, ownerIsAlliance: false, poiScore: 100, rank: 3, score: 500, nextScore: 800 }, total).value, 10);
    // Zero score: needs rankings
    assert.equal(util.realPoiDelta({ own: false, poiScore: 100, rank: 9, score: 0, nextScore: 50 }, total).value, null);
});

test('rankedPoiDelta: overtaking an alliance changes the rank', () => {
    const total = (rank, score) => score + (rank === 1 ? 1000 : 0);
    // We have 500 at rank 2, the leader 550; taking their 100-POI: they 450, we 600 → rank 1
    const d = util.rankedPoiDelta({ own: false, poiOwnerId: 7, poiScore: 100, rank: 2, score: 500 }, [{ a: 7, pois: 550 }], total);
    assert.deepEqual(d, { kind: 'gain', value: (600 + 1000) - 500 });
});

test('labels, owner colours and panel lines', () => {
    fakeGame({ mode: 'region', pois: {} });
    assert.equal(mod.labelText({ key: 'tib', level: 32.7 }), 'Tib 32');
    assert.equal(mod.ownerKind(OWN, OWN), 'own');
    assert.equal(mod.ownerKind(7, OWN), 'enemy');
    assert.equal(mod.ownerKind(0, OWN), 'free');
    const lines = mod.bonusLines(util.allianceBonuses());
    assert.deepEqual(lines, ['Tiberium +12.3k/h (rank 3)', 'Infantry +10%']);
    assert.deepEqual(mod.bonusLines(null), []);
});

// ─── POI Analyser on the map ────────────────────────────────────────

test('PoiAnalyser: label per POI in view (gold own, red enemy, grey free), none elsewhere, gone on disable', async () => {
    const { mapParent } = fakeDom();
    const state = {
        mode: 'region',
        pois: {
            '2:2': { type: EPOI.TiberiumBonus, level: 32, owner: OWN, ownerName: 'SoO' },
            '3:3': { type: EPOI.AirBonus, level: 20, owner: 7, ownerName: 'Enemy' },
            '4:4': { type: EPOI.CrystalBonus, level: 12, owner: 0 },
            '5:5': { type: 99, level: 10, owner: 0 },          // tunnel exit: no label
        },
    };
    fakeGame(state);
    const p = new mod.PoiAnalyser({ get: (k, d) => d });
    try {
        await p.start();
        const byText = Object.fromEntries(mapParent.children.map(el => [el.textContent, el.style.color]));
        assert.deepEqual(byText, { 'Tib 32': mod.COLORS.own, 'Air 20': mod.COLORS.enemy, 'Cry 12': mod.COLORS.free });
        assert.match(mapParent.children.find(el => el.textContent === 'Tib 32').title, /score 320 · SoO/);

        state.mode = 'city';
        p.update();
        assert.equal(mapParent.children.length, 0, 'off the world map: no labels');
        state.mode = 'region';
        p.update();
        assert.equal(mapParent.children.length, 3);
    } finally {
        p.stop();
    }
    assert.equal(mapParent.children.length, 0, 'disable removes the labels');
});

// ─── Sector HUD ──────────────────────────────────────────────────────

test('viewCenter + parseCoords', () => {
    const region = { get_ZoomFactor: () => 1, get_PosX: () => 4000, get_PosY: () => 1000, get_ViewWidth: () => 100, get_ViewHeight: () => 100,
        get_GridWidth: () => 10, get_GridHeight: () => 10 };
    assert.deepEqual(mod.viewCenter(region), { x: 405, y: 105 });   // centre px 4050 → cell 405 (cell x = px x*10 .. x*10+10)
    assert.deepEqual(mod.parseCoords('[coords]450:620[/coords]'), { x: 450, y: 620 });
    assert.deepEqual(mod.parseCoords('12 34'), { x: 12, y: 34 });
    assert.equal(mod.parseCoords('nope'), null);
    assert.deepEqual(mod.parseCoords('450:620'), { x: 450, y: 620 });
    assert.equal(mod.parseCoords('450'), null);
});

test('insertAt: coords tag over the selection, a space only where it would touch a word', () => {
    assert.equal(mod.insertAt('', 0, 0, '[c]'), '[c]');
    assert.equal(mod.insertAt('go ', 3, 3, '[c]'), 'go [c]');
    assert.equal(mod.insertAt('go', 2, 2, '[c]'), 'go [c]');
    assert.equal(mod.insertAt('go here now', 3, 7, '[c]'), 'go [c] now');
});

test('SectorHud: coords + sector + POI counts; own sector green, enemy red; hidden off-map; gone on disable', async () => {
    const { body } = fakeDom();
    const state = {
        mode: 'region', posX: 4950, posY: 950,                  // view centre ≈ 500:100 → north
        pois: {
            '500:100': { type: EPOI.TiberiumBonus, level: 20, owner: 7 },   // north, enemy (seen)
            '502:100': { type: EPOI.TiberiumBonus, level: 20, owner: 0 },   // north, free (seen)
        },
        owned: [{ x: 900, y: 500, l: 30, t: 2 }],                // east, own (complete list, off-screen)
    };
    fakeGame(state);
    const p = new mod.SectorHud({ get: (k, d) => d });
    try {
        await p.start();
        assert.equal(body.children.length, 1);
        const el = body.children[0];
        assert.match(el.textContent, /^500:100 \[N\] · POI 0 own · 1 enemy · 1 free/);
        const chips = el.children[1].children;
        assert.equal(chips.length, 8);
        assert.equal(chips[4].textContent, 'N 0');
        assert.equal(chips[4].style.color, mod.STATUS_COLORS.enemy, 'north: enemy holds a POI');
        assert.equal(chips[6].textContent, 'E 1');
        assert.equal(chips[6].style.color, mod.STATUS_COLORS.own, 'east: own POI');
        assert.equal(chips[0].style.color, mod.STATUS_COLORS.none, 'south: nothing held');
        assert.match(el.title, /seen on the map this session/);

        state.mode = 'city';
        p.tick();
        assert.equal(el.style.display, 'none');
    } finally {
        p.stop();
    }
    assert.equal(body.children.length, 0, 'disable removes the HUD');
});

const marker = (type, by, x, y) => ({ get_Type: () => type, get_NamePlayerCreated: () => by, get_CoordX: () => x, get_CoordY: () => y });

test('ownReserveMarker: type 5 placed by the own player, else null', () => {
    const ms = [marker(5, 'Other', 1, 1), marker(3, 'GhoztMasters', 2, 2), marker(5, 'GhoztMasters', 116, 318)];
    assert.deepEqual(mod.ownReserveMarker(ms, 'GhoztMasters'), { x: 116, y: 318 });
    assert.equal(mod.ownReserveMarker(ms.slice(0, 2), 'GhoztMasters'), null);
    assert.equal(mod.ownReserveMarker(ms, ''), null);
    assert.equal(mod.ownReserveMarker(undefined, 'GhoztMasters'), null);
});

test('ownReserveMarker: a marker whose getters throw is skipped', () => {
    const broken = { get_Type: () => { throw new Error('deleted'); } };
    const noCoords = { ...marker(5, 'GhoztMasters', 0, 0), get_CoordX: () => { throw new Error('deleted'); } };
    assert.equal(mod.ownReserveMarker([broken, noCoords], 'GhoztMasters'), null, 'none valid: view centre');
    assert.deepEqual(mod.ownReserveMarker([broken, noCoords, marker(5, 'GhoztMasters', 116, 318)], 'GhoztMasters'), { x: 116, y: 318 });
});

test('SectorHud: the tick follows the own reservation marker (placed, moved, broken, removed) and an Alliance swap', async () => {
    const { body } = fakeDom();
    const state = { mode: 'region', posX: 4950, posY: 950, pois: {}, markers: [marker(5, 'Other', 10, 10)] };
    fakeGame(state);
    const p = new mod.SectorHud({ get: (k, d) => d });
    try {
        await p.start();
        const el = body.children[0];
        assert.match(el.textContent, /^500:100 \[N\]/, 'no own marker: view centre');

        state.markers.push(marker(5, 'GhoztMasters', 900, 500));    // placed
        p.tick();
        assert.match(el.textContent, /^📌 900:500 \[E\]/);
        assert.match(el.title, /reservation marker/);

        state.markers[1] = marker(5, 'GhoztMasters', 500, 900);     // moved
        p.tick();
        assert.match(el.textContent, /^📌 500:900 \[S\]/);

        state.markers[1] = { get_Type: () => { throw new Error('deleted'); } };   // half-deleted object
        p.tick();
        assert.match(el.textContent, /^500:100 \[N\]/, 'broken marker skipped: view centre');

        state.markers.pop();                                         // removed
        p.tick();
        assert.match(el.textContent, /^500:100 \[N\]/);

        state.allianceObj = state.makeAlliance();                   // client swapped the Alliance object
        state.markers = [marker(5, 'GhoztMasters', 100, 500)];
        p.tick();
        assert.match(el.textContent, /^📌 100:500 \[W\]/);
    } finally {
        p.stop();
    }
});
