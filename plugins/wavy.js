// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * wavy.js — Forgotten attack-wave info per base (replaces TA Wavy 0.6.2).
 *
 * In the region info panel of the selected object (own / alliance / enemy
 * base, Forgotten base, camp, ruin - the same six status-info widgets TA Wavy
 * extends, added at the same spot: appended at the bottom of that widget):
 *
 *   Wavy
 *   Forgotten bases within attack range: 34 (31) · 2 waves
 *   Levels: 2×31, 2×30, 4×29, 1×28
 *
 * Rules, exactly as TA Wavy:
 *   - only Forgotten BASES count (world object Type NPCBase) - camps and
 *     outposts never send attack waves, so TA Wavy leaves them out too; a
 *     destroyed base is a ruin (another Type), so it never counts
 *   - range = server get_MaxAttackDistance(), Euclidean, inclusive
 *   - the number in brackets = bases within floor(range); THAT number sets
 *     the waves: <= 21 → 1, <= 31 → 2, <= 41 → 3, <= 51 → 4, else 5
 *     (the same thresholds MehrStrom verified live, GAME_CLIENT_API §13)
 *   - levels = the base's level ($Level, patched in clientlib-patch.js)
 * Results are cached per position for CACHE_MS.
 *
 * Distance lines (TA Wavy has none; the work order asks for them): while the
 * info panel of a selected object is open on the world map, a line from that
 * object to each own base within LINE_RANGE cells, with the distance (1
 * decimal) at the midpoint. SVG overlay next to the canvas, pointer-events
 * none; follows scroll/zoom; gone when the panel closes or off the world map.
 *
 * Not copied from TA Wavy: its notification hook that MARKS defence reports
 * as read - Shockr never touches the inbox.
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, addToMap,
    attachMapEvents, detachMapEvents,
} from '../lib/map-overlay.js';

const CACHE_MS = 30 * 1000;
const LINE_RANGE = 50;              // own bases within this many cells get a line
const LINE_COLOR = '#00bcd4';       // own-base cyan, as PlayerStatus/BaseInfo
const SVG_NS = 'http://www.w3.org/2000/svg';

/** English fallback for the panel texts (used when a key is missing from i18n.js). */
const FALLBACK = {
    wavyTitle: 'Wavy',
    wavyCount: 'Forgotten bases within attack range: {count} ({countW}) · {waves} waves',
    wavyCountOne: 'Forgotten bases within attack range: {count} ({countW}) · 1 wave',
    wavyLevels: 'Levels: {levels}',
};

/** t() with the FALLBACK text when the key is not translated (t returns the key itself). */
function tr(key, vars) {
    const s = t(key, vars);
    if (s !== key || !(key in FALLBACK)) return s;
    return FALLBACK[key].replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] !== undefined ? String(vars[name]) : m));
}

/** The status-info widgets TA Wavy extends (webfrontend.gui.region.*). */
const STATUS_INFOS = [
    'RegionCityStatusInfoOwn',
    'RegionCityStatusInfoAlliance',
    'RegionCityStatusInfoEnemy',
    'RegionNPCBaseStatusInfo',
    'RegionNPCCampStatusInfo',
    'RegionRuinStatusInfo',
];

/** Waves from the number of Forgotten bases within floor(range) (TA Wavy's table). */
export function wavesFor(count) {
    if (count <= 21) return 1;
    if (count <= 31) return 2;
    if (count <= 41) return 3;
    if (count <= 51) return 4;
    return 5;
}

/** {level: count} → "2×31, 2×30, 4×29" (highest level first), '-' when empty. */
export function formatLevels(levels) {
    const keys = Object.keys(levels).map(Number).sort((a, b) => b - a);
    if (!keys.length) return '-';
    return keys.map(l => `${levels[l]}×${l}`).join(', ');
}

/** World object type for a Forgotten base (ClientLib enum, 2 as fallback). */
function npcBaseType() {
    try {
        const v = ClientLib.Data.WorldSector.ObjectType.NPCBase;
        if (typeof v === 'number') return v;
    } catch { /* fall back */ }
    return 2;
}

/** Level of a Forgotten base world object: patched $Level, else get_BaseLevel(). */
function baseLevel(obj) {
    if (typeof obj.$Level === 'number') return obj.$Level;
    try {
        if (typeof obj.get_BaseLevel === 'function') return Number(obj.get_BaseLevel());
    } catch { /* unknown */ }
    return null;
}

/**
 * Forgotten bases around (x, y), TA Wavy's scan.
 * @returns {{count: number, countW: number, waves: number, levels: Object<number, number>}}
 */
export function scanWaves(world, x, y, range) {
    const type = npcBaseType();
    const floored = Math.floor(range);
    const reach = floored + 1;
    const levels = {};
    let count = 0;
    let countW = 0;
    for (let sx = x - reach; sx <= x + reach; sx++) {
        for (let sy = y - reach; sy <= y + reach; sy++) {
            const dist = Math.hypot(x - sx, y - sy);
            if (dist > range) continue;
            let obj;
            try { obj = world.GetObjectFromPosition(sx, sy); } catch { continue; }
            if (!obj || obj.Type !== type) continue;
            count++;
            if (dist <= floored) countW++;
            const level = baseLevel(obj);
            if (level !== null && Number.isFinite(level)) levels[level] = (levels[level] || 0) + 1;
        }
    }
    return { count, countW, waves: wavesFor(countW), levels };
}

/** Own bases as [{x, y}]. */
function ownBases() {
    const out = [];
    try {
        for (const c of Object.values(ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d)) {
            try { out.push({ x: c.get_PosX(), y: c.get_PosY() }); } catch { /* skip */ }
        }
    } catch { /* none */ }
    return out;
}

/** Own bases within LINE_RANGE of (x, y), excluding (x, y) itself, with their distance. */
export function lineTargets(x, y, bases, range = LINE_RANGE) {
    return bases
        .filter(b => !(b.x === x && b.y === y))
        .map(b => ({ ...b, dist: Math.hypot(b.x - x, b.y - y) }))
        .filter(b => b.dist <= range);
}

export class Wavy {
    /** Short description for `/st help`. */
    get description() { return t('descWavy'); }

    constructor(config) {
        this.name = 'Wavy';
        // its info-panel block only renders on the panel's next appear: a live enable says so
        this.appearsOnSelect = true;
        this.config = config;
        this.running = false;
        this._cache = new Map();       // "x:y" -> {at, result}
        this._listeners = [];          // {widget, id}
        this._panel = null;            // qx container + labels
        this._selected = null;         // {x, y} of the object whose panel is open
        this._svg = null;
        this._events = [];
        this._warned = false;
    }

    async start() {
        this.running = true;
        this._hookPanels();
        try {
            this._events = attachMapEvents(this, () => this._drawLines(), () => this._drawLines());
        } catch { this._events = []; }
        console.log('[ST] Wavy: started');
    }

    stop() {
        this.running = false;
        for (const { widget, id } of this._listeners) {
            try { widget.removeListenerById(id); } catch { /* ignore */ }
        }
        this._listeners = [];
        if (this._panel) {
            try {
                const parent = this._panel.container.getLayoutParent();
                if (parent) parent.remove(this._panel.container);
                this._panel.container.dispose();
            } catch { /* ignore */ }
            this._panel = null;
        }
        detachMapEvents(this, this._events);
        this._events = [];
        this._selected = null;
        this._removeSvg();
        this._cache.clear();
    }

    /** Wave info for a position, cached CACHE_MS. */
    info(x, y, now = Date.now()) {
        const key = `${x}:${y}`;
        const hit = this._cache.get(key);
        if (hit && now - hit.at < CACHE_MS) return hit.result;
        const md = ClientLib.Data.MainData.GetInstance();
        const range = Number(md.get_Server().get_MaxAttackDistance());
        const result = scanWaves(md.get_World(), x, y, range);
        this._cache.set(key, { at: now, result });
        if (this._cache.size > 200) this._cache.delete(this._cache.keys().next().value);
        return result;
    }

    // ─── Info panel ──────────────────────────────────────────────────

    _warn(msg, e) {
        if (this._warned) return;
        this._warned = true;
        console.warn(`[ST] Wavy: ${msg}`, e && e.message ? e.message : '');
    }

    _hookPanels() {
        let region;
        try {
            region = webfrontend.gui.region;
        } catch (e) {
            this._warn('region info widgets not available — panel disabled', e);
            return;
        }
        for (const name of STATUS_INFOS) {
            try {
                const cls = region && region[name];
                if (!cls || typeof cls.getInstance !== 'function') continue;
                const widget = cls.getInstance();
                const appear = widget.addListener('appear', () => this._onAppear(widget), this);
                const disappear = widget.addListener('disappear', () => this._onDisappear(widget), this);
                this._listeners.push({ widget, id: appear }, { widget, id: disappear });
            } catch (e) {
                this._warn(`could not hook ${name}`, e);
            }
        }
    }

    /** Position of the object whose info panel is shown: the selection, else the panel's own object. */
    _panelObject(widget) {
        try {
            const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
            if (sel && typeof sel.get_RawX === 'function') return { x: sel.get_RawX(), y: sel.get_RawY() };
        } catch { /* try the panel */ }
        try {
            const parent = widget.getLayoutParent();
            const obj = parent && typeof parent.getObject === 'function' ? parent.getObject() : null;
            if (obj) return { x: obj.get_RawX(), y: obj.get_RawY() };
        } catch { /* unknown */ }
        return null;
    }

    _onAppear(widget) {
        if (!this.running) return;
        try {
            const pos = this._panelObject(widget);
            if (!pos) return;
            const panel = this._ensurePanel();
            if (!panel) return;
            const r = this.info(pos.x, pos.y);
            panel.title.setValue(tr('wavyTitle'));
            panel.count.setValue(tr(r.waves === 1 ? 'wavyCountOne' : 'wavyCount',
                { count: r.count, countW: r.countW, waves: r.waves }));
            panel.levels.setValue(tr('wavyLevels', { levels: formatLevels(r.levels) }));
            widget.add(panel.container);   // a qx widget has one parent: this moves it
            this._selected = pos;
            this._drawLines();
        } catch (e) {
            this._warn('panel update failed', e);
        }
    }

    _onDisappear(widget) {
        try {
            if (this._panel && this._panel.container.getLayoutParent() !== widget) return;
        } catch { /* clear anyway */ }
        this._selected = null;
        this._drawLines();
    }

    _ensurePanel() {
        if (this._panel) return this._panel;
        try {
            const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
                marginTop: 6, textColor: 'text-region-tooltip',
            });
            const title = new qx.ui.basic.Label('Wavy').set({ font: 'font_size_14', textColor: 'text-region-value' });
            const count = new qx.ui.basic.Label('');
            const levels = new qx.ui.basic.Label('').set({ textColor: 'text-region-value' });
            box.add(title);
            box.add(count);
            box.add(levels);
            this._panel = { container: box, title, count, levels };
        } catch (e) {
            this._warn('could not build the panel', e);
        }
        return this._panel;
    }

    // ─── Distance lines ──────────────────────────────────────────────

    _removeSvg() {
        if (this._svg) {
            try { this._svg.remove(); } catch { /* ignore */ }
            this._svg = null;
        }
    }

    /** (Re)draw the lines from the selected object to nearby own bases; never throws. */
    _drawLines() {
        if (!this.running) return;
        try {
            if (!this._selected || !isWorldMapVisible()) {
                this._removeSvg();
                return;
            }
            const { x, y } = this._selected;
            const targets = lineTargets(x, y, ownBases());
            if (!targets.length) {
                this._removeSvg();
                return;
            }
            const view = viewSize();
            const svg = this._svg || document.createElementNS(SVG_NS, 'svg');
            this._svg = svg;
            while (svg.firstChild) svg.removeChild(svg.firstChild);
            svg.setAttribute('width', String(view.width));
            svg.setAttribute('height', String(view.height));
            svg.setAttribute('data-st-wavy', '1');
            Object.assign(svg.style, {
                position: 'absolute', left: '0px', top: '0px',
                pointerEvents: 'none', zIndex: '9', overflow: 'visible',
            });
            const from = cellToScreen(x, y);
            for (const b of targets) {
                const to = cellToScreen(b.x, b.y);
                const line = document.createElementNS(SVG_NS, 'line');
                line.setAttribute('x1', String(from.left));
                line.setAttribute('y1', String(from.top));
                line.setAttribute('x2', String(to.left));
                line.setAttribute('y2', String(to.top));
                line.setAttribute('stroke', LINE_COLOR);
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '6 4');
                svg.appendChild(line);
                const text = document.createElementNS(SVG_NS, 'text');
                text.setAttribute('x', String((from.left + to.left) / 2));
                text.setAttribute('y', String((from.top + to.top) / 2));
                text.setAttribute('fill', LINE_COLOR);
                text.setAttribute('font-size', '13');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('stroke', 'rgba(0,0,0,0.8)');
                text.setAttribute('stroke-width', '3');
                text.setAttribute('paint-order', 'stroke');
                text.textContent = b.dist.toFixed(1);
                svg.appendChild(text);
            }
            addToMap(svg);
        } catch (e) {
            this._warn('drawing distance lines failed', e);
        }
    }
}
