/**
 * kill-info.js — plunder value tooltip in battle view.
 *
 * Shows tiberium + crystal loot per defense unit on hover.
 * Uses GAMEDATA for unit data and discovers the repair-cost function
 * via code-pattern matching (survives client obfuscation shifts).
 *
 * Discovery: searches $I for a function containing 'Type==8||i.Type==7'
 * which is the get_UnitLevelRepairRequirements signature.
 */
import { chatMessage } from '../lib/main.js';

/** Discovered repair-cost function: $I.<cls>.prototype.<method> */
let repairFn = null;

/** Tooltip DOM element */
let tooltip = null;

/** Currently hovered unit element */
let hoveredUnit = null;

export class KillInfo {
    constructor() {
        this.name = 'KillInfo';
    }

    async start() {
        // Discover the repair-cost function
        repairFn = discoverRepairFunction();
        if (!repairFn) {
            console.warn('[ST] KillInfo: repair function not found — plunder tooltips disabled');
            chatMessage('[ST] ⚠ KillInfo: repair function not found in this client version');
            return;
        }
        console.log('[ST] KillInfo: repair function found');

        // Create tooltip element
        createTooltip();

        // Hook into battle view mouse events
        hookBattleView();
    }
}

/**
 * Discover the repair-cost function by scanning $I for the known pattern.
 * The function contains 'Type==8||i.Type==7' and 'BGCBLL' in its source.
 */
function discoverRepairFunction() {
    const patterns = ['Type==8', 'Type==7', '.push('];

    for (const cls of Object.keys($I)) {
        try {
            const proto = $I[cls] && $I[cls].prototype;
            if (!proto) continue;

            for (const key of Object.getOwnPropertyNames(proto)) {
                if (typeof proto[key] !== 'function') continue;
                const src = proto[key].toString();
                if (src.length < 100 || src.length > 500) continue;

                if (patterns.every(p => src.includes(p))) {
                    console.log(`[ST] KillInfo: found repair fn at $I.${cls}.${key}`);
                    return { cls, key, fn: proto[key] };
                }
            }
        } catch {}
    }

    return null;
}

/**
 * Discover the AHVOTQ-equivalent function that computes repair costs
 * from GAMEDATA. Pattern: contains '.Type' + '.Count' + 'push' + 'switch'.
 */
function discoverCalcFunction() {
    for (const cls of Object.keys($I)) {
        try {
            const obj = $I[cls];
            if (!obj || typeof obj !== 'object') continue;

            // Check static methods
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] !== 'function') continue;
                const src = obj[key].toString();
                if (src.includes('FoundBaseTiberium') && src.includes('.Type') && src.includes('.Count')) {
                    return obj[key];
                }
            }
        } catch {}
    }
    return null;
}

/**
 * Get plunder for a unit using the discovered function or GAMEDATA fallback.
 * @returns {{ tib: number, cry: number }} or null
 */
function getPlunder(unitId, level) {
    const gd = (typeof GAMEDATA !== 'undefined') && GAMEDATA.units && GAMEDATA.units[unitId];
    if (!gd) return null;

    // Try the AHVOTQ-style static function (searches $I.UQLRSW or equivalent)
    try {
        const calcFn = findCalcFn();
        if (calcFn) {
            const result = calcFn(level, gd);
            if (result && result.length > 0) {
                let tib = 0, cry = 0;
                for (const r of result) {
                    if (r.Type === 1) tib = r.Count;
                    if (r.Type === 6) cry = r.Count;
                }
                return { tib, cry };
            }
        }
    } catch {}

    // Fallback: try GAMEDATA.r directly
    try {
        if (gd.r) {
            const maxKey = Math.min(level, Math.max(...Object.keys(gd.r).map(Number)));
            const entry = gd.r[maxKey];
            if (entry && entry.rr) {
                let tib = 0, cry = 0;
                for (const r of entry.rr) {
                    if (r.t === 2) tib = r.c;
                    if (r.t === 5) cry = r.c;
                }
                if (tib || cry) return { tib, cry };
            }
        }
    } catch {}

    return null;
}

/** Cached calc function reference */
let _calcFn = undefined;
function findCalcFn() {
    if (_calcFn !== undefined) return _calcFn;

    // Search for the static function that takes (level, gamedata) and returns [{Type, Count}]
    for (const cls of Object.keys($I)) {
        try {
            const obj = $I[cls];
            if (!obj || typeof obj !== 'function') continue;

            for (const key of Object.keys(obj)) {
                if (typeof obj[key] !== 'function') continue;
                const src = obj[key].toString();
                // AHVOTQ pattern: contains Type==8, Type==9, Type==10, push, length
                if (src.includes('Type==8') && src.includes('Type==9') && src.includes('push') && src.length < 500) {
                    _calcFn = obj[key];
                    console.log(`[ST] KillInfo: calc fn at $I.${cls}.${key}`);
                    return _calcFn;
                }
            }
        } catch {}
    }

    _calcFn = null;
    return null;
}

/** Create the tooltip DOM element. */
function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.id = 'st-killinfo-tooltip';
    tooltip.style.cssText = `
        display: none;
        position: fixed;
        z-index: 99999;
        background: rgba(0, 0, 0, 0.9);
        color: #ccc;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 6px 10px;
        font-family: 'Segoe UI', Tahoma, sans-serif;
        font-size: 12px;
        pointer-events: none;
        white-space: nowrap;
    `;
    document.body.appendChild(tooltip);
}

/** Hook mouse events on the battle view canvas/units. */
function hookBattleView() {
    // Poll for battle view units — the game dynamically creates them
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousemove', onMouseMove, true);
}

function onMouseOver(e) {
    // Look for a unit element in the battle view
    const unitEl = findUnitElement(e.target);
    if (!unitEl) return;

    const unitData = getUnitFromElement(unitEl);
    if (!unitData) return;

    const plunder = getPlunder(unitData.id, unitData.level);
    if (!plunder) return;

    hoveredUnit = unitEl;
    showTooltip(e, unitData.name, unitData.level, plunder);
}

function onMouseOut(e) {
    if (hoveredUnit) {
        hideTooltip();
        hoveredUnit = null;
    }
}

function onMouseMove(e) {
    if (hoveredUnit && tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 10) + 'px';
    }
}

/**
 * Walk up from the event target to find a unit widget in battle view.
 * Battle units have a data attribute or class that identifies them.
 */
function findUnitElement(el) {
    // Walk up max 5 levels looking for a unit container
    let current = el;
    for (let i = 0; i < 5 && current; i++) {
        // qooxdoo widgets with unit data
        try {
            const widget = qx.ui.core.Widget.getWidgetByElement(current);
            if (widget && hasUnitData(widget)) return current;
        } catch {}
        current = current.parentElement;
    }
    return null;
}

/**
 * Check if a qooxdoo widget represents a battle unit.
 */
function hasUnitData(widget) {
    try {
        // Try common patterns for unit widgets
        if (widget.getUserData && widget.getUserData('unit')) return true;
        if (widget.getUnit) return true;
        // Check for MdbUnitId on the widget or its model
        const proto = Object.getPrototypeOf(widget);
        for (const key of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[key] === 'function' && key.includes('nit')) return true;
        }
    } catch {}
    return false;
}

/**
 * Extract unit ID and level from a unit element.
 */
function getUnitFromElement(el) {
    try {
        const widget = qx.ui.core.Widget.getWidgetByElement(el);
        if (!widget) return null;

        // Try getUserData pattern
        let unit = widget.getUserData && widget.getUserData('unit');

        // Try getUnit pattern
        if (!unit && widget.getUnit) unit = widget.getUnit();

        // Walk widget properties for anything with get_MdbUnitId
        if (!unit) {
            const proto = Object.getPrototypeOf(widget);
            for (const key of Object.getOwnPropertyNames(proto)) {
                if (typeof proto[key] !== 'function') continue;
                try {
                    const val = widget[key]();
                    if (val && typeof val === 'object' && val.get_MdbUnitId) {
                        unit = val;
                        break;
                    }
                } catch {}
            }
        }

        if (!unit || !unit.get_MdbUnitId) return null;

        const id = unit.get_MdbUnitId();
        const level = unit.get_CurrentLevel();
        const gd = GAMEDATA.units[id];
        const name = gd ? gd.dn : 'Unit ' + id;

        return { id, level, name };
    } catch {
        return null;
    }
}

function showTooltip(e, name, level, plunder) {
    if (!tooltip) return;

    let html = `<b>${name}</b> Lv${level}<br>`;
    if (plunder.tib > 0) html += `<span style="color:#8bc34a">⬢</span> ${plunder.tib.toLocaleString()} Tib<br>`;
    if (plunder.cry > 0) html += `<span style="color:#42a5f5">◆</span> ${plunder.cry.toLocaleString()} Crystal`;
    if (plunder.tib === 0 && plunder.cry === 0) html += '<span style="color:#666">No plunder</span>';

    tooltip.innerHTML = html;
    tooltip.style.left = (e.clientX + 15) + 'px';
    tooltip.style.top = (e.clientY + 10) + 'px';
    tooltip.style.display = 'block';
}

function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
}
