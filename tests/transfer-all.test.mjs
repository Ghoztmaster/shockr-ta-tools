// TransferAll: pull tiberium + crystal from all other bases into the open base (plugins/transfer-all.js).
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
        stdin: { contents: `export * from './plugins/transfer-all.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

const TIB = 1;
const CRY = 2;

function city(id, name, res, { max = {}, trade = 0, costPerUnit = 0.1 } = {}) {
    return {
        id, name, res: { ...res },
        get_Id: () => id,
        get_Name: () => name,
        get_PosX: () => 100,
        get_PosY: () => 100,
        CanTrade: () => trade,
        GetResourceCount(t) { return this.res[t] || 0; },
        GetResourceMaxStorage: (t) => max[t] ?? 1e9,
        CalculateTradeCostToCoord: (x, y, amount) => Math.ceil(amount * costPerUnit),
    };
}

/** Game globals; `answer(cmd, args)` decides the SelfTrade result code (0 = ok). */
function setup({ target, others, credits = 1e12, answer = () => 0 }) {
    const sent = [];
    globalThis.ClientLib = {
        Base: { EResourceType: { Tiberium: TIB, Crystal: CRY } },
        Data: {
            ETradeError: { None: 0 },
            MainData: { GetInstance: () => ({
                get_Cities: () => ({
                    get_CurrentOwnCity: () => target,
                    get_AllCities: () => ({ d: Object.fromEntries([target, ...others].map(c => [c.id, c])) }),
                }),
                get_Player: () => ({ GetCreditsCount: () => credits }),
            }) },
        },
        Net: {
            CommandResult: {},
            CommunicationManager: { GetInstance: () => ({
                SendCommand(cmd, args, cb) {
                    sent.push({ cmd, ...args });
                    const code = answer(cmd, args, sent.length);
                    if (code === 0) {                     // a real transfer moves the resource
                        const src = others.find(c => c.id === args.sourceCityId);
                        src.res[args.resourceType] -= args.amount;
                        target.res[args.resourceType] = (target.res[args.resourceType] || 0) + args.amount;
                    }
                    setTimeout(() => cb(null, code), 0);
                },
            }) },
        },
    };
    globalThis.phe = { cnc: { Util: { createEventDelegate: (type, ctx, fn) => fn } } };
    return sent;
}

function quietLog() {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    return { lines, restore: () => { console.log = orig; } };
}

test('plan: tib + crystal from every other base, capped at free storage', () => {
    const target = city(1, 'Main', { [TIB]: 900, [CRY]: 0 }, { max: { [TIB]: 1000, [CRY]: 5000 } });
    const a = city(2, 'A', { [TIB]: 300, [CRY]: 2000 });
    const b = city(3, 'B', { [TIB]: 300, [CRY]: 4000 });
    setup({ target, others: [a, b] });
    const plan = mod.planTransfers(target, [target, a, b], 1e9);
    assert.deepEqual(plan.items.map(i => [i.source.id, i.key, i.amount]), [
        [2, 'tib', 100],              // only 100 tib space left
        [2, 'cry', 2000],
        [3, 'cry', 3000],             // 5000 crystal space in total
    ]);
    assert.deepEqual(plan.skippedFull, []);
});

test('plan: full storage skips that resource, the other still goes', () => {
    const target = city(1, 'Main', { [TIB]: 1000 }, { max: { [TIB]: 1000 } });
    const a = city(2, 'A', { [TIB]: 300, [CRY]: 200 });
    setup({ target, others: [a] });
    const plan = mod.planTransfers(target, [target, a], 1e9);
    assert.deepEqual(plan.skippedFull, ['tib']);
    assert.deepEqual(plan.items.map(i => [i.key, i.amount]), [['cry', 200]]);
});

test('plan: not enough credits skips that base; bases that cannot trade are left out', () => {
    const target = city(1, 'Main', {});
    const a = city(2, 'A', { [TIB]: 1000 }, { costPerUnit: 1 });     // cost 1000
    const b = city(3, 'B', { [TIB]: 100 }, { costPerUnit: 1 });      // cost 100
    const c = city(4, 'C', { [CRY]: 100 }, { trade: 5 });           // cannot trade
    setup({ target, others: [a, b, c] });
    const plan = mod.planTransfers(target, [target, a, b, c], 500);
    assert.deepEqual(plan.items.map(i => i.source.id), [3]);
    assert.equal(plan.skippedCredits, 1);
    assert.equal(plan.cost, 100);
    const blocked = city(1, 'Main', {}, { trade: 7 });
    assert.equal(mod.planTransfers(blocked, [a], 1e9).items.length, 0, 'open base cannot trade = nothing');
});

test('transfer: SelfTrade per item, console line names the base', async () => {
    const target = city(1, 'Main', {});
    const a = city(2, 'A', { [TIB]: 300, [CRY]: 200 });
    const sent = setup({ target, others: [a] });
    const log = quietLog();
    let r;
    try {
        r = await new mod.TransferAll({}).transfer();
    } finally {
        log.restore();
    }
    assert.deepEqual(sent.map(s => [s.cmd, s.targetCityId, s.sourceCityId, s.resourceType, s.amount]), [
        ['SelfTrade', 1, 2, TIB, 300],
        ['SelfTrade', 1, 2, CRY, 200],
    ]);
    assert.deepEqual(r.done, { tib: 300, cry: 200 });
    assert.match(log.lines.join('\n'), /\[ST\] Transferred all resources to Main/);
});

test('transfer: a refused SelfTrade is retried once, then skipped; the rest goes on', async () => {
    const target = city(1, 'Main', {});
    const a = city(2, 'A', { [TIB]: 300, [CRY]: 200 });
    const sent = setup({ target, others: [a], answer: (cmd, args) => (args.resourceType === TIB ? 3 : 0) });
    const log = quietLog();
    let r;
    try {
        r = await new mod.TransferAll({}).transfer();
    } finally {
        log.restore();
    }
    assert.equal(sent.filter(s => s.resourceType === TIB).length, 2, 'one retry');
    assert.equal(r.failed, 1);
    assert.deepEqual(r.done, { tib: 0, cry: 200 });
    assert.match(log.lines.join('\n'), /Transferred all resources to Main/);
});

test('start/stop without the transfer panel: no button, no throw', async () => {
    const target = city(1, 'Main', {});
    setup({ target, others: [] });
    globalThis.webfrontend = {};
    const p = new mod.TransferAll({});
    const warn = console.warn;
    const log = quietLog();
    console.warn = () => {};
    try {
        await p.start();
        assert.equal(p._widgets, null);
        p.stop();
        assert.equal(p._timer, null);
    } finally {
        console.warn = warn;
        log.restore();
    }
});
