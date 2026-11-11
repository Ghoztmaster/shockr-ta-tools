// Chat activity (lib/chat-activity.js): unread counts per tab, auto-scroll follow / pause.
// The DOM parts (badge / button / bar placement) were tested live (CHANGELOG 5.50.0).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = await esbuild.build({
    stdin: { contents: `export * from './lib/chat-activity.js'; export { initI18n } from './lib/i18n.js';`, resolveDir: root },
    bundle: true, format: 'esm', write: false,
});
const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));

function fakeConfig(data = {}) {
    return { get(k, d) { const v = data[k.toLowerCase()]; return v !== undefined ? v : d; }, set(k, v) { data[k.toLowerCase()] = v; } };
}
mod.initI18n(fakeConfig({ language: 'en' }));

/** A qx object with listeners, as far as ChatActivity uses it. */
class Emitter {
    constructor() { this.l = new Map(); this.n = 0; }
    addListener(ev, fn, ctx) { const id = ++this.n; this.l.set(id, { ev, fn: fn.bind(ctx) }); return id; }
    removeListenerById(id) { this.l.delete(id); }
    fire(ev, data) { for (const { ev: e, fn } of [...this.l.values()]) if (e === ev) fn({ getData: () => data }); }
    count() { return this.l.size; }
}

function setup() {
    const widget = new Emitter();
    const chat = new Emitter();
    let scrolledToEnd = 0;
    const page = (flags) => {
        const sb = new Emitter();
        return { meta: { flags }, autoscroll: true, sb, getButton: () => ({ getContentElement: () => ({ getDomElement: () => null }) }),
            ui: { scrcontent: { getChildControl: () => sb, getContentElement: () => ({ getDomElement: () => null }) } } };
    };
    const pages = [page(1), page(8), page(2), page(4), page(16)];
    let selected = pages[2];
    let open = true;
    const tabView = { getSelection: () => [selected], getChildren: () => pages };
    widget._getChildren = () => [tabView];
    widget.scrollToEnd = (on) => { scrolledToEnd++; if (on) selected.autoscroll = true; };
    chat.getChatWidget = () => widget;
    chat.isVisible = () => open;
    globalThis.qx = { core: { Init: { getApplication: () => ({ getChat: () => chat, getRoot: () => ({ _getChildren: () => [] }) }) } } };
    return {
        widget, chat, pages,
        select(i) { selected = pages[i]; widget.fire('chatmessageout', pages[i].meta.flags); },
        setOpen(v) { open = v; chat.fire('changeVisibility', v ? 'visible' : 'excluded'); },
        scrolledToEnd: () => scrolledToEnd,
    };
}

test('tabUnread / markRead / badgeText', () => {
    const unread = { 2: 3, 8: 1, 16: 5 };
    assert.equal(mod.tabUnread(unread, 2), 3);
    assert.equal(mod.tabUnread(unread, 1), 9);          // All tab: everything
    assert.equal(mod.tabUnread(unread, 4), 0);
    assert.deepEqual(mod.markRead({ ...unread }, 8), { 2: 3, 16: 5 });
    assert.deepEqual(mod.markRead({ ...unread }, 1), {});
    assert.equal(mod.badgeText(7), '7');
    assert.equal(mod.badgeText(150), '99+');
});

test('unread: counted for other tabs and while closed, cleared when the tab is shown; stop removes listeners', () => {
    const g = setup();
    const a = new mod.ChatActivity(fakeConfig());
    assert.equal(a.start(null), true);
    g.widget.fire('chatmessagein', 2);                   // alliance tab is shown: read right away
    g.widget.fire('chatmessagein', 16);
    g.widget.fire('chatmessagein', 16);
    g.widget.fire('chatmessagein', 8);
    assert.deepEqual(a.unread, { 16: 2, 8: 1 });
    g.select(4);                                         // global shown
    assert.deepEqual(a.unread, { 8: 1 });
    g.setOpen(false);
    g.widget.fire('chatmessagein', 4);                   // closed: even the shown tab's channel counts
    assert.deepEqual(a.unread, { 8: 1, 4: 1 });
    g.select(0);                                         // All tab shown (chat opened on it): all read
    g.setOpen(true);
    assert.deepEqual(a.unread, {});
    a.stop();
    assert.equal(g.widget.count() + g.chat.count() + g.pages.reduce((n, p) => n + p.sb.count(), 0), 0);
    g.widget.fire('chatmessagein', 16);
    assert.deepEqual(a.unread, {});
});

test('auto-scroll: pause / follow, new-message count, scrolling to the bottom turns it on, saved in config', () => {
    const g = setup();
    const cfg = fakeConfig();
    const a = new mod.ChatActivity(cfg);
    a.start(null);
    const alliance = g.pages[2];
    a.toggleFollow();                                    // the ⬇ button: pause
    assert.equal(alliance.autoscroll, false);
    assert.equal(cfg.get('chatmanager.autoScroll'), false);
    g.widget.fire('chatmessagein', 2);
    g.widget.fire('chatmessagein', 2);
    assert.equal(a.newCount, 2);
    a._userAt = Date.now();                              // your wheel in the chat
    alliance.autoscroll = true;                          // the game's listener: you reached the bottom
    alliance.sb.fire('scroll', 0);
    assert.equal(a.newCount, 0);
    assert.equal(cfg.get('chatmanager.autoScroll'), true);
    a.toggleFollow();
    a.setFollow(true);                                   // the bar / /st config set
    assert.equal(alliance.autoscroll, true);
    assert.ok(g.scrolledToEnd() >= 1);
    a.stop();
});

test('auto-scroll off is kept over the game\'s scroll-to-end on a tab switch, and nothing stays paused after stop', () => {
    const g = setup();
    const cfg = fakeConfig({ 'chatmanager.autoscroll': false });
    const a = new mod.ChatActivity(cfg);
    a.start(null);
    assert.equal(g.pages[2].autoscroll, false);          // saved state applied at start
    g.select(4);
    const global = g.pages[4];
    global.autoscroll = true;                            // the game's scroll-to-end after the switch
    global.sb.fire('scroll', 0);
    assert.equal(global.autoscroll, false);
    assert.equal(cfg.get('chatmanager.autoScroll'), false);
    a.stop();
    assert.ok(g.pages.every(p => p.autoscroll === true));
});
