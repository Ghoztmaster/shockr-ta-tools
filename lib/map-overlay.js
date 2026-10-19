// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * map-overlay.js — shared helpers for DOM overlays on the world map
 * (base-info, attack-range). Same coordinate route as CampTracker:
 * VisMain.ScreenPosFromWorldPosX/Y on world pixels = cell * grid size,
 * elements appended to the game canvas' parent.
 *
 * CampTracker keeps its own copy of this logic (not refactored, by rule).
 */

/** True while the world map (region view) is shown. */
export function isWorldMapVisible() {
    try {
        const vis = ClientLib.Vis.VisMain.GetInstance();
        return vis.get_Mode() === ClientLib.Vis.Mode.Region;
    } catch {
        return false;
    }
}

/** Screen position (px, relative to the canvas) of a point inside cell (x, y). */
export function cellToScreen(x, y, fx = 0.5, fy = 0.5) {
    const visMain = ClientLib.Vis.VisMain.GetInstance();
    const region = visMain.get_Region();
    return {
        left: visMain.ScreenPosFromWorldPosX((x + fx) * region.get_GridWidth()),
        top: visMain.ScreenPosFromWorldPosY((y + fy) * region.get_GridHeight()),
    };
}

/** Size of the visible view in px. */
export function viewSize() {
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    return { width: region.get_ViewWidth(), height: region.get_ViewHeight() };
}

/**
 * Visible cell range (inclusive), from the region's top-left world position
 * and zoom - the same formula TA_CD_Compass uses for the view centre.
 * Clamped to `maxCells` per axis so a far zoom can't trigger a huge scan.
 */
export function visibleCellRange(margin = 1, maxCells = 80) {
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    const gw = region.get_GridWidth();
    const gh = region.get_GridHeight();
    const zoom = region.get_ZoomFactor() || 1;
    const x0 = region.get_PosX() / gw;
    const y0 = region.get_PosY() / gh;
    const w = Math.min(region.get_ViewWidth() / zoom / gw, maxCells);
    const h = Math.min(region.get_ViewHeight() / zoom / gh, maxCells);
    return {
        minX: Math.floor(x0) - margin,
        minY: Math.floor(y0) - margin,
        maxX: Math.ceil(x0 + w) + margin,
        maxY: Math.ceil(y0 + h) + margin,
    };
}

/** Append an overlay element next to the game canvas (CampTracker's spot). */
export function addToMap(el) {
    try {
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.parentElement && el.parentElement !== canvas.parentElement) {
            canvas.parentElement.appendChild(el);
        }
    } catch { /* ignore */ }
}

/**
 * Attach the region scroll/zoom/sector events + the cities change event.
 * @returns {Array} event records for detachMapEvents()
 */
export function attachMapEvents(owner, onMove, onData) {
    const events = [];
    const attach = (source, name, type, cb) => {
        try {
            webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, owner, cb);
            events.push({ source, name, type, cb });
        } catch { /* event not available in this client */ }
    };
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    attach(region, 'PositionChange', ClientLib.Vis.PositionChange, onMove);
    attach(region, 'ZoomFactorChange', ClientLib.Vis.ZoomFactorChange, onMove);
    attach(region, 'SectorUpdated', ClientLib.Vis.Region.SectorUpdated, onData);
    attach(ClientLib.Data.MainData.GetInstance().get_Cities(), 'Change', ClientLib.Data.CitiesChange, onData);
    return events;
}

export function detachMapEvents(owner, events) {
    for (const ev of events) {
        try {
            webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, owner, ev.cb);
        } catch { /* ignore */ }
    }
}

/** World object type for a player base (ClientLib enum, 1 as fallback). */
export function cityObjectType() {
    try {
        const t = ClientLib.Data.WorldSector.ObjectType.City;
        if (typeof t === 'number') return t;
    } catch { /* fall back */ }
    return 1;
}
