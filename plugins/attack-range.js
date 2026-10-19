// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * attack-range.js — dashed circle around each own base on the world map,
 * showing which targets are within attack range.
 *
 * Radius = the server's MaxAttackDistance (cells), Euclidean — the same
 * range city-util.getObjectsNearCity uses for "in range". Note: the work
 * order described the radius as "based on the base's offense level"; in TA
 * the attack range is a server constant, independent of offense level, so
 * the constant is used (it is the range the game itself enforces).
 *
 * Only shown on the world map (region view); hidden in base/battle views.
 * Updates on scroll/zoom, on cities change, and every 2 s (view mode, a
 * moved or new base).
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, addToMap,
    attachMapEvents, detachMapEvents,
} from '../lib/map-overlay.js';

const REFRESH_MS = 2000;

/** Own bases as [{ id, x, y }]. */
export function ownBases() {
    const out = [];
    try {
        const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
        for (const city of Object.values(all)) {
            try {
                out.push({ id: city.get_Id(), x: city.get_PosX(), y: city.get_PosY() });
            } catch { /* skip unreadable base */ }
        }
    } catch { /* no cities */ }
    return out;
}

/** Attack range in cells, or null if unreadable. */
export function attackRange() {
    try {
        const r = Number(ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance());
        return r > 0 ? r : null;
    } catch {
        return null;
    }
}

/**
 * Screen geometry of a range circle: centre + radii per axis (px).
 * @returns {{left, top, width, height}} the circle's bounding box
 */
export function circleBox(x, y, range) {
    const c = cellToScreen(x, y, 0.5, 0.5);
    const e = cellToScreen(x + range, y + range, 0.5, 0.5);
    const rx = Math.abs(e.left - c.left);
    const ry = Math.abs(e.top - c.top);
    return { left: c.left - rx, top: c.top - ry, width: 2 * rx, height: 2 * ry };
}

export class AttackRange {
    /** Short description for `/st help`. */
    get description() { return t('descAttackRange'); }

    constructor(config) {
        this.name = 'AttackRange';
        this.config = config;
        this.defaultEnabled = true;
        this.running = false;
        this.circles = new Map();   // cityId -> { el, x, y }
        this._events = [];
        this._interval = null;
        this._range = null;
        this._onMove = () => this._reposition();
        this._onData = () => this._update();
    }

    async start() {
        this.running = true;
        this._range = attackRange();
        try {
            this._events = attachMapEvents(this, this._onMove, this._onData);
        } catch { this._events = []; }
        this._interval = setInterval(() => this._update(), REFRESH_MS);
        this._update();
        console.log(`[ST] AttackRange: started (range ${this._range ?? '?'})`);
    }

    stop() {
        this.running = false;
        detachMapEvents(this, this._events);
        this._events = [];
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        for (const [, c] of this.circles) c.el.remove();
        this.circles.clear();
    }

    /** Sync the circle set with the own bases, then position them. */
    _update() {
        if (!this.running) return;
        try {
            if (!this._range) this._range = attackRange();
            const bases = ownBases();
            const keep = new Set();
            for (const b of bases) {
                keep.add(b.id);
                const existing = this.circles.get(b.id);
                if (existing) {
                    existing.x = b.x;
                    existing.y = b.y;
                } else {
                    this.circles.set(b.id, { el: this._createEl(), x: b.x, y: b.y });
                }
            }
            for (const [id, c] of this.circles) {
                if (!keep.has(id)) {
                    c.el.remove();
                    this.circles.delete(id);
                }
            }
            this._reposition();
        } catch (e) {
            console.warn('[ST] AttackRange: update failed', e);
        }
    }

    _createEl() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: '9',
            borderRadius: '50%',
            border: '2px dashed rgba(255,152,0,0.85)',
            background: 'rgba(255,152,0,0.06)',
            boxSizing: 'border-box',
        });
        el.className = 'st-attack-range';
        return el;
    }

    /** Position every circle; hide all off the world map or off-screen. */
    _reposition() {
        if (!this.running) return;
        try {
            const visible = isWorldMapVisible() && this._range;
            const view = visible ? viewSize() : null;
            for (const [, c] of this.circles) {
                if (!visible) {
                    if (c.el.parentElement) c.el.remove();
                    continue;
                }
                const box = circleBox(c.x, c.y, this._range);
                const offScreen = box.left + box.width < 0 || box.top + box.height < 0
                    || box.left > view.width || box.top > view.height;
                if (offScreen) {
                    if (c.el.parentElement) c.el.remove();
                    continue;
                }
                Object.assign(c.el.style, {
                    left: box.left + 'px',
                    top: box.top + 'px',
                    width: box.width + 'px',
                    height: box.height + 'px',
                });
                if (!c.el.parentElement) addToMap(c.el);
            }
        } catch (e) {
            console.warn('[ST] AttackRange: reposition failed', e);
        }
    }
}
