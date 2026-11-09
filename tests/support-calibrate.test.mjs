// SupportCalibrate (plugins/support-calibrate.js): calibrate in range, recall, menu hook.
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
        stdin: { contents: `export * from './plugins/support-calibrate.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const REGION_CITY = 7;
const TYPE = { Own: 1, Alliance: 2, Enemy: 3 };

function city(id, name, { x = 100, y = 100, range = 10, dedicated = 0 } = {}) {
    const c = {
        id, calls: [], dedicated,
        IsOwnBase: () => true, get_IsGhostMode: () => false, get_Id: () => id, get_Name: () => name,
        get_X: () => x, get_Y: () => y,
        get_SupportWeapon: () => (range === null ? null : { r: range }),
        get_SupportDedicatedBaseId: () => c.dedicated,
        get_SupportDedicatedBaseName: () => (c.dedicated ? `Target${c.dedicated}` : ''),
        SetDedicatedSupport: (tid) => { c.calls.push(['set', tid]); c.dedicated = tid; },
        RecallDedicatedSupport: () => { c.calls.push(['recall']); c.dedicated = 0; },
        get_SupportData: () => (range === null ? null : { get_Type: () => 5, get_Level: () => 24 }),
    };
    return c;
}

const chat = [];
function setup(cities) {
    chat.length = 0;
    globalThis.ClientLib = {
        Base: { Tech: { GetTechNameFromTechId: () => 'tn', GetProductionBuildingNameFromFaction: () => 'Ion Cannon' } },
        Vis: {
            VisObject: { EObjectType: { RegionCityType: REGION_CITY } },
            Region: { RegionCity: { ERegionCityType: TYPE } },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
            get_Player: () => ({ get_Faction: () => 1 }),
        }) } },
    };
    globalThis.qx = {
        core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ showMessage: (m) => chat.push(m) }) }) }) } },
        ui: { form: { Button: class {
            constructor(label) { this.label = label; this.visibility = 'visible'; this.listeners = {}; }
            addListener(ev, fn) { this.listeners[ev] = fn; }
            setLabel(l) { this.label = l; }
            setVisibility(v) { this.visibility = v; }
            getLayoutParent() { return this.parent; }
            dispose() { this.disposed = true; }
        } } },
    };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
}

function vis(id, type, x, y) {
    return { get_VisObjectType: () => REGION_CITY, get_Type: () => type, get_Id: () => id, get_RawX: () => x, get_RawY: () => y, get_Name: () => `T${id}` };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}
const stub = () => ({ register() {}, unregister() {} });

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

test('calibrateAll: in range (r²), skips already-calibrated, out of range and bases without a weapon', () => {
    const near = city(1, 'Near', { x: 106, y: 108, range: 10 });      // 36 + 64 = 100 <= 100
    const far = city(2, 'Far', { x: 120, y: 100, range: 10 });
    const on = city(3, 'On', { dedicated: 99 });
    const none = city(4, 'None', { range: null });
    setup([near, far, on, none]);
    const restore = quiet();
    const res = mod.calibrateAll({ id: 99, x: 100, y: 100 });
    restore();
    assert.deepEqual(res, { calibrated: ['Near'], already: ['On'], outOfRange: ['Far'] });
    assert.deepEqual(near.calls, [['set', 99]]);
    assert.deepEqual(on.calls, []);
    assert.deepEqual(far.calls, []);
});

test('recallAll / recallCity: only calibrated bases', () => {
    const a = city(1, 'A', { dedicated: 5 });
    const b = city(2, 'B');
    setup([a, b]);
    const restore = quiet();
    assert.deepEqual(mod.recallAll(), ['A']);
    restore();
    assert.deepEqual(a.calls, [['recall']]);
    assert.deepEqual(b.calls, []);
    assert.equal(mod.recallCity(b), false);
});

test('isSupportTarget: own and alliance bases only', () => {
    setup([]);
    assert.equal(mod.isSupportTarget(vis(1, TYPE.Own, 0, 0)), true);
    assert.equal(mod.isSupportTarget(vis(1, TYPE.Alliance, 0, 0)), true);
    assert.equal(mod.isSupportTarget(vis(1, TYPE.Enemy, 0, 0)), false);
    assert.equal(mod.isSupportTarget({ get_VisObjectType: () => 1 }), false);
    assert.equal(mod.isSupportTarget(null), false);
});

test('menu hook: button added once to the Composite, hidden for enemies, calibrates; stop restores', async () => {
    const near = city(1, 'Near');
    setup([near]);
    globalThis.document = { addEventListener() {}, removeEventListener() {} };   // panel.destroy() on stop
    const shown = [];
    class RegionCityMenu { showMenu(v) { shown.push(v); } }
    const original = RegionCityMenu.prototype.showMenu;
    webfrontend.gui.region = { RegionCityMenu };
    const plugin = new mod.SupportCalibrate(fakeConfig(), stub(), stub());
    await plugin.start();
    const menu = new RegionCityMenu();
    const added = [];
    menu.box = { basename: 'Composite', add: (b) => { b.parent = { remove() {} }; added.push(b); } };
    menu.showMenu(vis(50, TYPE.Own, 100, 100));
    menu.showMenu(vis(51, TYPE.Enemy, 100, 100));
    assert.equal(added.length, 1);
    assert.equal(added[0].visibility, 'excluded');
    assert.equal(shown.length, 2);                          // original still called
    menu.showMenu(vis(50, TYPE.Alliance, 100, 100));
    assert.equal(added[0].visibility, 'visible');
    const restore = quiet();
    added[0].listeners.execute();
    restore();
    assert.deepEqual(near.calls, [['set', 50]]);
    assert.match(chat.at(-1), /Support calibrated on T50: 1 weapon/);
    plugin.stop();
    assert.equal(RegionCityMenu.prototype.showMenu, original);
    assert.equal(added[0].disposed, true);
    assert.equal(menu.__stSupportButtons, undefined);
});

test('renderSupport: recall buttons only for calibrated bases, recall-all when any', () => {
    setup([city(1, 'A', { dedicated: 9 }), city(2, 'B')]);
    const html = mod.renderSupport(mod.readSupport());
    assert.match(html, /data-view="recallall"/);
    assert.match(html, /data-id="1" data-view="recall"/);
    assert.doesNotMatch(html, /data-id="2" data-view="recall"/);
    assert.match(html, /Ion Cannon \(24\)/);
    assert.match(html, /Target9/);
    assert.match(mod.renderSupport([]), /No base with a support weapon/);
});
