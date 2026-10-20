// STABS window vs the live DOM of TABS' window (docs/tabs-dom-reference.html, copied by Wilco
// from DevTools). Pixel positions come from the game's qx theme and can only be checked in-game;
// this compares everything else: blocks and their decorators, columns, rows and which are hidden,
// row labels (text or image), texts and colours of the values, fixed sizes, buttons, status bar,
// and that every image is used consistently (one CDN file per game resource id). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
    const out = await esbuild.build({
        stdin: { contents: `export * from './plugins/stabs-window.js'; export * from './plugins/stabs-stats.js';`, resolveDir: root },
        bundle: true, format: 'esm', write: false,
    });
    return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}
const mod = await load();

// ─── The reference DOM ───────────────────────────────────────────────

/** Minimal parser for the dump: nested div/img with class, style and text. */
function parseDump(html) {
    const top = { kids: [] };
    const stack = [top];
    const re = /<(\/?)(div|img)\b([^>]*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[4] !== undefined) {
            const text = m[4].trim();
            if (text) stack[stack.length - 1].text = (stack[stack.length - 1].text || '') + text;
            continue;
        }
        if (m[1]) {
            stack.pop();
            continue;
        }
        const attrs = m[3];
        const attr = (name) => {
            const a = new RegExp(`${name}="([^"]*)"`).exec(attrs);
            return a ? a[1].replace(/&quot;/g, '"') : '';
        };
        const style = {};
        for (const part of attr('style').split(';')) {
            const i = part.indexOf(':');
            if (i > 0) style[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
        const node = { tag: m[2], cls: attr('class'), style, src: attr('src').split('/').pop(), kids: [] };
        stack[stack.length - 1].kids.push(node);
        if (m[2] === 'div') stack.push(node);
    }
    return top.kids[0];
}
const dom = parseDump(fs.readFileSync(path.join(root, 'docs/tabs-dom-reference.html'), 'utf8'));
const hidden = (n) => (n.style.display || '') === 'none';
const textOf = (n) => n.text || n.kids.map(textOf).join('');
const imgOf = (n) => (n.tag === 'img' ? n.src : n.kids.map(imgOf).find(Boolean) || null);
const body = dom.kids.find(k => k.cls === 'qx-window');
const caption = dom.kids.find(k => k.cls === 'qx-window-captionbar-active');

// ─── STABS' window in a qx fake that keeps the widget tree ───────────

function fakeQx() {
    class Widget {
        constructor(...args) {
            this.props = {};
            this.kids = [];
            this.listeners = {};
            this.controls = {};
            this.args = args;
            this.style = {};
            if (typeof args[0] === 'string' || args[0] === null) this.props.value = args[0];
            if (args[1]) this.props.icon = args[1];
            const proxy = new Proxy(this, {
                get(target, name) {
                    if (name in target) return target[name];
                    if (typeof name !== 'string') return undefined;
                    const m = /^(set|get|reset)([A-Z].*)$/.exec(name);
                    if (!m) return () => proxy;
                    const prop = m[2][0].toLowerCase() + m[2].slice(1);
                    if (m[1] === 'set') return (v) => { target.props[prop] = v; return proxy; };
                    if (m[1] === 'reset') return () => { delete target.props[prop]; return proxy; };
                    return () => target.props[prop];
                },
            });
            this.self = proxy;
            return proxy;
        }
        set(o) { Object.assign(this.props, o); return this.self; }
        add(w) { this.kids.push(w); return this.self; }
        addListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
        getChildControl(name) { return (this.controls[name] = this.controls[name] || new Widget()); }
        getContentElement() { const w = this; return { setStyle: (k, v) => { w.style[k] = v; } }; }
        getValue() { return this.props.value; }
        setValue(v) { this.props.value = v; return this.self; }
        isVisible() { return this.props.visibility !== 'excluded'; }
        exclude() { this.props.visibility = 'excluded'; }
        show() { this.props.visibility = 'visible'; }
        moveTo() {}
        getBounds() { return null; }
        destroy() {}
    }
    class Win extends Widget {
        isVisible() { return !!this.props.open; }
        open() { this.props.open = true; }
        close() { this.props.open = false; }
    }
    const layout = class {};
    globalThis.qx = {
        ui: {
            window: { Window: Win },
            container: { Composite: Widget },
            basic: { Label: Widget, Atom: Widget },
            form: { Button: Widget },
            core: { Spacer: Widget },
            layout: { VBox: layout, HBox: layout, Grow: layout },
        },
        // the game texts in the reference (English client)
        locale: { Manager: { tr: (id) => ({ 'tnf:combat target': 'Defender', 'tnf:own repair cost': 'Own repair costs:', 'tnf:lootable resources:': 'Loot:' }[id] || id) } },
    };
    globalThis.ClientLib = {
        Base: {
            ETechName: { Construction_Yard: 1, Defense_Facility: 2, Command_Center: 3, Barracks: 4, Factory: 5, Airport: 6 },
            EFactionType: { GDIFaction: 1 },
            Tech: { GetTechIdFromTechNameAndFaction: () => 0, GetTechDisplayNameFromTechId: () => null },
        },
    };
}

/** Stats that give the reference's Defender percentages (73.7 / 31.1 / 99.0 / 100 / 99.4). */
function referenceStats() {
    const s = mod.emptyStats();
    const hp = (k, end) => Object.assign(s.enemy[k].hp, { max: 1000, end });
    hp('overall', 737); hp('defense', 311); hp('structure', 990); hp('cy', 1000); hp('df', 994);
    Object.assign(s.offense.overall.hp, { max: 100, end: 50 });
    s.offense.overall.res[mod.RES.CRY] = 223900;
    s.battleDuration = 52000;
    return s;
}

function buildStabs() {
    fakeQx();
    const data = {};
    const win = new mod.StatsWindow({
        config: { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } },
        presets: [{ id: 'live', name: 'live', description: '' }, { id: 'cy', name: 'CY', description: '' }],
        onUserClose() {}, onSimulate() {}, onReplay() {}, onLoad() {}, onReset() {},
    });
    win.open();
    const s = referenceStats();
    const fmt = { time: (x) => `${x}`, number: (x) => `${x}` };
    const cells = mod.columnCells({ stats: s, base: 'Grote Smurf', storage: 1, loot: null }, fmt);
    win.update({
        columns: [{ cells, dim: false }, { cells, dim: false }],
        enemyRows: mod.visibleEnemyRows(s),
        moraleVisible: false,
        cacheCount: 1,
        outcomeTitles: { victory: 'Victory' },
    });
    return win;
}
const stabs = buildStabs();
const blocks = stabs.win.kids;

/** "hsl(31.6, 100%, 42%)" → "rgb(214, 113, 0)", as the browser renders it. */
function hslToRgb(color) {
    const m = /^hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)$/.exec(color);
    if (!m) return color;
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
        t = (t + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return `rgb(${Math.round(f(h + 1 / 3) * 255)}, ${Math.round(f(h) * 255)}, ${Math.round(f(h - 1 / 3) * 255)})`;
}

const KIND = (n) => (n.cls === 'qx-pane-light-plain' ? 'section'
    : n.cls === 'qx-window-statusbar' ? 'statusbar'
        : n.kids.some(k => k.cls === 'qx-pane-light-opaque') && !n.cls ? 'header' : n.cls || 'div');
const kindOf = (w) => (w.props.decorator === 'pane-light-plain' ? 'section'
    : w === stabs.win.getChildControl('statusbar') ? 'statusbar'
        : w.kids.some(k => k.props.decorator === 'pane-light-opaque') ? 'header' : 'other');

// ─── Tests ───────────────────────────────────────────────────────────

test('window: TABS caption pattern, width, body padding, icon', () => {
    assert.match(textOf(caption), /^TABS: Statistic$/);
    assert.equal(stabs.win.args[0], 'STABS: Statistic');
    assert.equal(parseInt(dom.style.width, 10), 201);
    assert.equal(stabs.win.props.width, 201);
    assert.equal(body.style.padding, '0px 4px 3px');
    assert.deepEqual([stabs.win.props.contentPaddingTop, stabs.win.props.contentPadding, stabs.win.props.contentPaddingBottom], [0, 4, 3]);
    assert.equal(stabs.win.getChildControl('icon').props.width, 20);
});

test('blocks: same order and kind as the reference', () => {
    const ref = body.kids.map(KIND);
    assert.deepEqual(ref, ['section', 'header', 'section', 'header', 'section', 'header', 'section', 'section', 'statusbar']);
    assert.deepEqual(blocks.map(kindOf), ref);
});

test('section headers: texts from the game, 13 px bold with shadow', () => {
    const refHeaders = body.kids.filter(k => KIND(k) === 'header');
    const ours = blocks.filter(w => kindOf(w) === 'header');
    assert.deepEqual(ours.map(h => h.kids[1].props.value), refHeaders.map(textOf));
    for (const h of refHeaders) {
        const label = h.kids.find(k => k.text);
        assert.equal(label.style['font-size'], '13px');
        assert.equal(label.style['font-weight'], 'bold');
        assert.ok(label.style['text-shadow']);
    }
    for (const h of ours) assert.equal(h.kids[1].props.font, 'font_size_13_bold_shadow');
});

test('sections: a label column and two opaque columns; same rows, same hidden rows', () => {
    const refSections = body.kids.filter(k => KIND(k) === 'section');
    const ours = blocks.filter(w => kindOf(w) === 'section');
    assert.equal(ours.length, refSections.length);
    refSections.forEach((ref, i) => {
        const mine = ours[i];
        assert.equal(ref.kids.length, mine.kids.length, `section ${i}: parts`);
        assert.equal(ref.kids.filter(k => k.cls === 'qx-pane-light-opaque').length, 2);
        assert.equal(mine.kids.filter(k => k.props.decorator === 'pane-light-opaque').length, 2);
        const refRows = ref.kids[0].kids;
        const myRows = mine.kids[0].kids;
        assert.equal(myRows.length, refRows.length, `section ${i}: rows`);
        refRows.forEach((r, j) => {
            assert.equal(myRows[j].props.visibility === 'excluded', hidden(r), `section ${i} row ${j}: hidden`);
            const refImg = imgOf(r);
            const myIcon = myRows[j].props.show === 'icon' ? myRows[j].props.icon : null;
            assert.equal(!!myIcon, !!refImg, `section ${i} row ${j}: icon or text`);
            if (!refImg) assert.equal(myRows[j].props.value, textOf(r), `section ${i} row ${j}: text`);
        });
    });
});

test('images: one CDN file per game resource id, everywhere in the window', () => {
    const pairs = [];
    const walk = (ref, mine) => {
        // label columns of all sections, in order
        ref.kids[0].kids.forEach((r, j) => {
            const refImg = imgOf(r);
            if (refImg) pairs.push([refImg, mine.kids[0].kids[j].props.icon]);
        });
    };
    const refSections = body.kids.filter(k => KIND(k) === 'section');
    const ours = blocks.filter(w => kindOf(w) === 'section');
    refSections.forEach((ref, i) => walk(ref, ours[i]));
    // the outcome icon, the two column buttons, the window icon
    pairs.push([imgOf(refSections[0].kids[1].kids[1]), mod.IMG.victory]);
    const refButtons = refSections[4].kids[1].kids[0].kids;
    const myButtons = ours[4].kids[1].kids[0].kids;
    pairs.push([imgOf(refButtons[0]), myButtons[0].props.icon], [imgOf(refButtons[1]), myButtons[1].props.icon]);
    pairs.push([caption.kids.find(k => k.tag === 'img').src, stabs.win.args[1]]);
    const byHash = new Map();
    const byId = new Map();
    for (const [hash, id] of pairs) {
        assert.ok(hash && id, `${hash} / ${id}`);
        if (byHash.has(hash)) assert.equal(byHash.get(hash), id, `CDN file ${hash} used for two resources`);
        if (byId.has(id)) assert.equal(byId.get(id), hash, `resource ${id} shown as two files`);
        byHash.set(hash, id);
        byId.set(id, hash);
    }
    // crystal (repair + loot) and the simulate icon (label + button) share a file, as in the reference
    assert.equal(byId.get(mod.IMG.crystal), '61f096dde442bd3be1843a0929900194.png');
    assert.equal(byId.get(mod.IMG.simulate), 'fc8ca021be772b889a81648b64c4bc1c.png');
});

test('Defender values: same texts and colours as the reference', () => {
    const refCol = body.kids.filter(k => KIND(k) === 'section')[1].kids[1];
    const myCol = stabs.columns[0].cells.enemy;
    const refVisible = refCol.kids.filter(k => !hidden(k));
    const keys = ['overall', 'defense', 'structure', 'cy', 'df'];
    refVisible.forEach((r, i) => {
        assert.equal(myCol[keys[i]].props.value, r.text, keys[i]);
        assert.equal(hslToRgb(myCol[keys[i]].props.textColor), r.style.color, `${keys[i]} colour`);
    });
});

test('repair: the bottleneck glows, crystal at 100 % red', () => {
    const refCol = body.kids.filter(k => KIND(k) === 'section')[2].kids[1];
    assert.equal(refCol.kids[1].style['text-shadow'], '0px 0px 3pt');
    assert.equal(stabs.columns[0].cells.repair.overall.style['text-shadow'], '0 0 3pt');
    assert.ok(!stabs.columns[0].cells.repair.storage.style['text-shadow']);
    assert.equal(hslToRgb(stabs.columns[0].cells.repair.crystal.props.textColor), refCol.kids[2].style.color);
});

test('buttons: per column two 22×22 addpoints buttons, simulate then play; the label column only an icon', () => {
    const refSection = body.kids.filter(k => KIND(k) === 'section')[4];
    const mine = blocks.filter(w => kindOf(w) === 'section')[4];
    for (let c = 1; c <= 2; c++) {
        const refPair = refSection.kids[c].kids[0].kids;
        const myPair = mine.kids[c].kids[0].kids;
        assert.deepEqual(refPair.map(b => b.cls), ['qx-button-addpoints', 'qx-button-addpoints']);
        assert.deepEqual(refPair.map(b => [b.style.width, b.style.height]), [['22px', '22px'], ['22px', '22px']]);
        assert.deepEqual(myPair.map(b => b.props.appearance), ['button-addpoints', 'button-addpoints']);
        assert.deepEqual(myPair.map(b => [b.props.minWidth, b.props.maxHeight]), [[22, 22], [22, 22]]);
        assert.deepEqual(myPair.map(b => b.props.icon), [mod.IMG.simulate, mod.IMG.play]);
    }
    const label = mine.kids[0].kids[0];
    assert.equal(label.props.show, 'icon');
    assert.equal(Object.keys(label.listeners).length, 0, 'not clickable');
    assert.equal(refSection.kids[0].kids[0].kids[0].tag, 'img');
});

test('status bar: count left in light grey, Reset right in blue, underlined', () => {
    const ref = body.kids.find(k => k.cls === 'qx-window-statusbar');
    assert.equal(ref.kids[0].style.color, 'rgb(187, 187, 187)');
    assert.equal(ref.kids[1].text, 'Reset');
    assert.equal(ref.kids[1].style.color, 'rgb(17, 82, 116)');
    assert.equal(ref.kids[1].style['text-decoration'], 'underline');
    const bar = stabs.win.getChildControl('statusbar');
    const reset = bar.kids.find(k => k.props.value === 'Reset');
    assert.equal(reset.props.textColor, '#115274');
    assert.equal(reset.style['text-decoration'], 'underline');
    assert.equal(stabs.win.getChildControl('statusbar-text').props.textColor, '#BBBBBB');
    assert.equal(stabs.win.props.status, '1 simulations in cache');
});
