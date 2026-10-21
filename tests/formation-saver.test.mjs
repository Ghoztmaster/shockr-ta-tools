// Formation Saver (plugins/formation-saver.js). Run: npm test
import { test, beforeEach } from 'node:test';
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
            contents: `export * from './plugins/formation-saver.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stub-main',
            setup(b) {
                b.onResolve({ filter: /lib\/main\.js$/ }, () => ({ path: 'main', namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    contents: 'export function chatMessage(m) { (globalThis.__chat ||= []).push(m); }',
                }));
            },
        }],
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

function fakeStorage() {
    const store = {};
    globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    };
    return store;
}

/** Army unit; MoveBattleUnit swaps with whoever sits on the target cell (as the client does). */
function makeArmy(specs) {
    const units = [];
    specs.forEach(([type, level, x, y], i) => {
        const u = {
            id: 100 + i, type, level, x, y, enabled: true,
            get_Id() { return this.id; },
            get_MdbUnitId() { return this.type; },
            get_CurrentLevel() { return this.level; },
            get_UnitGameData_Obj() { return { dn: `Unit${this.type}` }; },
            get_CoordX() { return this.x; },
            get_CoordY() { return this.y; },
            get_Enabled() { return this.enabled; },
            set_Enabled(e) { this.enabled = e; },
            MoveBattleUnit(nx, ny) {
                const other = units.find(o => o !== this && o.x === nx && o.y === ny);
                if (other) { other.x = this.x; other.y = this.y; }
                this.x = nx; this.y = ny;
            },
        };
        units.push(u);
    });
    return units;
}

function setGame({ mode = 'CombatSetup', world = 455, army = [], target = 9001 } = {}) {
    const formation = { get_ArmyUnits: () => ({ l: army }) };
    globalThis.ClientLib = {
        Vis: {
            Mode: { City: 1, Region: 2, CombatSetup: 3 },
            VisMain: { GetInstance: () => ({ get_Mode: () => globalThis.ClientLib.Vis.Mode[mode] }) },
        },
        Data: { MainData: { GetInstance: () => ({
            get_Server: () => ({ get_WorldId: () => world }),
            get_Cities: () => ({
                get_CurrentForeignCityId: () => target,
                get_CurrentOwnCity: () => ({
                    get_Id: () => 1,
                    get_Name: () => 'Base 1',
                    get_CityArmyFormationsManager: () => ({ GetFormationByTargetBaseId: () => formation }),
                }),
            }),
        }) } },
    };
    return army;
}

function plugin() {
    const commands = {};
    const p = new mod.FormationSaver({}, { register: (n, fn) => { commands[n] = fn; }, unregister: (n) => { delete commands[n]; } });
    p.start();
    return { p, commands, run: (...args) => commands.formation(args) };
}

beforeEach(() => {
    fakeStorage();
    globalThis.__chat = [];
    console.log = () => {};
});

test('save / list / delete roundtrip, names case-insensitive', () => {
    setGame({ army: makeArmy([[1, 10, 0, 0], [2, 12, 4, 1]]) });
    const { run } = plugin();
    run('save', 'Camp', 'left');
    const store = JSON.parse(localStorage.getItem('st-formations'));
    assert.equal(store['455'].length, 1);
    assert.equal(store['455'][0].name, 'Camp left');
    assert.deepEqual(store['455'][0].units.map(u => [u.type, u.x, u.y]), [[1, 0, 0], [2, 4, 1]]);

    run('save', 'camp', 'LEFT');   // overwrite, not a second entry
    assert.equal(JSON.parse(localStorage.getItem('st-formations'))['455'].length, 1);

    globalThis.__chat = [];
    run('list');
    assert.equal(globalThis.__chat.length, 2);
    assert.match(globalThis.__chat[1], /camp LEFT/);

    run('delete', 'CAMP', 'left');
    assert.equal(JSON.parse(localStorage.getItem('st-formations'))['455'].length, 0);
});

test('formations are kept per world', () => {
    setGame({ world: 1, army: makeArmy([[1, 10, 0, 0]]) });
    plugin().run('save', 'a');
    setGame({ world: 2, army: makeArmy([[1, 10, 0, 0]]) });
    const { run } = plugin();
    globalThis.__chat = [];
    run('load', 'a');
    assert.match(globalThis.__chat[0], /No formation "a" in this world/);
    const store = JSON.parse(localStorage.getItem('st-formations'));
    assert.equal(store['1'].length, 1);
    assert.equal(store['2'], undefined);
});

test('load matches by type (closest level), swaps resolve, missing units reported', () => {
    // saved: type 1 at (2,0), type 2 at (0,0), type 3 at (5,3)
    setGame({ army: makeArmy([[1, 10, 2, 0], [2, 12, 0, 0], [3, 8, 5, 3]]) });
    plugin().run('save', 'f');

    // other army: two type-1 units (levels 9 and 15) sitting on the target cells, no type 3
    const army = setGame({ army: makeArmy([[2, 12, 2, 0], [1, 15, 0, 0], [1, 9, 7, 2]]) });
    const { run } = plugin();
    globalThis.__chat = [];
    const logs = [];
    console.log = (...a) => logs.push(a.join(' '));
    run('load', 'f');
    const type1low = army.find(u => u.type === 1 && u.level === 9);
    const type2 = army.find(u => u.type === 2);
    assert.deepEqual([type1low.x, type1low.y], [2, 0]);   // level 9 is closer to 10 than 15
    assert.deepEqual([type2.x, type2.y], [0, 0]);
    // i18n strings are added by the release merge; the console line carries the numbers
    assert.ok(logs.some(l => l.includes('loaded "f" 2/3, missing 1')));
    assert.equal(mod.summarizeMissing([{ type: 3, name: 'Unit3' }]), '1× Unit3');
});

test('matchUnits and summarizeMissing', () => {
    const { moves, missing } = mod.matchUnits(
        [{ type: 1, level: 5, x: 0, y: 0 }, { type: 1, level: 5, x: 1, y: 0 }, { type: 4, level: 5, x: 2, y: 0, name: 'Orca' }],
        [{ id: 7, type: 1, level: 5 }],
    );
    assert.equal(moves.length, 1);
    assert.equal(mod.summarizeMissing(missing), '1× 1, 1× Orca');
});

test('refuses outside the attack setup view and writes nothing', () => {
    setGame({ mode: 'City', army: makeArmy([[1, 10, 0, 0]]) });
    const { run } = plugin();
    run('save', 'x');
    assert.equal(localStorage.getItem('st-formations'), null);
    assert.equal(globalThis.__chat.length, 1);
});

test('usage line for a missing subcommand or name; disabled plugin drops its command and is silent', () => {
    setGame({ army: makeArmy([[1, 10, 0, 0]]) });
    const { p, commands, run } = plugin();
    run();
    run('save');
    assert.equal(globalThis.__chat.length, 2);
    const handler = commands.formation;
    p.stop();
    assert.equal(commands.formation, undefined, 'unregistered on stop (5.28.0)');
    handler(['list']);
    assert.equal(globalThis.__chat.length, 2);
});
