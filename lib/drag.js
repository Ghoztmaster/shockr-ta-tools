// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * drag.js — drag a fixed-position element by a handle, position kept in Config (5.26.0).
 *
 * The element is positioned with left/top in px. A press that moves less than
 * DRAG_THRESHOLD_PX is a click: `onClick` runs, nothing is saved. A real drag
 * saves `<prefix>.x` / `<prefix>.y` on release and swallows the click that
 * follows, so dragging a button does not also open it.
 *
 * The document mousemove/mouseup listeners only exist during a drag.
 */

const DRAG_THRESHOLD_PX = 4;

/** Keep at least this much of the element on screen. */
const MIN_VISIBLE_PX = 24;

/** Saved position for `prefix`, or `fallback` ({x, y} in px). */
export function loadPosition(config, prefix, fallback) {
    const x = Number(config.get(`${prefix}.x`));
    const y = Number(config.get(`${prefix}.y`));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
}

/** {x, y} clamped so the element stays reachable in a w×h viewport. */
export function clampPosition(pos, size, viewport) {
    const maxX = Math.max(0, viewport.w - Math.min(size.w, MIN_VISIBLE_PX));
    const maxY = Math.max(0, viewport.h - Math.min(size.h, MIN_VISIBLE_PX));
    return {
        x: Math.round(Math.min(Math.max(0, pos.x), maxX)),
        y: Math.round(Math.min(Math.max(0, pos.y), maxY)),
    };
}

/**
 * @param {HTMLElement} el      — positioned element (style.left/top)
 * @param {HTMLElement} handle  — what the player grabs (el itself for a button)
 * @param {object} opts
 * @param {object} opts.config
 * @param {string} opts.prefix  — config key prefix, e.g. 'toolbar'
 * @param {Function} [opts.onClick]
 * @param {Function} [opts.onMove] — after each move (e.g. to reposition a popup)
 */
export function makeDraggable(el, handle, { config, prefix, onClick, onMove }) {
    handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = el.getBoundingClientRect();
        let dragging = false;

        const move = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            dragging = true;
            const pos = clampPosition({ x: rect.left + dx, y: rect.top + dy },
                { w: rect.width, h: rect.height }, { w: window.innerWidth, h: window.innerHeight });
            el.style.left = `${pos.x}px`;
            el.style.top = `${pos.y}px`;
            if (onMove) onMove();
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if (dragging) {
                config.set(`${prefix}.x`, parseInt(el.style.left, 10));
                config.set(`${prefix}.y`, parseInt(el.style.top, 10));
            } else if (onClick) {
                onClick();
            }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();   // no text selection while dragging
    });
}
