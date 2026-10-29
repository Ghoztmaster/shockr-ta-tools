// TunnelPoiAnalyzer (plugins/tunnel-poi-analyzer.js): tunnel activation, blockers, worthless POIs.
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
        stdin: { contents: `export * from './plugins/tunnel-poi-analyzer.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const mod = await load();
const base = (playerId, x, y, level = 30, name = `P${playerId}`) => ({ playerId, x, y, level, name });
const opts = { players: 5, range: 5, guardRange: 5 };

test('inRange: Euclidean, the edge counts', () => {
    assert.equal(mod.inRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), true);
    assert.equal(mod.inRange({ x: 0, y: 0 }, { x: 4, y: 4 }, 5), false);
});

test('analyzeTunnel: active at 5 different players, two bases of one player count once', () => {
    const tn = { x: 100, y: 100 };
    const bases = [base(1, 101, 100), base(1, 99, 100), base(2, 100, 103), base(3, 104, 100), base(4, 100, 96)];
    let a = mod.analyzeTunnel(tn, bases, { players: 5, range: 5, required: 20 });
    assert.equal(a.count, 4);
    assert.equal(a.needed, 1);
    assert.equal(a.active, false);
    assert.deepEqual(a.players, ['P1', 'P2', 'P3', 'P4']);

    a = mod.analyzeTunnel(tn, [...bases, base(5, 102, 102), base(6, 120, 120)], { players: 5, range: 5, required: 20 });
    assert.equal(a.count, 5);
    assert.equal(a.needed, 0);
    assert.equal(a.active, true);
});

test('analyzeTunnel: blocker = more than blockmargin (default 5) below the required level; unknown level is not', () => {
    const tn = { x: 0, y: 0 };
    const bases = [base(1, 1, 0, 25), base(2, 0, 1, 12), base(3, 2, 2, 40), base(4, 1, 1, NaN), base(5, 30, 0, 5), base(6, 2, 0, 24.9)];
    let a = mod.analyzeTunnel(tn, bases, { players: 5, range: 5, required: 30 });
    assert.equal(a.threshold, 25);
    assert.deepEqual(a.blockers.map(b => b.playerId), [2, 6]);   // 25 itself is not below 25
    assert.equal(a.count, 5);   // blockers still count as players
    a = mod.analyzeTunnel(tn, bases, { players: 5, range: 5, required: 30, margin: 0 });
    assert.deepEqual(a.blockers.map(b => b.playerId), [2, 6, 1]);
});

test('poiStatus: 0 (rounded) is worthless, > 0 valuable, missing unknown', () => {
    assert.equal(mod.poiStatus(0), 'worthless');
    assert.equal(mod.poiStatus(0.04), 'worthless');
    assert.equal(mod.poiStatus(1200), 'valuable');
    assert.equal(mod.poiStatus(undefined), 'unknown');
    assert.equal(mod.poiStatus(null), 'unknown');
});

test('poiTypeFromOwned: get_OwnedPOIs `t` is the EPOIType itself (seen live)', () => {
    globalThis.ClientLib = { Base: { EPOIType: { TiberiumBonus: 2, PowerBonus: 4, DefenseBonus: 8 } } };
    assert.equal(mod.poiTypeFromOwned(4), 4);
    assert.equal(mod.poiTypeFromOwned(8), 8);
    assert.equal(mod.poiTypeFromOwned(0), null);
    assert.equal(mod.poiTypeFromOwned(undefined), null);
});

test('cfgInt: in range or the default', () => {
    assert.equal(mod.cfgInt('7', 5, 1, 50), 7);
    assert.equal(mod.cfgInt(undefined, 5, 1, 50), 5);
    assert.equal(mod.cfgInt('abc', 5, 1, 50), 5);
    assert.equal(mod.cfgInt(0, 5, 1, 50), 5);
});

test('buildRows: a POI guard that blocks a tunnel is flagged; tunnels first, inactive first, worthless POIs first', () => {
    const tunnels = [{ x: 10, y: 10, level: 40 }, { x: 50, y: 50, level: 30 }];
    const bases = [
        base(1, 11, 10, 20, 'Low'),                                          // blocker of tunnel 1 (req 40 - 2 = 38)
        ...[2, 3, 4, 5, 6].map(id => base(id, 50 + (id % 3), 50, 45)),      // tunnel 2 active
    ];
    const pois = [
        { x: 60, y: 60, level: 20, key: 'tib', loss: 5000 },
        { x: 12, y: 11, level: 12, key: 'cry', loss: 0 },
        { x: 90, y: 90, level: 12, key: 'pow', loss: undefined },
    ];
    const rows = mod.buildRows({ tunnels, pois, bases, opts, diff: 2, inView: (x) => x < 80 });
    assert.deepEqual(rows.map(r => `${r.kind}:${r.x}`), ['tunnel:10', 'tunnel:50', 'poi:12', 'poi:90', 'poi:60']);
    assert.equal(rows[0].status, 'inactive');
    assert.equal(rows[0].required, 38);
    assert.deepEqual(rows[0].blockers.map(b => b.name), ['Low']);
    assert.equal(rows[1].status, 'active');
    const worthless = rows[2];
    assert.equal(worthless.status, 'worthless');
    assert.deepEqual(worthless.guards.map(g => [g.name, g.blocksTunnel]), [['Low', true]]);
    assert.equal(rows[3].stale, true);
    assert.equal(rows[4].status, 'valuable');
});

test('rowTexts: advice per row kind', () => {
    const rows = mod.buildRows({
        tunnels: [{ x: 0, y: 0, level: 30 }],
        pois: [{ x: 1, y: 1, level: 10, key: 'tib', loss: 0 }],
        bases: [base(1, 1, 0, 10, 'Tiny')],
        opts, diff: 0, inView: () => true,
    });
    const tn = mod.rowTexts(rows[0], opts);
    assert.equal(tn.advice.length, 2);
    assert.match(tn.advice[0], /4/);           // 4 more players needed
    assert.match(tn.advice[1], /Tiny \(L10 1:0\)/);
    const poi = mod.rowTexts(rows[1], opts);
    assert.match(poi.advice[0], /Tiny/);
    assert.deepEqual(poi.players, ['Tiny ⚠']);
});

test('renderTable: escapes names, one clickable row per tunnel/POI, section headers', () => {
    const rows = mod.buildRows({
        tunnels: [{ x: 3, y: 4, level: 30 }],
        pois: [],
        bases: [base(1, 3, 5, 40, '<b>x</b>')],
        opts, diff: 0, inView: () => true,
    });
    const html = mod.renderTable(rows, opts);
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
    assert.equal((html.match(/<tr data-x=/g) || []).length, 1);
    assert.ok(html.includes('data-x="3" data-y="4"'));
    assert.match(mod.renderTable([], opts), /No tunnels/);
});

// ─── Live scan with a mocked client ──────────────────────────────────

function el(tag) {
    const node = {
        tag, style: {}, children: [], parent: null, dataset: {}, _html: '',
        addEventListener() {}, removeEventListener() {},
        appendChild(c) { c.parent = node; node.children.push(c); return c; },
        append(...cs) { for (const c of cs) node.appendChild(c); },
        remove() { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = null; },
        contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
        set innerHTML(v) { node._html = v; },
        get innerHTML() { return node._html; },
        querySelectorAll() { return []; },
    };
    return node;
}

function setupClient() {
    const OWN = 77;
    const VIS = { RegionPointOfInterest: 10, RegionCityType: 11 };
    const world = new Map();
    const vis = new Map();
    // as seen live: the world object's patched $AllianceId / $PlayerId are NOT the ids
    // (here deliberately wrong), the vis object's getters are; no get_BaseLevelFloat
    const NAMES = { 1: 'Alpha', 4: 'Lowbie' };
    const city = (x, y, playerId, level, allianceId = OWN) => {
        world.set(`${x}:${y}`, { Type: 1, $PlayerId: 3, $AllianceId: playerId + 400 });
        vis.set(`${x}:${y}`, {
            get_VisObjectType: () => VIS.RegionCityType, get_AllianceId: () => allianceId, get_PlayerId: () => playerId,
            get_BaseLevel: () => level, get_PlayerName: () => NAMES[playerId] || '',
        });
    };
    // tunnel at 10:10, level 30, required 28; five alliance players around it, one low
    vis.set('10:10', { get_VisObjectType: () => VIS.RegionPointOfInterest, get_Type: () => 0, get_RawX: () => 10, get_RawY: () => 10, get_Level: () => 30 });
    city(11, 10, 1, 35); city(9, 10, 2, 35); city(10, 12, 3, 35); city(12, 12, 4, 15); city(10, 7, 5, 35);
    city(10, 9, 99, 10, 5);   // another alliance: ignored
    // own POI (worthless: score 0) next to the low base, and one worth something
    const poi = (x, y, level) => {
        world.set(`${x}:${y}`, { Type: 4 });
        vis.set(`${x}:${y}`, {
            get_VisObjectType: () => VIS.RegionPointOfInterest, get_Type: () => 2, get_Level: () => level,
            get_OwnerAllianceId: () => OWN, get_OwnerAllianceName: () => 'SoO',
        });
    };
    poi(13, 13, 12);
    poi(15, 3, 20);
    const md = {
        get_World: () => ({ GetObjectFromPosition: (x, y) => world.get(`${x}:${y}`) || null }),
        get_Alliance: () => ({
            get_Id: () => OWN, get_Name: () => 'SoO', get_Exists: () => true,
            get_MemberData: () => ({ d: { 2: { Name: 'map2' }, 3: { Name: 'map3' }, 5: { Name: 'map5' } } }),
            get_OwnedPOIs: () => [{ x: 13, y: 13, l: 12, t: 1 }, { x: 15, y: 3, l: 20, t: 1 }, { x: 200, y: 200, l: 9, t: 1 }],
            get_POIRankScore: () => [{ r: 1, s: 1000, ns: 0, ps: 0 }],
        }),
        get_Server: () => ({ get_POIActivationLevelDifference: () => 2, get_POIGlobalBonusFactor: () => 1 }),
    };
    globalThis.ClientLib = {
        Data: { MainData: { GetInstance: () => md }, WorldSector: { ObjectType: { City: 1, PointOfInterest: 4 } } },
        Vis: {
            Mode: { Region: 1 },
            VisObject: { EObjectType: VIS },
            VisMain: { GetInstance: () => ({
                get_Mode: () => 1,
                get_Region: () => ({
                    get_GridWidth: () => 1, get_GridHeight: () => 1, get_ZoomFactor: () => 1,
                    get_PosX: () => 0, get_PosY: () => 0, get_ViewWidth: () => 30, get_ViewHeight: () => 30,
                    GetObjectFromPosition: (x, y) => vis.get(`${x}:${y}`) || null,
                }),
            }) },
        },
        Base: {
            EPOIType: { RankedTypeBegin: 1, TiberiumBonus: 1, CrystalBonus: 2 },
            PointOfInterestTypes: {
                GetPOITypeFromWorldPOIType: (t) => t - 1,                  // world type 2 -> TiberiumBonus
                GetScoreByLevel: (l) => (l < 15 ? 0 : 100),                // level 12 -> score 0 -> loss 0
                GetTotalBonusByType: (type, rank, score) => score * 10,
            },
        },
    };
    globalThis.document = { body: el('body'), createElement: el, addEventListener() {}, removeEventListener() {} };
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
}

test('panel: scans the map, tunnel active with names, low base flagged, worthless POI with movable base', () => {
    setupClient();
    const store = {};
    const config = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } };
    const toolbar = { register() {}, unregister() {} };
    const cli = { register() {}, unregister() {} };
    const p = new mod.TunnelPoiAnalyzer(config, toolbar, cli);
    p.running = true;
    p.open();
    try {
        const tunnel = p._rows.find(r => r.kind === 'tunnel');
        assert.equal(tunnel.active, true);
        assert.equal(tunnel.required, 28);
        assert.deepEqual(tunnel.players, ['Alpha', 'Lowbie', 'map2', 'map3', 'map5']);
        assert.deepEqual(tunnel.blockers.map(b => b.name), ['Lowbie']);

        const pois = p._rows.filter(r => r.kind === 'poi');
        assert.deepEqual(pois.map(r => [r.x, r.status]), [[13, 'worthless'], [200, 'worthless'], [15, 'valuable']]);
        assert.equal(pois[1].stale, true);   // off-screen own POI from get_OwnedPOIs
        assert.deepEqual(pois[0].guards.map(g => [g.name, g.blocksTunnel]),
            [['Alpha', false], ['Lowbie', true], ['map2', false], ['map3', false]]);
        assert.match(p._content.innerHTML, /Lowbie/);

        // config: 6 players needed -> inactive, 1 missing
        store['tpa.players'] = 6;
        p._refresh();
        const t2 = p._rows.find(r => r.kind === 'tunnel');
        assert.equal(t2.active, false);
        assert.equal(t2.needed, 1);
    } finally {
        p.close();
    }
});
