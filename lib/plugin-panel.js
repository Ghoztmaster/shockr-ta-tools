// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * plugin-panel.js — the "Plugins" panel behind the toolbar's Plugins button (5.28.0).
 *
 * One row per plugin (name, short description, on/off switch), in /st help and
 * info-page order. A switch does what `/st plugin enable|disable` does,
 * including the chat line (PluginManager.setEnabled). The gear swaps the list
 * for a checklist of which plugins the panel shows (`/st menu add|remove`).
 *
 * Short descriptions: config/plugins.json `short` (the info page's texts),
 * baked in by build.js as __ST_PLUGIN_SHORT__ = { name: {en, de, nl} }.
 * Without it (tests) the plugin's own description is used.
 *
 * Opens under (or above) the toolbar button; the list scrolls once it is
 * taller than the room on screen. A click outside, Escape or ✕ closes it.
 */
import { t, getLanguage } from './i18n.js';

/* global __ST_PLUGIN_SHORT__ */
const SHORT = typeof __ST_PLUGIN_SHORT__ === 'object' && __ST_PLUGIN_SHORT__ ? __ST_PLUGIN_SHORT__ : {};

const PANEL_ID = 'st-plugin-panel';
const PANEL_WIDTH = 320;
const MAX_LIST_HEIGHT = 480;
const MARGIN = 8;
const GAP = 4;
/** Header + padding around the list, for the room calculation. */
const CHROME_HEIGHT = 40;

/** Short description in the active language. */
export function shortText(plugin) {
    const s = SHORT[plugin.name];
    return (s && (s[getLanguage()] || s.en)) || plugin.description || '';
}

/**
 * Room for the list: below the anchor, or above it when there is more room
 * there. Pure, for tests.
 * @returns {{ below: boolean, maxHeight: number }}
 */
export function placement(anchor, viewportHeight) {
    const below = viewportHeight - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const useBelow = below >= above || below >= MAX_LIST_HEIGHT + CHROME_HEIGHT;
    const room = (useBelow ? below : above) - CHROME_HEIGHT;
    return { below: useBelow, maxHeight: Math.max(80, Math.min(MAX_LIST_HEIGHT, room)) };
}

export class PluginPanel {
    /**
     * @param {import('./plugin-manager.js').PluginManager} manager
     * @param {Function} getAnchor — the toolbar button's DOMRect (or null)
     */
    constructor(manager, getAnchor) {
        this.manager = manager;
        this._getAnchor = getAnchor;
        this._panel = null;
        this._list = null;
        this._title = null;
        this._gear = null;
        this._editing = false;   // gear mode: the show/hide checklist
        this._onDocDown = (e) => {
            if (this._panel && this._panel.contains(e.target)) return;
            this.close();
        };
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        if (!this._panel || !document.body.contains(this._panel)) this._build();
        this._editing = false;
        this._panel.style.display = 'block';
        this.render();
        this._place();
        document.addEventListener('mousedown', this._onDocDown, true);
        document.addEventListener('keydown', this._onKeyDown);
    }

    close() {
        document.removeEventListener('mousedown', this._onDocDown, true);
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._panel) this._panel.style.display = 'none';
    }

    /** Redraw the rows (after a toggle, or a `/st menu` / `/st plugin` change while open). */
    render() {
        if (!this.isOpen()) return;
        this._title.textContent = t(this._editing ? 'pluginPanelEditTitle' : 'pluginPanelTitle');
        this._gear.title = t(this._editing ? 'pluginPanelDone' : 'pluginPanelEdit');
        this._gear.dataset.active = this._editing ? '1' : '';
        this._gear.style.color = this._editing ? '#4fc3f7' : '#999';
        this._list.innerHTML = '';
        if (this._editing) {
            for (const p of this.manager.offered()) this._list.appendChild(this._checkRow(p));
        } else {
            const shown = this.manager.menuPlugins();
            for (const p of shown) this._list.appendChild(this._toggleRow(p));
            if (!shown.length) {
                const empty = document.createElement('div');
                empty.textContent = t('pluginPanelEmpty');
                empty.style.cssText = 'padding:8px 2px;color:#999;';
                this._list.appendChild(empty);
            }
        }
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        // Same look as the help / TargetBoard panels
        panel.style.cssText = `
            display: none;
            position: fixed;
            z-index: 10001;
            width: ${PANEL_WIDTH}px;
            max-width: calc(100vw - ${2 * MARGIN}px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px 6px;user-select:none;border-bottom:1px solid #333;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1;min-width:0;font-weight:bold;';
        const gear = headerButton('⚙', () => {
            this._editing = !this._editing;
            this.render();
        });
        gear.style.fontSize = '15px';
        const close = headerButton('✕', () => this.close());
        close.title = t('close');
        header.append(title, gear, close);

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto;padding:2px 6px 6px;';

        panel.append(header, list);
        document.body.appendChild(panel);
        this._panel = panel;
        this._list = list;
        this._title = title;
        this._gear = gear;
    }

    _toggleRow(plugin) {
        const row = rowElement(plugin);
        const sw = switchElement(!!plugin.running);
        sw.title = t(plugin.running ? 'pluginPanelTurnOff' : 'pluginPanelTurnOn');
        let busy = false;
        sw.addEventListener('click', async () => {
            if (busy) return;
            busy = true;
            sw.style.opacity = '0.5';
            try {
                await this.manager.setEnabled(plugin, !plugin.running);
            } finally {
                this.render();
            }
        });
        row.appendChild(sw);
        return row;
    }

    _checkRow(plugin) {
        const row = rowElement(plugin);
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = this.manager.inMenu(plugin);
        box.title = t('pluginPanelShow');
        box.style.cssText = 'flex:none;margin:0;cursor:pointer;';
        box.addEventListener('change', () => this.manager.setInMenu(plugin, box.checked));
        row.insertBefore(box, row.firstChild);
        return row;
    }

    _place() {
        const a = this._getAnchor && this._getAnchor();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (!a) {
            this._list.style.maxHeight = `${MAX_LIST_HEIGHT}px`;
            this._panel.style.left = `${MARGIN}px`;
            this._panel.style.top = `${MARGIN}px`;
            return;
        }
        const { below, maxHeight } = placement(a, vh);
        this._list.style.maxHeight = `${maxHeight}px`;
        const h = this._panel.getBoundingClientRect().height;
        const top = below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - h);
        const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, vw - PANEL_WIDTH - MARGIN));
        this._panel.style.left = `${Math.round(left)}px`;
        this._panel.style.top = `${Math.round(top)}px`;
    }
}

function headerButton(text, onClick) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'cursor:pointer;color:#999;font-size:14px;line-height:1;';
    b.addEventListener('click', onClick);
    b.addEventListener('mouseenter', () => { b.style.color = '#fff'; });
    b.addEventListener('mouseleave', () => { b.style.color = b.dataset.active ? '#4fc3f7' : '#999'; });
    return b;
}

/** Name + short description; the full description as tooltip. */
function rowElement(plugin) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid #2e2e2e;';
    row.title = plugin.description || '';
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;line-height:1.3;';
    const name = document.createElement('div');
    name.textContent = plugin.name;
    name.style.cssText = 'color:#e0e0e0;';
    const short = document.createElement('div');
    short.textContent = shortText(plugin);
    short.style.cssText = 'color:#999;font-size:11px;';
    text.append(name, short);
    row.appendChild(text);
    return row;
}

/** A small on/off switch (green = on). */
function switchElement(on) {
    const sw = document.createElement('div');
    sw.style.cssText = `
        flex: none; position: relative; box-sizing: border-box;
        width: 30px; height: 16px; border-radius: 8px; cursor: pointer;
        background: ${on ? '#2e7d32' : '#444'};
        border: 1px solid ${on ? '#4caf50' : '#666'};`;
    const knob = document.createElement('div');
    knob.style.cssText = `
        position: absolute; top: 1px; left: ${on ? 15 : 1}px;
        width: 12px; height: 12px; border-radius: 50%;
        background: ${on ? '#c8e6c9' : '#aaa'};`;
    sw.appendChild(knob);
    return sw;
}
