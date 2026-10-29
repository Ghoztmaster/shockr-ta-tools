// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * base-info.js — offense/defense level + per-player number on player bases
 * on the world map (replaces CnCTA SoO "CENTER DRIVEN Base Info", which
 * only showed the levels in the selected base's info panel).
 *
 * Label per player base in view, at CampTracker's marker spot (top-left of
 * the cell; CampTracker only marks FG camps/outposts, so they never share a
 * cell): `#2 23.4/21.0` = base number of that player, offense/defense level.
 *
 * - Only player bases (world object Type City), never Forgotten bases/camps.
 * - Owner: the region vis object's get_PlayerId() (5.31.0). The world object's
 *   patched $PlayerId was a small index, not the player id (seen live), so
 *   bases of different players could share a numbering.
 * - Numbering: city id ascending (lower id = founded earlier). Own bases:
 *   the complete list from get_AllCities(). Other players: the client has no
 *   cheap "all bases of player X" list, so the number reflects the bases of
 *   that player SEEN SO FAR this session (scrolling the map can renumber).
 * - Offense/defense: region/world objects don't carry them; they come from
 *   cities.GetCity(id).get_LvlOffense()/get_LvlDefense(), which only answers
 *   for bases the client loaded (own bases always, foreign bases after you
 *   selected them once). Unknown → just `#2`. Known values are cached for
 *   the session.
 * - Only while the world map is shown; scroll/zoom repositions, sector or
 *   cities changes rescan, plus a 2 s interval (mode check + newly loaded data).
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, visibleCellRange,
    addToMap, attachMapEvents, detachMapEvents, cityObjectType,
} from '../lib/map-overlay.js';

const REFRESH_MS = 2000;
const OWN_COLOR = '#00bcd4';
const OTHER_COLOR = '#ffcc80';

/** Label text: `#n` plus `off/def` when known. */
export function labelText(number, levels) {
    if (!levels) return `#${number}`;
    return `#${number} ${levels.off.toFixed(1)}/${levels.def.toFixed(1)}`;
}

/** 1-based position of `id` in the ascending id list. */
export function baseNumber(ids, id) {
    const sorted = Array.from(ids).sort((a, b) => a - b);
    return sorted.indexOf(id) + 1;
}

/** Owner player id of a base's region vis object, null if unknown. */
export function visPlayerId(vis) {
    try {
        const id = vis && typeof vis.get_PlayerId === 'function' ? Number(vis.get_PlayerId()) : NaN;
        return id > 0 ? id : null;
    } catch {
        return null;
    }
}

export class BaseInfo {
    /** Short description for `/st help`. */
    get description() { return t('descBaseInfo'); }

    constructor(config) {
        this.name = 'BaseInfo';
        this.config = config;
        this.running = false;
        this.labels = new Map();      // cityId -> { el, x, y }
        this.levels = new Map();      // cityId -> { off, def }
        this.seen = new Map();        // playerId -> Set(cityId)
        this._events = [];
        this._interval = null;
        this._raf = null;
    }

    async start() {
        this.running = true;
        this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
        this._interval = setInterval(() => this.update(), REFRESH_MS);
        this.update();
        console.log('[ST] BaseInfo: started');
    }

    stop() {
        this.running = false;
        detachMapEvents(this, this._events);
        this._events = [];
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
        this._clear();
    }

    _schedule() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            this.update();
        });
    }

    _clear() {
        for (const { el } of this.labels.values()) el.remove();
        this.labels.clear();
    }

    /**
     * Player bases in view with number and levels.
     * @returns {Array<{id, x, y, own, number, levels}>}
     */
    collect() {
        const md = ClientLib.Data.MainData.GetInstance();
        const world = md.get_World();
        const cities = md.get_Cities();
        const cityType = cityObjectType();
        const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
        const gw = region.get_GridWidth();
        const gh = region.get_GridHeight();

        let ownPlayerId = null;
        try { ownPlayerId = md.get_Player().id; } catch { /* unknown */ }
        let ownIds = [];
        try {
            ownIds = Object.values(cities.get_AllCities().d).map(c => c.get_Id());
        } catch { /* none */ }

        const range = visibleCellRange();
        const found = [];
        for (let y = range.minY; y <= range.maxY; y++) {
            for (let x = range.minX; x <= range.maxX; x++) {
                try {
                    const obj = world.GetObjectFromPosition(x, y);
                    if (!obj || obj.Type !== cityType) continue;
                    if (typeof obj.$Id === 'undefined') continue;
                    const id = obj.$Id;
                    const playerId = visPlayerId(region.GetObjectFromPosition(x * gw, y * gh));
                    const own = ownIds.includes(id) || (ownPlayerId !== null && playerId === ownPlayerId);
                    if (!own) {
                        if (!this.seen.has(playerId)) this.seen.set(playerId, new Set());
                        this.seen.get(playerId).add(id);
                    }
                    found.push({ id, x, y, own, playerId });
                } catch { /* skip this cell */ }
            }
        }

        for (const base of found) {
            base.number = base.own
                ? baseNumber(ownIds.includes(base.id) ? ownIds : [...ownIds, base.id], base.id)
                : baseNumber(this.seen.get(base.playerId), base.id);
            this._readLevels(cities, base.id);
            base.levels = this.levels.get(base.id) || null;
        }
        return found;
    }

    _readLevels(cities, id) {
        try {
            const city = cities.GetCity(id);
            if (!city) return;
            const off = Number(city.get_LvlOffense());
            const def = Number(city.get_LvlDefense());
            if (off > 0) this.levels.set(id, { off, def: def > 0 ? def : 0 });
        } catch { /* not loaded */ }
    }

    /** Rescan and render; never throws. */
    update() {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            const bases = this.collect();
            const keep = new Set();
            for (const base of bases) {
                keep.add(base.id);
                let label = this.labels.get(base.id);
                if (!label) {
                    label = { el: this._createElement(), x: base.x, y: base.y };
                    this.labels.set(base.id, label);
                }
                label.x = base.x;
                label.y = base.y;
                const el = label.el;
                el.textContent = labelText(base.number, base.levels);
                el.style.color = base.own ? OWN_COLOR : OTHER_COLOR;
                el.title = base.levels
                    ? t('baseInfoTitle', { off: base.levels.off.toFixed(2), def: base.levels.def.toFixed(2) })
                    : t('baseInfoUnknown');
                this._place(label);
            }
            for (const [id, label] of this.labels) {
                if (!keep.has(id)) {
                    label.el.remove();
                    this.labels.delete(id);
                }
            }
        } catch (e) {
            console.warn('[ST] BaseInfo: update failed', e);
        }
    }

    _reposition() {
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            for (const label of this.labels.values()) this._place(label);
        } catch { /* ignore */ }
    }

    _place(label) {
        const { left, top } = cellToScreen(label.x, label.y, 0.1, 0.1);
        const view = viewSize();
        if (top < 0 || left < 0 || top > view.height || left > view.width) {
            if (label.el.parentElement) label.el.remove();
            return;
        }
        label.el.style.left = left + 'px';
        label.el.style.top = top + 'px';
        addToMap(label.el);
    }

    _createElement() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: '10',
            fontFamily: 'Iosevka Term',
            fontWeight: 'bold',
            fontSize: '12px',
            padding: '1px 4px',
            borderRadius: '3px',
            background: 'rgba(0,0,0,0.75)',
            whiteSpace: 'nowrap',
        });
        el.setAttribute('data-st-baseinfo', '1');
        return el;
    }
}
