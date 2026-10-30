// SpamBlock (plugins/spam-block.js): hide mail from blocked players, client-side only.
// Run: npm test
import { test, afterEach } from 'node:test';
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
            contents: `export * from './plugins/spam-block.js'; export { initI18n } from './lib/i18n.js'; export { getHelpModel } from './lib/help.js';`,
            resolveDir: root,
        },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

function fakeConfig(data = {}) {
    return {
        data,
        get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; },
        set(k, v) { data[k.toLowerCase()] = v; },
    };
}

function fakeToolbar() {
    return {
        items: {},
        register(item) { this.items[item.id] = item; },
        unregister(id) { delete this.items[id]; },
    };
}

/** Just enough DOM for the panel: elements, listeners, innerHTML with data-unblock buttons. */
function fakeDom() {
    const make = (tag) => {
        const listeners = {};
        const node = {
            tag, style: {}, children: [], parent: null, dataset: {}, value: '', _html: '', _buttons: [],
            addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
            removeEventListener() {},
            fire(type, ev = {}) { for (const fn of listeners[type] || []) fn({ stopPropagation() {}, ...ev }); },
            appendChild(c) { c.parent = node; node.children.push(c); return c; },
            append(...cs) { for (const c of cs) node.appendChild(c); },
            remove() { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = null; },
            contains(o) { for (let n = o; n; n = n.parent) if (n === node) return true; return false; },
            set innerHTML(v) {
                node._html = v;
                node._buttons = [...v.matchAll(/data-unblock="(\d+)"/g)].map(m => { const b = make('button'); b.dataset.unblock = m[1]; return b; });
            },
            get innerHTML() { return node._html; },
            querySelectorAll(sel) { return sel === 'button[data-unblock]' ? node._buttons : []; },
        };
        return node;
    };
    const body = make('body');
    globalThis.document = { body, createElement: make, addEventListener() {}, removeEventListener() {} };
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
    return body;
}

function fakeCli() {
    return {
        commands: {},
        register(n, fn) { this.commands[n] = fn; },
        unregister(n) { delete this.commands[n]; },
    };
}

const header = (i, fi, f) => ({ i, fi, f, s: `subject ${i}`, r: false, d: 0 });
const INBOX = [header(1, 10, 'Spammer'), header(2, 20, 'Friend'), header(3, 10, 'Spammer'), header(4, -1, 'System')];

/** Minimal qx: widgets with children, layout parent, appearance; Button with execute listeners. */
function qxFake() {
    class Widget {
        constructor(classname, children = []) {
            this.classname = classname;
            this.children = [];
            this.shown = true;
            for (const c of children) this.add(c);
        }
        _getChildren() { return this.children; }
        getLayoutParent() { return this.parent || null; }
        add(c) { c.parent = this; this.children.push(c); }
        addAfter(c, ref) { c.parent = this; this.children.splice(this.children.indexOf(ref) + 1, 0, c); }
        isSeeable() { return this.shown; }
        exclude() { this.shown = false; }
        show() { this.shown = true; }
    }
    class Button extends Widget {
        constructor(label, objid) {
            super('qx.ui.form.Button');
            this.label = label;
            this.objid = objid;
            this.appearance = 'button';
            this.enabled = true;
            this.listeners = [];
        }
        setAppearance(a) { this.appearance = a; }
        getAppearance() { return this.appearance; }
        setEnabled(v) { this.enabled = v; }
        setToolTipText(v) { this.tooltip = v; }
        addListener(type, fn) { this.listeners.push(fn); }
        execute() { for (const fn of this.listeners) fn(); }
        destroy() { this.parent.children = this.parent.children.filter(c => c !== this); this.destroyed = true; }
    }
    return { Widget, Button };
}

const chat = [];
/** The probe's structure (2026-10-30): MailMessageDisplay, action buttons in one Composite. */
const OBJIDS = ['btnback', 'btndelete', 'btnreport', 'btnforward', 'btnreplyall', 'btnreply', 'btn_close'];
function setup() {
    const { Widget, Button } = qxFake();
    const buttons = Object.fromEntries(OBJIDS.map(id => [id, new Button(id, id)]));
    buttons.btndelete.setAppearance('game-button');
    const bar = new Widget('qx.ui.container.Composite', OBJIDS.map(id => buttons[id]));
    const view = new Widget('webfrontend.gui.mail.MailMessageDisplay', [new Widget('qx.ui.container.Composite', [bar])]);
    const overlay = new Widget('webfrontend.gui.MenuOverlayWidget', [new Widget('webfrontend.gui.mail.MailTab'), view]);
    const rootW = new Widget('qx.ui.root.Application', [overlay]);
    const server = { sent: [], inbox: INBOX };
    class CM {
        SendSimpleCommand(name, params, delegate, ctx) {
            server.sent.push(name);
            if (name === 'IGMGetMsgHeader') delegate(ctx, server.inbox.map(h => ({ ...h })));
            if (name === 'IGMGetMsg') delegate(ctx, 'body');
        }
    }
    CM.prototype.$obf = CM.prototype.SendSimpleCommand;   // obfuscated alias, same function
    globalThis.ClientLib = {
        Net: { CommunicationManager: CM },
        Data: { MainData: { GetInstance: () => ({ get_Player: () => ({ get_Id: () => 99 }) }) } },
    };
    globalThis.qx = {
        ui: { form: { Button } },
        core: { Init: { getApplication: () => ({
            getRoot: () => rootW,
            getChat: () => ({ getChatWidget: () => ({ showMessage: (m) => chat.push(m) }) }),
        }) } },
    };
    globalThis.webfrontend = { gui: { chat: { ChatWidget: { sender: { system: 'system' } } } } };
    return { cm: new CM(), server, view, bar, buttons, overlay };
}

/** The view shows a (cached) mail: the probed mail data in an obfuscated field, no IGMGetMsg. */
const showMail = (view, h) => {
    view.__dS = { Id: h.i, Type: h.fi === -1 ? 1 : 0, Subject: h.s, From: h.f, To: 'GhoztMasters', Date: 0, Read: true,
        FromId: h.fi, ToIds: [99], ToAllianceIds: [], ToAllianceNames: [], Text: '...' };
};

const mod = await load();
mod.initI18n(fakeConfig({ language: 'en' }));
const quiet = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };
const tick = () => new Promise(r => setTimeout(r, 5));

/** Plugins made by a test; one still running after it (a failed assert) is stopped, so no interval keeps node alive. */
const made = [];
const make = (cfg, cli, toolbar = fakeToolbar()) => { const p = new mod.SpamBlock(cfg, toolbar, cli); made.push(p); return p; };
afterEach(() => {
    const restore = quiet();
    for (const p of made.splice(0)) if (p.running) p.stop();
    restore();
});

/** The game's list request; returns what the game's delegate received. */
function listInbox(cm, key = 'SendSimpleCommand') {
    let got = null;
    cm[key]('IGMGetMsgHeader', { folder: 1, skip: 0, take: 50 }, (ctx, list) => { got = list; }, null);
    return got;
}

test('isHeaderList / filterHeaders / findEntry / isBlockable', () => {
    assert.equal(mod.isHeaderList(INBOX), true);
    assert.equal(mod.isHeaderList([]), false);
    assert.equal(mod.isHeaderList([{ i: 1 }]), false);
    assert.equal(mod.isHeaderList('x'), false);
    assert.deepEqual(mod.filterHeaders(INBOX, new Set([10])).map(h => h.i), [2, 4]);
    assert.equal(mod.filterHeaders(INBOX, new Set()), INBOX);
    const list = [{ id: 10, name: 'Spammer' }];
    assert.equal(mod.findEntry(list, 'spammer'), list[0]);
    assert.equal(mod.findEntry(list, '10'), list[0]);
    assert.equal(mod.findEntry(list, 'nobody'), null);
    assert.equal(mod.isBlockable({ fi: 10 }, 99), true);
    assert.equal(mod.isBlockable({ fi: -1 }, 99), false, 'system mail');
    assert.equal(mod.isBlockable({ fi: 99 }, 99), false, 'yourself');
    assert.equal(mod.isBlockable({ fi: 10, type: 0 }, 99), true, 'player mail');
    assert.equal(mod.isBlockable({ fi: 10, type: 1 }, 99), false, 'Type other than 0');
    assert.equal(mod.isBlockable(null, 99), false);
});

test('wrapDelegate: maps header lists only, runs after, keeps non-functions', () => {
    const seen = [];
    const w = mod.wrapDelegate((ctx, data) => seen.push([ctx, data]), { map: (l) => l.slice(0, 1), after: () => seen.push('after') });
    w('ctx', INBOX);
    w('ctx', 42);
    assert.deepEqual(seen, [['ctx', [INBOX[0]]], 'after', ['ctx', 42], 'after']);
    assert.equal(mod.wrapDelegate(null), null);
});

test('list: blocked senders are filtered (also via an obfuscated alias); stop() restores', async () => {
    const { cm } = setup();
    const cfg = fakeConfig({ 'spamblock.blocked': [{ id: 10, name: 'Spammer' }] });
    const p = make(cfg, fakeCli());
    const restore = quiet();
    await p.start();
    assert.deepEqual(listInbox(cm).map(h => h.i), [2, 4], 'every mail of the blocked sender gone');
    assert.deepEqual(listInbox(cm, '$obf').map(h => h.i), [2, 4]);
    p.stop();
    restore();
    assert.deepEqual(listInbox(cm).map(h => h.i), [1, 2, 3, 4]);
});

test('cached mail (no IGMGetMsg): the scan adds "Block sender" right after btndelete, same appearance', async () => {
    const { view, bar, buttons } = setup();
    showMail(view, INBOX[0]);
    const p = make(fakeConfig(), fakeCli());
    const restore = quiet();
    await p.start();                                    // start() scans once
    const ids = bar.children.map(b => b.objid);
    assert.deepEqual(ids.slice(0, 3), ['btnback', 'btndelete', 'stblocksender']);
    assert.equal(ids.length, OBJIDS.length + 1);
    const btn = bar.children[2];
    assert.equal(btn.label, 'Block sender');
    assert.equal(btn.appearance, buttons.btndelete.getAppearance());
    assert.equal(btn.enabled, true);
    assert.match(btn.tooltip, /Spammer/);
    p.scan();
    assert.equal(bar.children.filter(b => b.objid === 'stblocksender').length, 1, 'no second button');
    p.stop();
    restore();
    assert.equal(bar.children.some(b => b.objid === 'stblocksender'), false, 'button removed on stop');
});

test('hidden mail overlay: no button, subtree not entered', async () => {
    const { view, bar, overlay } = setup();
    showMail(view, INBOX[0]);
    overlay.exclude();
    const p = make(fakeConfig(), fakeCli());
    const restore = quiet();
    await p.start();
    assert.equal(bar.children.length, OBJIDS.length);
    p.stop();
    restore();
});

test('click: sender read at click time, blocks, list redraws via replay only, back pressed', async () => {
    const { cm, server, view, bar, buttons } = setup();
    const cfg = fakeConfig();
    const cli = fakeCli();
    const p = make(cfg, cli);
    const restore = quiet();
    await p.start();
    const drawn = [];
    cm.SendSimpleCommand('IGMGetMsgHeader', { folder: 1 }, (ctx, list) => drawn.push(list.map(h => h.i)), null);
    showMail(view, INBOX[1]);
    p.scan();
    showMail(view, INBOX[0]);                           // another mail opened from the cache before the next scan
    let backs = 0;
    buttons.btnback.addListener('execute', () => backs++);
    chat.length = 0;
    const sentBefore = server.sent.length;
    bar.children.find(b => b.objid === 'stblocksender').execute();
    assert.deepEqual(cfg.get('SpamBlock.blocked'), [{ id: 10, name: 'Spammer' }], 'the mail shown at the click');
    assert.match(chat[0], /\[ST\] Blocked: Spammer/);
    assert.deepEqual(server.sent.slice(sentBefore), ['IGMGetMsgHeader'], 'only the list read is replayed, nothing else sent');
    assert.deepEqual(drawn, [[1, 2, 3, 4], [2, 4]], "the game's own delegate redrew without the spammer");
    assert.equal(backs, 1, "the view's back button");
    p.stop();
    restore();
    assert.equal(cli.commands.blocklist, undefined);
});

test('no header on the view: falls back to the header of the last IGMGetMsg', async () => {
    const { cm, bar } = setup();
    const p = make(fakeConfig(), fakeCli());
    const restore = quiet();
    await p.start();
    listInbox(cm);
    cm.SendSimpleCommand('IGMGetMsg', { mailId: 2 }, () => {}, null);
    await tick();
    const btn = bar.children.find(b => b.objid === 'stblocksender');
    assert.match(btn.tooltip, /Friend/);
    assert.equal(btn.enabled, true);
    p.stop();
    restore();
});

test('system mail: button present but disabled', async () => {
    const { view, bar } = setup();
    showMail(view, INBOX[3]);
    const p = make(fakeConfig(), fakeCli());
    const restore = quiet();
    await p.start();
    const btn = bar.children.find(b => b.objid === 'stblocksender');
    assert.equal(btn.enabled, false);
    assert.match(btn.tooltip, /cannot be blocked/);
    p.stop();
    restore();
});

test('findHeaderIn: found by shape (FromId + From) under any field name, depth-limited, widgets skipped', () => {
    const mail = { Id: 5, Type: 0, Subject: 's', From: 'X', To: 'Me', FromId: 7, ToIds: [99], Text: 't' };
    assert.deepEqual(mod.findHeaderIn({ __dS: mail }), { i: 5, fi: 7, f: 'X', type: 0 });
    assert.deepEqual(mod.findHeaderIn({ __xY: { ...mail, Type: 3 } }).type, 3, 'another build, another field name');
    assert.deepEqual(mod.findHeaderIn({ a: { b: mail } }).fi, 7);
    assert.equal(mod.findHeaderIn({ a: { b: { c: { d: mail } } } }), null);
    assert.equal(mod.findHeaderIn({ w: { classname: 'qx.ui.core.Widget', m: mail } }), null);
    assert.equal(mod.findHeaderIn({ old: { i: 5, f: 'X', fi: 7 } }), null, 'server header shape is not view data');
    const loop = {}; loop.self = loop;
    assert.equal(mod.findHeaderIn(loop), null);
});

/** The open panel's parts: [header, form, list]; form = [input, Block button]. */
function panelParts(body) {
    const panel = body.children.find(c => c.id === 'st-spamblock-panel');
    const [header, form, list] = panel.children;
    return { panel, title: header.children[0], input: form.children[0], add: form.children[1], list };
}

test('panel: toolbar button and /st blocklist toggle it; it lists name + id + Unblock', async () => {
    setup();
    const body = fakeDom();
    const cfg = fakeConfig({ 'spamblock.blocked': [{ id: 10, name: 'Spammer' }, { id: null, name: 'Bot' }] });
    const cli = fakeCli();
    const toolbar = fakeToolbar();
    const p = make(cfg, cli, toolbar);
    const restore = quiet();
    await p.start();
    assert.ok(toolbar.items.spamblock, 'toolbar item registered');
    assert.equal(toolbar.items.spamblock.label(), 'Block list');
    toolbar.items.spamblock.onClick();
    const { panel, title, list } = panelParts(body);
    assert.equal(panel.style.display, 'block');
    assert.match(title.innerHTML, /Blocked players.*\(2\)/);
    assert.match(list.innerHTML, /Spammer/);
    assert.match(list.innerHTML, />10</);
    assert.match(list.innerHTML, /Bot.*by name/);
    assert.equal(list._buttons.length, 2);
    cli.commands.blocklist([]);
    assert.equal(panel.style.display, 'none', '/st blocklist toggles it closed');
    p.stop();
    restore();
    assert.equal(toolbar.items.spamblock, undefined);
    assert.equal(body.children.length, 0, 'panel removed on stop');
});

test('panel: Unblock removes the player, list and mail redraw at once', async () => {
    const { cm } = setup();
    const body = fakeDom();
    const cfg = fakeConfig({ 'spamblock.blocked': [{ id: 10, name: 'Spammer' }, { id: 30, name: 'Bot' }] });
    const p = make(cfg, fakeCli());
    const restore = quiet();
    await p.start();
    const drawn = [];
    cm.SendSimpleCommand('IGMGetMsgHeader', { folder: 1 }, (ctx, list) => drawn.push(list.length), null);
    p.open();
    const { list, title } = panelParts(body);
    chat.length = 0;
    list._buttons[0].fire('click');
    assert.deepEqual(cfg.get('SpamBlock.blocked'), [{ id: 30, name: 'Bot' }]);
    assert.match(chat[0], /Unblocked: Spammer/);
    assert.deepEqual(drawn, [2, 4], 'mail list redrawn with the unblocked mail');
    assert.match(title.innerHTML, /\(1\)/);
    assert.doesNotMatch(list.innerHTML, /Spammer/);
    p.stop();
    restore();
});

test('panel: block by name (Block button and Enter), not validated; filters mail and learns the id', async () => {
    const { cm } = setup();
    const body = fakeDom();
    const cfg = fakeConfig();
    const p = make(cfg, fakeCli());
    const restore = quiet();
    await p.start();
    p.open();
    const { input, add, list } = panelParts(body);
    input.value = '  spammer ';
    add.fire('click');
    assert.deepEqual(cfg.get('SpamBlock.blocked'), [{ id: null, name: 'spammer' }]);
    assert.equal(input.value, '', 'field cleared');
    assert.match(list.innerHTML, /spammer.*by name/);
    input.value = 'NoSuchPlayer';
    input.fire('keydown', { key: 'Enter' });
    assert.equal(cfg.get('SpamBlock.blocked').length, 2, 'any name is stored');
    chat.length = 0;
    input.value = 'SPAMMER';
    add.fire('click');
    assert.match(chat[0], /already blocked/);
    assert.equal(cfg.get('SpamBlock.blocked').length, 2);

    assert.deepEqual(listInbox(cm).map(h => h.i), [2, 4], 'mail from that name filtered (case-insensitive)');
    assert.deepEqual(cfg.get('SpamBlock.blocked')[0], { id: 10, name: 'spammer' }, 'id learned from the first mail');
    assert.match(list.innerHTML, />10</, 'panel shows the learned id');
    p.stop();
    restore();
});

test('/st blocklist remove: by name, unknown name, usage', async () => {
    setup();
    fakeDom();
    const cfg = fakeConfig({ 'spamblock.blocked': [{ id: 10, name: 'Spammer' }, { id: 30, name: 'Bot' }] });
    const cli = fakeCli();
    const p = make(cfg, cli);
    const restore = quiet();
    await p.start();
    chat.length = 0;
    cli.commands.blocklist(['remove', 'SPAMMER']);
    assert.match(chat[0], /Unblocked: Spammer/);
    assert.deepEqual(cfg.get('SpamBlock.blocked'), [{ id: 30, name: 'Bot' }]);
    chat.length = 0;
    cli.commands.blocklist(['remove', 'Nobody']);
    assert.match(chat[0], /not on your block list/);
    cli.commands.blocklist(['what']);
    assert.match(chat[1], /Usage: \/st blocklist/);
    assert.equal(p.statusText(), '1 blocked player(s)');
    p.stop();
    restore();
});

test('copyLook: size, padding, font and layout properties of the game button; unset values skipped', () => {
    const props = {};
    const from = {
        getAppearance: () => 'game-button', getWidth: () => 120, getHeight: () => 26, getMinWidth: () => null,
        getPaddingTop: () => 2, getPaddingLeft: () => 6, getFont: () => 'font_size_11', getTextColor: () => undefined,
        getLayoutProperties: () => ({ flex: 0 }),
    };
    const to = new Proxy({}, { get: (o, k) => (typeof k === 'string' && k.startsWith('set') ? (v) => { props[k.slice(3)] = v; } : undefined) });
    mod.copyLook(from, to);
    assert.deepEqual(props, { Appearance: 'game-button', Width: 120, Height: 26, PaddingTop: 2, PaddingLeft: 6, Font: 'font_size_11', LayoutProperties: { flex: 0 } });
});

test('normalizeList: name-only entries kept, empty ones dropped', () => {
    assert.deepEqual(mod.normalizeList([{ id: 10, name: 'A' }, { id: null, name: ' B ' }, { id: '', name: '' }, null, { id: '7' }]),
        [{ id: 10, name: 'A' }, { id: null, name: 'B' }, { id: 7, name: '' }]);
    assert.deepEqual(mod.normalizeList('x'), []);
    assert.deepEqual(mod.filterHeaders(INBOX, new Set(), new Set(['friend'])).map(h => h.i), [1, 3, 4]);
    assert.equal(mod.findEntry([{ id: null, name: 'B' }], 'null'), null);
});

test('blocking twice says "already blocked"', () => {
    setup();
    const cfg = fakeConfig({ 'spamblock.blocked': [{ id: 10, name: 'Spammer' }] });
    const p = make(cfg, fakeCli());
    chat.length = 0;
    assert.equal(p.block(10, 'Spammer'), false);
    assert.match(chat[0], /already blocked/);
});

test('/st help lists the blocklist commands when the plugin registered them', () => {
    const model = mod.getHelpModel('5.32.0', [], { blocklist: () => {} });
    const tools = model.sections.find(s => s.rows.some(r => r[0] === '/st blocklist'));
    assert.ok(tools);
    assert.ok(tools.rows.some(r => r[0] === '/st blocklist remove <name>'));
    assert.equal(mod.getHelpModel('5.32.0', [], {}).sections.some(s => s.rows.some(r => r[0] === '/st blocklist')), false);
});
