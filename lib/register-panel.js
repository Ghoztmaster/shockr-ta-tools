/**
 * register-panel.js — `/st register` enrollment popup.
 *
 * Same look as the help panel: centered, dark, closes via ✕ or Escape.
 * One password field (the enrollment code from the alliance chat) and a
 * Register button; the result (✅ / ❌ with reason) is shown in the panel.
 * After a successful registration the form disappears and the panel closes
 * itself after 2 s.
 *
 * No document-wide listeners: Escape is handled by a keydown listener on the
 * panel itself, and key events are stopped at the panel so the game doesn't
 * treat typing in the code field as hotkeys.
 */
import { t, escapeHtml } from './i18n.js';

const PANEL_ID = 'st-register-panel';
const CLOSE_DELAY_MS = 2000;
/** The chat CLI refocuses its input ~5 ms after a command — focus the field after that. */
const FOCUS_DELAY_MS = 50;

export class RegisterPanel {
    /**
     * @param {(code: string) => Promise<{ok: boolean, message: string, vars?: object}>} onSubmit
     *        — performs the enrollment; message is an i18n key
     */
    constructor(onSubmit) {
        this.onSubmit = onSubmit;
        this._panel = null;
        this._closeTimer = null;
    }

    isOpen() {
        return !!this._panel && document.body.contains(this._panel);
    }

    /** Show a fresh form (rebuilt each time so a previous result is gone). */
    open() {
        this.hide();
        this._panel = this._build();
        document.body.appendChild(this._panel);
        setTimeout(() => this._input && this._input.focus(), FOCUS_DELAY_MS);
    }

    hide() {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }
        if (this._panel) this._panel.remove();
        this._panel = null;
        this._input = null;
    }

    async _submit(form, button, status) {
        const code = this._input.value.trim();
        if (!code) {
            this._input.focus();
            return;
        }
        button.disabled = true;
        this._input.disabled = true;
        this._showStatus(status, t('registerBusy'), '#ccc');

        const panel = this._panel;
        const result = await this.onSubmit(code);
        if (panel !== this._panel) return; // closed meanwhile

        if (result.ok) {
            form.style.display = 'none';
            this._showStatus(status, t(result.message, result.vars), '#7c7');
            this._closeTimer = setTimeout(() => this.hide(), CLOSE_DELAY_MS);
        } else {
            this._showStatus(status, t(result.message, result.vars), '#f77');
            button.disabled = false;
            this._input.disabled = false;
            this._input.select();
            this._input.focus();
        }
    }

    _showStatus(el, text, color) {
        el.textContent = text;
        el.style.color = color;
        el.style.display = 'block';
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            width: 360px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px 14px 14px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
        // Keep keys inside the panel (game hotkeys); Escape closes.
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
        close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
        close.addEventListener('mouseleave', () => { close.style.color = '#999'; });

        const title = document.createElement('div');
        title.innerHTML = `<b style="color:#8cf;font-size:13px">${escapeHtml(t('registerTitle'))}</b>`;
        title.style.marginBottom = '8px';

        const form = document.createElement('form');
        form.autocomplete = 'off';

        const intro = document.createElement('div');
        intro.textContent = t('registerIntro');
        intro.style.cssText = 'color:#aaa;margin-bottom:10px;';

        const label = document.createElement('label');
        label.textContent = t('registerCode');
        label.style.cssText = 'display:block;margin-bottom:4px;';

        const input = document.createElement('input');
        input.type = 'password';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 100;
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;font-size:12px;';
        label.htmlFor = input.id = `${PANEL_ID}-code`;

        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = t('registerButton');
        button.style.cssText = 'margin-top:10px;padding:5px 16px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;';

        const status = document.createElement('div');
        status.style.cssText = 'display:none;margin-top:10px;font-weight:bold;';

        form.append(intro, label, input, button);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this._submit(form, button, status);
        });

        panel.append(close, title, form, status);
        this._input = input;
        return panel;
    }
}
