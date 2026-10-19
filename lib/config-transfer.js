// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * config-transfer.js — `/st config export` / `/st config import` (5.24.0).
 *
 * The config lives in the game page's localStorage, which is per game server
 * (cncappXX host): a world on another host starts with an empty config. Export
 * shows the whole config as one line of text (incl. the personal key, so the
 * player does not have to register again); import puts it back on the other
 * host. Imported keys overwrite, other local keys stay.
 *
 * Format: {"st-config":{...}} - a bare {...} object is accepted too.
 *
 * Panel: same look as the register popup (centered, dark, ✕ / Escape), key
 * events stay inside the panel so typing is not taken as game hotkeys.
 */
import { t, escapeHtml } from './i18n.js';
import { copyText } from './register-panel.js';

const PANEL_ID = 'st-config-transfer-panel';
const FORMAT_KEY = 'st-config';
/** The chat CLI refocuses its input ~5 ms after a command — focus the field after that. */
const FOCUS_DELAY_MS = 50;

/** One line of text with the whole config. */
export function exportConfig(data) {
    return JSON.stringify({ [FORMAT_KEY]: data || {} });
}

/**
 * Parse an export. @returns {{ok: true, data: object}} with lower-case keys
 * (as Config stores them), or {ok: false} for anything else / an empty config.
 */
export function parseImport(text) {
    let obj;
    try {
        obj = JSON.parse(String(text || '').trim());
    } catch {
        return { ok: false };
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && FORMAT_KEY in obj) obj = obj[FORMAT_KEY];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
    const data = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) continue;
        data[k.toLowerCase()] = v;
    }
    return Object.keys(data).length ? { ok: true, data } : { ok: false };
}

/** Merge parsed data into the config and save once. @returns number of keys imported */
export function applyImport(config, data) {
    for (const [k, v] of Object.entries(data)) config.data[k] = v;
    config.save();
    return Object.keys(data).length;
}

export class ConfigTransferPanel {
    constructor() {
        this._panel = null;
    }

    hide() {
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** 5.26.0: the toolbar's "Config" button - choose Export or Import. */
    openMenu({ onExport, onImport }) {
        const { panel, body } = this._open(t('configMenuTitle'));
        body.append(this._note(t('configMenuIntro')));
        const exp = this._button(t('configMenuExport'));
        exp.addEventListener('click', () => onExport());
        const imp = this._button(t('configMenuImport'));
        imp.addEventListener('click', () => onImport());
        body.append(this._row(exp, imp, this._closeButton()));
        return panel;
    }

    /** Read-only text of the config + Copy. */
    openExport(text) {
        const { panel, body } = this._open(t('configExportTitle'));
        body.append(this._note(t('configExportIntro')), this._note(t('configExportSecret'), '#fb5'));
        const area = this._area(text, true);
        const feedback = this._feedback();
        const copy = this._button(t('copy'));
        copy.addEventListener('click', async () => {
            const ok = await copyText(text, area);
            feedback.textContent = t(ok ? 'copied' : 'copyFailed');
            feedback.style.color = ok ? '#7c7' : '#f77';
            if (!ok) area.select();
        });
        body.append(area, this._row(copy, this._closeButton()), feedback);
        setTimeout(() => { area.focus(); area.select(); }, FOCUS_DELAY_MS);
        return panel;
    }

    /**
     * Empty text field + Import. onImport(text) returns the chat/panel result:
     * {ok: boolean, message: string} (message already translated).
     */
    openImport(onImport) {
        const { panel, body } = this._open(t('configImportTitle'));
        body.append(this._note(t('configImportIntro')));
        const area = this._area('', false);
        const feedback = this._feedback();
        const go = this._button(t('configImportButton'));
        go.addEventListener('click', () => {
            const result = onImport(area.value);
            feedback.textContent = result.message;
            feedback.style.color = result.ok ? '#7c7' : '#f77';
            if (result.ok) {
                area.disabled = true;
                go.disabled = true;
            }
        });
        body.append(area, this._row(go, this._closeButton()), feedback);
        setTimeout(() => area.focus(), FOCUS_DELAY_MS);
        return panel;
    }

    _open(titleText) {
        this.hide();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
            z-index: 10000; width: 440px; max-width: calc(100vw - 16px); box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92); color: #ddd; border: 1px solid #444; border-radius: 4px;
            padding: 10px 14px 14px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px;
            pointer-events: auto;
        `;
        for (const type of ['keydown', 'keyup', 'keypress']) {
            panel.addEventListener(type, (e) => {
                e.stopPropagation();
                if (type === 'keydown' && e.key === 'Escape') this.hide();
            });
        }
        const close = document.createElement('div');
        close.textContent = '✕';
        close.title = t('close');
        close.style.cssText = 'float:right;cursor:pointer;color:#999;font-size:14px;line-height:1;padding:2px 0 4px 8px;';
        close.addEventListener('click', () => this.hide());
        const title = document.createElement('div');
        title.innerHTML = `<b style="color:#8cf;font-size:13px">${escapeHtml(titleText)}</b>`;
        title.style.marginBottom = '8px';
        const body = document.createElement('div');
        panel.append(close, title, body);
        document.body.appendChild(panel);
        this._panel = panel;
        return { panel, body };
    }

    _note(text, color = '#aaa') {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = `color:${color};margin-bottom:8px;line-height:1.4;`;
        return el;
    }

    _area(value, readOnly) {
        const area = document.createElement('textarea');
        area.value = value;
        area.readOnly = readOnly;
        area.spellcheck = false;
        area.rows = 6;
        area.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:11px;resize:vertical;word-break:break-all;';
        if (readOnly) area.addEventListener('focus', () => area.select());
        return area;
    }

    _button(text) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = 'padding:5px 12px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;';
        return b;
    }

    _closeButton() {
        const b = this._button(t('close'));
        b.style.background = '#444';
        b.style.borderColor = '#666';
        b.addEventListener('click', () => this.hide());
        return b;
    }

    _row(...buttons) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
        row.append(...buttons);
        return row;
    }

    _feedback() {
        const el = document.createElement('div');
        el.style.cssText = 'min-height:16px;margin-top:6px;font-size:12px;font-weight:bold;';
        return el;
    }
}
