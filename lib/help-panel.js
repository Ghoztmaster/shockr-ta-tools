/**
 * help-panel.js — `/st help` as a popup panel (help.popup = true, default).
 *
 * Same look as the KillInfo / UpgradeCalc panels, but centered on screen so it
 * doesn't cover the game buttons bottom right. One panel at a time: a second
 * `/st help` closes it. Closes via ✕, `/st help` or Escape.
 *
 * The Escape listener is only attached while the panel is open and removed
 * on close (it never stops the event, so the game still sees the key).
 */
import { t } from './i18n.js';

const PANEL_ID = 'st-help-panel';

/**
 * Scoped to the panel: fixed command column so every table lines up
 * (sub-lists are indented 10px, so 10px narrower); on narrow screens each
 * row stacks — command, then description below it.
 */
const PANEL_CSS = `
#${PANEL_ID} td.st-cmd { width: 230px; }
#${PANEL_ID} table.st-sub { margin-left: 10px; }
#${PANEL_ID} table.st-sub td.st-cmd { width: 220px; }
@media (max-width: 600px) {
    #${PANEL_ID} tr, #${PANEL_ID} td { display: block; }
    #${PANEL_ID} td.st-cmd, #${PANEL_ID} table.st-sub td.st-cmd { width: auto; padding-top: 4px; }
    #${PANEL_ID} td.st-cmd + td { padding-left: 12px; }
}
`;

export class HelpPanel {
    constructor() {
        this._panel = null;
        this._content = null;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.hide();
        };
    }

    isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    /** Close if open, otherwise show `html`. */
    toggle(html) {
        if (this.isOpen()) {
            this.hide();
            return;
        }
        this._ensurePanel();
        this._content.innerHTML = html;
        this._close.title = t('close');
        this._panel.style.display = 'block';
        this._panel.scrollTop = 0;
        document.addEventListener('keydown', this._onKeyDown);
    }

    hide() {
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._panel) this._panel.style.display = 'none';
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return this._panel;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            display: none;
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            width: 580px;
            max-width: calc(100vw - 16px);
            max-height: 80vh;
            overflow: auto;
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px 14px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;

        const close = document.createElement('div');
        close.textContent = '✕';
        close.style.cssText = 'position:sticky;top:0;float:right;cursor:pointer;color:#999;font-size:14px;line-height:1;padding:2px 0 4px 8px;';
        close.addEventListener('click', () => this.hide());
        close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
        close.addEventListener('mouseleave', () => { close.style.color = '#999'; });

        const content = document.createElement('div');

        const style = document.createElement('style');
        style.textContent = PANEL_CSS;

        panel.appendChild(style);
        panel.appendChild(close);
        panel.appendChild(content);
        document.body.appendChild(panel);
        this._panel = panel;
        this._content = content;
        this._close = close;
        return panel;
    }
}
