// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * tunnel-info.js — level, required offense and influence range of the tunnels
 * on the world map (replaces CnCTA SoO "TA Tunnel Info", which only showed
 * tunnel markers while the "move base" tool was active).
 *
 * Per tunnel in view: a label `T42 · ≥39` (tunnel level, offense level needed
 * to activate it) and a dashed circle of the tunnel's influence range.
 * Green = your strongest base's offense reaches the required level, red = not.
 *
 * Data (the same TA Tunnel Info reads):
 *   region.GetObjectFromPosition(x * gw, y * gh)   — vis object per cell
 *     get_VisObjectType() === RegionPointOfInterest and get_Type() === 0 = tunnel
 *     get_RawX/get_RawY, get_Level()
 *   server.get_POIActivationLevelDifference()     — required = level − this
 *   Influence range: the alliance announcement tag `[tir]N[/tir]` (single digit,
 *   TA Tunnel Info's own convention), else 6.
 *
 * Differences from TA Tunnel Info, on purpose:
 *   - Offense compared = the MAX get_LvlOffense() over your own bases. TA
 *     Tunnel Info used the base being moved; outside move mode there is none.
 *   - "Which target levels the tunnel spawns" is NOT shown: the client data TA
 *     Tunnel Info reads carries no such field and no getter for it is known.
 *     Not estimated.
 *
 * Only while the world map is shown; scroll/zoom repositions, sector changes
 * rescan, plus a 2 s interval (view mode, newly loaded sectors).
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, visibleCellRange,
    addToMap, attachMapEvents, detachMapEvents,
} from '../lib/map-overlay.js';

const REFRESH_MS = 5000;
const DEFAULT_INFLUENCE_RANGE = 6;
const COLOR_ACTIVE = '#06ff00';
const COLOR_BLOCKED = '#ff3600';
const TIR_TAG = /\[tir\]([0-9])\[\/tir\]/;

/** Influence range from the alliance announcement's [tir]N[/tir] tag, else 6. */
export function parseInfluenceRange(announcement) {
    const m = typeof announcement === 'string' ? announcement.match(TIR_TAG) : null;
    const n = m ? parseInt(m[1], 10) : NaN;
    return n > 0 ? n : DEFAULT_INFLUENCE_RANGE;
}

/** Offense level needed to activate a tunnel of `level`. */
export function requiredOffense(level, activationDiff) {
    return level - (Number(activationDiff) || 0);
}

/** Label text: `T42 · ≥39`. */
export function labelText(level, required) {
    return `T${fmt(level)} · ≥${fmt(required)}`;
}

/** Tunnel colour: green when the offense reaches the required level. */
export function tunnelColor(offense, required) {
    return offense >= required ? COLOR_ACTIVE : COLOR_BLOCKED;
}

function fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** '#06ff00' + alpha → 'rgba(6,255,0,a)'. */
function rgba(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Bounding box (px) of a circle of `range` cells around the centre of cell (x, y). */
function circleBox(x, y, range) {
    const c = cellToScreen(x, y, 0.5, 0.5);
    const e = cellToScreen(x + range, y + range, 0.5, 0.5);
    const rx = Math.abs(e.left - c.left);
    const ry = Math.abs(e.top - c.top);
    return { left: c.left - rx, top: c.top - ry, width: 2 * rx, height: 2 * ry };
}

function readInfluenceRange() {
    try {
        return parseInfluenceRange(ClientLib.Data.MainData.GetInstance().get_Alliance().get_Announcement());
    } catch {
        return DEFAULT_INFLUENCE_RANGE;
    }
}

function readActivationDiff() {
    try {
        return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_POIActivationLevelDifference()) || 0;
    } catch {
        return 0;
    }
}

/** Highest offense level over the own bases (0 if unreadable). */
function maxOwnOffense() {
    let max = 0;
    try {
        const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
        for (const city of Object.values(all)) {
            try {
                const off = Number(city.get_LvlOffense());
                if (off > max) max = off;
            } catch { /* skip */ }
        }
    } catch { /* none */ }
    return max;
}

export class TunnelInfo {
    /** Short description for `/st help`. */
    get description() { return t('descTunnelInfo'); }

    constructor(config) {
        this.name = 'TunnelInfo';
        this.config = config;
        this.running = false;
        this.tunnels = new Map();   // "x:y" -> { label, circle, x, y }
        this._events = [];
        this._interval = null;
        this._raf = null;
    }

    async start() {
        this.running = true;
        try {
            this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
        } catch { this._events = []; }
        this._interval = setInterval(() => this.update(), REFRESH_MS);
        this.update();
        console.log('[ST] TunnelInfo: started');
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
        for (const tn of this.tunnels.values()) {
            tn.label.remove();
            tn.circle.remove();
        }
        this.tunnels.clear();
    }

    /** Tunnels in the visible cell range: [{x, y, level}]. */
    collect() {
        const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
        const gw = region.get_GridWidth();
        const gh = region.get_GridHeight();
        const poiType = ClientLib.Vis.VisObject.EObjectType.RegionPointOfInterest;
        const range = visibleCellRange();
        const found = new Map();
        for (let y = range.minY; y <= range.maxY; y++) {
            for (let x = range.minX; x <= range.maxX; x++) {
                try {
                    const obj = region.GetObjectFromPosition(x * gw, y * gh);
                    if (!obj || obj.get_VisObjectType() !== poiType || obj.get_Type() !== 0) continue;
                    const tx = obj.get_RawX();
                    const ty = obj.get_RawY();
                    const key = `${tx}:${ty}`;
                    if (!found.has(key)) found.set(key, { x: tx, y: ty, level: Number(obj.get_Level()) });
                } catch { /* skip this cell */ }
            }
        }
        return Array.from(found.entries());
    }

    /** Rescan and render; never throws. */
    update() {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            const influence = readInfluenceRange();
            const diff = readActivationDiff();
            const offense = maxOwnOffense();
            const keep = new Set();
            for (const [key, tunnel] of this.collect()) {
                keep.add(key);
                let tn = this.tunnels.get(key);
                if (!tn) {
                    tn = { label: this._createLabel(), circle: this._createCircle(), x: tunnel.x, y: tunnel.y };
                    this.tunnels.set(key, tn);
                }
                const required = requiredOffense(tunnel.level, diff);
                const color = tunnelColor(offense, required);
                tn.range = influence;
                tn.label.textContent = labelText(tunnel.level, required);
                tn.label.style.color = color;
                tn.label.title = t('tunnelInfoTitle', { level: fmt(tunnel.level), required: fmt(required), range: influence });
                tn.circle.style.borderColor = rgba(color, 0.6);
                tn.circle.style.background = rgba(color, 0.05);
                this._place(tn);
            }
            for (const [key, tn] of this.tunnels) {
                if (!keep.has(key)) {
                    tn.label.remove();
                    tn.circle.remove();
                    this.tunnels.delete(key);
                }
            }
        } catch (e) {
            console.warn('[ST] TunnelInfo: update failed', e);
        }
    }

    _reposition() {
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            for (const tn of this.tunnels.values()) this._place(tn);
        } catch { /* ignore */ }
    }

    _place(tn) {
        const view = viewSize();
        const pos = cellToScreen(tn.x, tn.y, 0.1, 0.1);
        const labelOn = !(pos.top < 0 || pos.left < 0 || pos.top > view.height || pos.left > view.width);
        if (labelOn) {
            tn.label.style.left = pos.left + 'px';
            tn.label.style.top = pos.top + 'px';
            addToMap(tn.label);
        } else if (tn.label.parentElement) {
            tn.label.remove();
        }
        // Circle only for tunnels on screen (keeps the overlay light)
        if (!labelOn || !(tn.range > 0)) {
            if (tn.circle.parentElement) tn.circle.remove();
            return;
        }
        const box = circleBox(tn.x, tn.y, tn.range);
        Object.assign(tn.circle.style, {
            left: box.left + 'px',
            top: box.top + 'px',
            width: box.width + 'px',
            height: box.height + 'px',
        });
        addToMap(tn.circle);
    }

    _createLabel() {
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
        el.className = 'st-tunnel-info';
        return el;
    }

    _createCircle() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: '8',
            borderRadius: '50%',
            borderWidth: '2px',
            borderStyle: 'dashed',
            boxSizing: 'border-box',
        });
        el.className = 'st-tunnel-range';
        return el;
    }
}
