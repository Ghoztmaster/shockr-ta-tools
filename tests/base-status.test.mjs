// BaseStatus (plugins/base-status.js): cooldown, protection, alerted, support, recall, focus.
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
        stdin: { contents: `export * from './plugins/base-status.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

const NOW = 1000;
/** Steps as minutes: GetTimespanString gives "mm:00" for the steps left, "00:00" when passed. */
function timespan(end, now) {
    const left = Math.max(0, end - now);
    return `${String(left).padStart(2, '0')}:00`;
}

function city(id, name, { cd = 0, lock = -1, prot = 0, alert = false, weapon = false, dedicated = 0, ghost = false } = {}) {
    const c = {
        calls: [], dedicated,
        IsOwnBase: () => true, get_IsGhostMode: () => ghost, get_Id: () => id, get_Name: () => name,
        get_MoveCooldownEndStep: () => cd, get_MoveRestictionEndStep: () => lock,
        get_ProtectionEndStep: () => prot, get_isAlerted: () => alert,
        get_SupportWeapon: () => (weapon ? { r: 10 } : null),
        get_SupportData: () => (weapon ? { get_Type: () => 5, get_Level: () => 24 } : null),
        get_SupportDedicatedBaseId: () => c.dedicated,
        get_SupportDedicatedBaseName: () => (c.dedicated ? `Target${c.dedicated}` : ''),
        RecallDedicatedSupport: () => { c.calls.push('recall'); c.dedicated = 0; },
    };
    return c;
}

const centred = [];
function setup(cities) {
    centred.length = 0;
    globalThis.ClientLib = {
        Base: { Tech: { GetTechNameFromTechId: () => 'tn', GetProductionBuildingNameFromFaction: () => 'Ion Cannon' } },
        Data: { MainData: { GetInstance: () => ({
            get_Cities: () => ({ get_AllCities: () => ({ d: Object.fromEntries(cities.map((c, i) => [i, c])) }) }),
            get_Player: () => ({ get_Faction: () => 1 }),
            get_Time: () => ({ GetServerStep: () => NOW, GetTimespanString: timespan }),
        }) } },
    };
    globalThis.webfrontend = { gui: {
        UtilView: { centerCityOnRegionViewWindow: (id) => centred.push(id) },
        chat: { ChatWidget: { sender: { system: 'system' } } },
    } };
    globalThis.qx = { core: { Init: { getApplication: () => ({ getChat: () => ({ getChatWidget: () => ({ showMessage() {} }) }) }) } } };
}

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));

test('readStatus: cooldown = max(move cooldown, lockdown), passed = empty, protection, alerted, support', () => {
    setup([
        city(1, 'A', { cd: 1044, lock: 1050, prot: 1010, alert: true, weapon: true, dedicated: 9 }),
        city(2, 'B', { cd: 900, prot: 0 }),
    ]);
    const [a, b] = mod.readStatus();
    assert.deepEqual(a, { id: 1, name: 'A', alerted: true, cooldown: '50:00', protection: '10:00', weapon: 'Ion Cannon (24)', on: 'Target9' });
    assert.deepEqual(b, { id: 2, name: 'B', alerted: false, cooldown: '', protection: '', weapon: null, on: null });
});

test('renderStatus: red alerted name, recall only when calibrated, recall-all, focus per base', () => {
    setup([]);
    const html = mod.renderStatus([
        { id: 1, name: 'A', alerted: true, cooldown: '50:00', protection: '', weapon: 'Ion Cannon (24)', on: 'Target9' },
        { id: 2, name: 'B', alerted: false, cooldown: '', protection: '', weapon: null, on: null },
        { id: 3, name: 'C', alerted: false, cooldown: '', protection: '', weapon: 'Ion Cannon (24)', on: null },
    ]);
    assert.match(html, /data-view="recallall"/);
    assert.match(html, /data-id="1" title="Alerted[^"]*" style="[^"]*color:#ff5252/);
    assert.match(html, /data-id="1" data-view="recall"/);
    assert.doesNotMatch(html, /data-id="[23]" data-view="recall"/);
    assert.match(html, /data-id="2" data-view="focus"/);
    assert.match(html, />none</);
    assert.match(html, /not calibrated/);
    assert.match(mod.renderStatus([]), /No base data yet/);
    assert.doesNotMatch(mod.renderStatus([{ id: 2, name: 'B', alerted: false, cooldown: '', protection: '', weapon: null, on: null }]), /recallall/);
});

test('focusBase: centres an own base, not a ghost or unknown one', () => {
    setup([city(1, 'A'), city(2, 'G', { ghost: true })]);
    assert.equal(mod.focusBase(1), true);
    assert.equal(mod.focusBase(2), false);
    assert.equal(mod.focusBase(7), false);
    assert.deepEqual(centred, [1]);
});

test('panel clicks: recall one, recall all, focus', () => {
    const a = city(1, 'A', { weapon: true, dedicated: 5 });
    const b = city(2, 'B', { weapon: true, dedicated: 6 });
    setup([a, b]);
    const p = new mod.BaseStatus(fakeConfig(), { register() {}, unregister() {} }, { register() {}, unregister() {} });
    p.panel.refresh = () => {};
    const l = console.log; console.log = () => {};
    p._onPanelClick(1, 'recall');
    assert.deepEqual([a.calls, b.calls], [['recall'], []]);
    p._onPanelClick(0, 'recallall');
    console.log = l;
    assert.deepEqual(b.calls, ['recall']);
    p._onPanelClick(2, 'focus');
    assert.deepEqual(centred, [2]);
    assert.equal(p.name, 'BaseStatus');
    assert.equal(p.statusText(), '2 base(s), 0 with cooldown, 0 alerted');
});
