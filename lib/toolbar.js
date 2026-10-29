// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * toolbar.js — one shared Shockr button that opens a grid with every panel (5.26.0).
 *
 * Replaces the per-plugin floating buttons (UpgradeCalc had its own "UC").
 * A lib module, not a plugin: always there, cannot be disabled. With nothing
 * registered the grid still shows the "Config" button, so export/import is
 * always reachable. 5.28.0: a "Plugins" button above it opens the plugin panel
 * (lib/plugin-panel.js), when onPlugins is given.
 *
 *   toolbar.register({ id, icon, label, onClick, isAvailable })
 *     icon        — inline SVG string (stroke/fill currentColor)
 *     label       — tooltip; a function is called each time the grid opens (i18n)
 *     isAvailable — optional; false hides the item (e.g. no server configured)
 *   toolbar.unregister(id)   — a plugin's stop()
 *
 * The main button is draggable (position in toolbar.x / toolbar.y). Click toggles
 * the grid; a click outside it, Escape or clicking an item closes it. The
 * document listeners for that only exist while the grid is open.
 *
 * Colours: the game's blue buttons (dark blue gradient, light rim, cyan icon).
 */
import { t } from './i18n.js';
import { makeDraggable, loadPosition, clampPosition } from './drag.js';

const BUTTON_ID = 'st-toolbar-button';
const GRID_ID = 'st-toolbar-grid';

/** Just below where the UC button used to sit (left 80, top 10). */
const DEFAULT_POSITION = { x: 80, y: 46 };
const BUTTON_SIZE = 40;
const ITEM_SIZE = 40;
const GAP = 4;
const COLUMNS = 2;

const ICON_COLOR = '#4fc3f7';
const BUTTON_CSS = `
    box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(to bottom, #1a4a6e, #0d2a40);
    color: ${ICON_COLOR};
    border: 1px solid #5f8fb4;
    border-radius: 4px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 1px 3px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
`;

/** Icons: 24×24 viewBox, currentColor. */
export const ICONS = {
    shield: '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10.5-4.6-1.7-8-5.5-8-10.5v-6z"/><path d="M13.2 6.5L9 13h3l-1.2 4.8L15 11h-3z" fill="currentColor" stroke="none"/></svg>',
    calc: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="4" rx="0.5"/><path d="M8.5 13h1M12 13h0M15.5 13h0M8.5 16.5h0M12 16.5h0M15.5 16.5h0" stroke-width="2.4" stroke-linecap="round"/></svg>',
    help: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.2"/><circle cx="12" cy="17.6" r="0.6" fill="currentColor"/></svg>',
    sim: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5l9.5 9.5M3.5 3.5h3l9 9M20 3.5L10.5 13M20.5 3.5h-3l-9 9"/><path d="M6.5 15.5l2 2M15.5 15.5l-2 2M4.5 19.5l3-3M19.5 19.5l-3-3"/></svg>',
    radar: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 22s-7-7.2-7-12.5a7 7 0 0 1 14 0C19 14.8 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.6" fill="currentColor" stroke="none"/></svg>',
    tunnel: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2.5 21.5v-9a9.5 9.5 0 0 1 19 0v9z"/><path d="M7 21.5v-8a5 5 0 0 1 10 0v8"/><path d="M12 17.5v4" stroke-linecap="round"/></svg>',
};

export class Toolbar {
    /**
     * @param {object} config
     * @param {object} opts
     * @param {Function} opts.onConfig — the "Config" button (export/import panel)
     * @param {Function} [opts.onPlugins] — the "Plugins" button (plugin panel)
     */
    constructor(config, { onConfig, onPlugins }) {
        this.config = config;
        this._onConfig = onConfig;
        this._onPlugins = onPlugins || null;
        this._items = [];
        this._button = null;
        this._grid = null;
        this._onDocDown = (e) => {
            if (this._grid && this._grid.contains(e.target)) return;
            if (this._button && this._button.contains(e.target)) return;   // the button's own click toggles
            this.close();
        };
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    /** Add a grid item; the same id again replaces it in place. */
    register(item) {
        const i = this._items.findIndex(x => x.id === item.id);
        if (i >= 0) this._items[i] = item;
        else this._items.push(item);
        if (this.isOpen()) this._renderGrid();
    }

    unregister(id) {
        this._items = this._items.filter(i => i.id !== id);
        if (this.isOpen()) this._renderGrid();
    }

    /** Items the grid shows now (isAvailable() false → hidden). */
    visibleItems() {
        return this._items.filter(i => {
            try {
                return !i.isAvailable || i.isAvailable();
            } catch {
                return false;
            }
        });
    }

    /** Create the main button (once the game UI is up). */
    start() {
        if (this._button && document.body.contains(this._button)) return;
        const pos = clampPosition(loadPosition(this.config, 'toolbar', DEFAULT_POSITION),
            { w: BUTTON_SIZE, h: BUTTON_SIZE }, { w: window.innerWidth, h: window.innerHeight });

        const btn = document.createElement('div');
        btn.id = BUTTON_ID;
        btn.title = 'Shockr TA Tools';
        btn.innerHTML = ICONS.shield;
        btn.style.cssText = `${BUTTON_CSS}
            position: fixed; left: ${pos.x}px; top: ${pos.y}px; z-index: 9999;
            width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px;`;
        hover(btn);
        document.body.appendChild(btn);
        this._button = btn;
        makeDraggable(btn, btn, {
            config: this.config,
            prefix: 'toolbar',
            onClick: () => this.toggle(),
            onMove: () => { if (this.isOpen()) this._placeGrid(); },
        });
    }

    isOpen() {
        return !!this._grid && this._grid.style.display !== 'none';
    }

    /** The main button's rect (panels opened from the grid anchor to it); null before start(). */
    anchorRect() {
        return this._button ? this._button.getBoundingClientRect() : null;
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        if (!this._grid || !document.body.contains(this._grid)) {
            const grid = document.createElement('div');
            grid.id = GRID_ID;
            grid.style.cssText = `
                position: fixed; z-index: 10001; box-sizing: border-box;
                padding: ${GAP}px; background: rgba(10, 25, 38, 0.92);
                border: 1px solid #3d6a8c; border-radius: 4px; pointer-events: auto;`;
            document.body.appendChild(grid);
            this._grid = grid;
        }
        this._renderGrid();
        this._grid.style.display = 'block';
        this._placeGrid();
        document.addEventListener('mousedown', this._onDocDown, true);
        document.addEventListener('keydown', this._onKeyDown);
    }

    close() {
        document.removeEventListener('mousedown', this._onDocDown, true);
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._grid) this._grid.style.display = 'none';
    }

    _renderGrid() {
        const grid = this._grid;
        grid.innerHTML = '';

        const cells = document.createElement('div');
        cells.style.cssText = `display: grid; grid-template-columns: repeat(${COLUMNS}, ${ITEM_SIZE}px); gap: ${GAP}px;`;
        for (const item of this.visibleItems()) {
            const cell = document.createElement('div');
            cell.innerHTML = item.icon;
            cell.title = typeof item.label === 'function' ? item.label() : item.label;
            cell.style.cssText = `${BUTTON_CSS} width: ${ITEM_SIZE}px; height: ${ITEM_SIZE}px;`;
            hover(cell);
            cell.addEventListener('click', () => this._run(item.onClick));
            cells.appendChild(cell);
        }
        if (cells.childElementCount) grid.appendChild(cells);

        if (this._onPlugins) grid.appendChild(this._wideButton(t('toolbarPlugins'), t('toolbarPluginsHint'), this._onPlugins));
        grid.appendChild(this._wideButton(t('toolbarConfig'), t('toolbarConfigHint'), this._onConfig));
    }

    /** A full-width text button under the icons ("Plugins", "Config"). */
    _wideButton(label, hint, onClick) {
        const btn = document.createElement('div');
        btn.textContent = label;
        btn.title = hint;
        btn.style.cssText = `${BUTTON_CSS}
            width: ${COLUMNS * ITEM_SIZE + (COLUMNS - 1) * GAP}px; height: 24px;
            margin-top: ${this._grid.childElementCount ? GAP : 0}px;
            font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; font-weight: bold;`;
        hover(btn);
        btn.addEventListener('click', () => this._run(onClick));
        return btn;
    }

    /** Below the button, or above it when there is no room; kept inside the viewport. */
    _placeGrid() {
        const b = this._button.getBoundingClientRect();
        const g = this._grid.getBoundingClientRect();
        let top = b.bottom + GAP;
        if (top + g.height > window.innerHeight) top = Math.max(0, b.top - GAP - g.height);
        const left = Math.min(Math.max(0, b.left), Math.max(0, window.innerWidth - g.width));
        this._grid.style.left = `${Math.round(left)}px`;
        this._grid.style.top = `${Math.round(top)}px`;
    }

    _run(fn) {
        this.close();
        try {
            if (fn) fn();
        } catch (err) {
            console.error('[ST] Toolbar: item failed', err);
        }
    }
}

function hover(el) {
    el.addEventListener('mouseenter', () => { el.style.borderColor = '#9fd4f5'; el.style.color = '#b3e5fc'; });
    el.addEventListener('mouseleave', () => { el.style.borderColor = '#5f8fb4'; el.style.color = ICON_COLOR; });
}
