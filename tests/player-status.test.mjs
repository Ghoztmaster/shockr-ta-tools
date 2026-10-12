// PlayerStatus color schemes (`/st config set colors shockr|maelstrom`).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// main.js would boot the whole script — replaced by a chat stub that records lines.
async function load() {
    const out = await esbuild.build({
        stdin: {
            contents: `export { PlayerStatus } from './plugins/player-status.js';
                       export { Cli } from './lib/cli.js';
                       export { initI18n } from './lib/i18n.js';
                       export { chatLines } from './lib/main.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
        plugins: [{
            name: 'stub-main',
            setup(b) {
                b.onResolve({ filter: /lib\/main\.js$/ }, () => ({ path: 'main', namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    contents: 'export const chatLines = []; export function chatMessage(m) { chatLines.push(m); }',
                }));
            },
        }],
    });
    const code = out.outputFiles[0].text;
    return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

class MemConfig {
    constructor(data = {}) { this.data = data; }
    get(k, d) { const v = this.data[k.toLowerCase()]; return v !== undefined ? v : d; }
    set(k, v) { this.data[k.toLowerCase()] = v; }
}

const ME = 1, ALLY = 7;
function installGame(members) {
    let dirty = 0;
    const getBaseColor = function () { return 'orig'; };
    globalThis.ClientLib = {
        Data: {
            BaseColors: { prototype: { ABCDEF: getBaseColor, GetBaseColor: getBaseColor } },
            AllianceChange: {},
            MainData: {
                GetInstance: () => ({
                    get_Player: () => ({ id: ME }),
                    get_Alliance: () => ({
                        get_Id: () => ALLY,
                        get_MemberData: () => ({ d: members }),
                        GetRelation: () => 0,
                        RefreshMemberData() {},
                    }),
                }),
            },
        },
        Vis: { VisMain: { GetInstance: () => ({ get_Region: () => ({ SetColorDirty: () => { dirty++; } }) }) } },
    };
    globalThis.webfrontend = { phe: { cnc: { Util: { attachNetEvent() {}, detachNetEvent() {} } } } };
    return { dirtyCount: () => dirty };
}

const MEMBERS = { 2: { OnlineState: 0 }, 3: { OnlineState: 1 }, 4: { OnlineState: 2 }, 5: { OnlineState: 3 } };
const colorsOf = () => {
    const f = ClientLib.Data.BaseColors.prototype.GetBaseColor;
    return [2, 3, 4, 5].map(id => f(id, ALLY));
};

test('default scheme is shockr; hidden uses the offline color', async () => {
    const m = await load();
    installGame(MEMBERS);
    const ps = new m.PlayerStatus(new MemConfig(), new m.Cli(new MemConfig()));
    await ps.start();
    assert.deepEqual(colorsOf(), ['#5a5653', '#76ff03', '#ffd600', '#5a5653']);
    ps.stop();
});

test('/st config set colors maelstrom switches, stores, repaints and confirms', async () => {
    const m = await load();
    const game = installGame(MEMBERS);
    const config = new MemConfig();
    m.initI18n(config);
    const cli = new m.Cli(config);
    cli.start();
    const ps = new m.PlayerStatus(config, cli);
    await ps.start();
    const before = game.dirtyCount();

    cli.commands.config(['set', 'colors', 'maelstrom']);
    assert.deepEqual(colorsOf(), ['#FF0000', '#B700FF', '#FFFF00', '#C2C2C2']);
    assert.equal(config.get('colors'), 'maelstrom');
    assert.ok(game.dirtyCount() > before);
    assert.equal(m.chatLines.at(-1), '[ST] Color scheme set to: maelstrom');

    cli.commands.config(['set', 'colors', 'shockr']);
    assert.deepEqual(colorsOf(), ['#5a5653', '#76ff03', '#ffd600', '#5a5653']);
    assert.equal(m.chatLines.at(-1), '[ST] Color scheme set to: shockr');
    ps.stop();
});

test('stored scheme applies at start; unknown value is refused and not stored', async () => {
    const m = await load();
    installGame(MEMBERS);
    const config = new MemConfig({ colors: 'maelstrom' });
    m.initI18n(config);
    const cli = new m.Cli(config);
    cli.start();
    const ps = new m.PlayerStatus(config, cli);
    await ps.start();
    assert.deepEqual(colorsOf(), ['#FF0000', '#B700FF', '#FFFF00', '#C2C2C2']);

    cli.commands.config(['set', 'colors', 'pink']);
    assert.equal(config.get('colors'), 'maelstrom');
    assert.match(m.chatLines.at(-1), /Unknown color scheme: pink/);
    assert.deepEqual(colorsOf(), ['#FF0000', '#B700FF', '#FFFF00', '#C2C2C2']);
    ps.stop();
});
