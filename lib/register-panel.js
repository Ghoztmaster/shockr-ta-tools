/**
 * register-panel.js — `/st register` enrollment popup.
 *
 * Same look as the help panel: centered, dark, closes via ✕ or Escape.
 * One password field (the enrollment code from the alliance chat) and a
 * Register button; the result (✅ / ❌ with reason) is shown in the panel.
 * After a successful registration the form makes way for the personal key in a
 * read-only field with a Copy button (the player needs it to log in to the
 * website). The panel then stays open until Close / ✕ / Escape — never on a
 * timer, so the key can't vanish before it is copied.
 *
 * Re-register guard (5.24.0): when the player already has a key, the first
 * submit returns `confirm: true`; the panel then shows the warning with
 * Continue / Cancel and only Continue sends the code again with replace = true.
 *
 * Key restore (5.25.0): under the form a second option, "I still have my key",
 * opens a field for a key from an earlier export. `onRestore(key)` checks it
 * with the server (POST /api/enroll/restore) - nothing new is issued, the key
 * only comes back into this browser's config. Wrong key -> "Key not valid",
 * nothing stored.
 *
 * Export prompt (5.25.0): after ANY success (new key or restored) the panel
 * shows the /st config export text (`getExport()`, the same function the
 * command uses - it includes the key) with a Copy button, so the player has a
 * backup before the next reinstall wipes the config.
 *
 * No document-wide listeners: Escape is handled by a keydown listener on the
 * panel itself, and key events are stopped at the panel so the game doesn't
 * treat typing in the code field as hotkeys.
 */
import { t, escapeHtml } from './i18n.js';

const PANEL_ID = 'st-register-panel';
/** The chat CLI refocuses its input ~5 ms after a command — focus the field after that. */
const FOCUS_DELAY_MS = 50;

const BTN_PRIMARY = 'padding:5px 12px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;';
const BTN_GREY = 'padding:5px 12px;background:#444;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;font-size:12px;';
const FIELD = 'width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;font-size:12px;';
const MONO_FIELD = 'flex:1;min-width:0;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:12px;';

export class RegisterPanel {
    /**
     * @param {(code: string, replace: boolean) => Promise<{ok: boolean, message: string, vars?: object, confirm?: boolean, playerKey?: string}>} onSubmit
     *        — performs the enrollment; message is an i18n key, confirm = ask before replacing a key
     * @param {{onRestore?: (key: string) => Promise<{ok: boolean, message: string, vars?: object}>, getExport?: () => string}} [hooks]
     *        — onRestore: check + store an existing key (absent = no restore option);
     *          getExport: the /st config export text, shown after a success (absent = no export block)
     */
    constructor(onSubmit, hooks = {}) {
        this.onSubmit = onSubmit;
        this.onRestore = typeof hooks.onRestore === 'function' ? hooks.onRestore : null;
        this.getExport = typeof hooks.getExport === 'function' ? hooks.getExport : null;
        this._panel = null;
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
        if (this._panel) this._panel.remove();
        this._panel = null;
        this._input = null;
        this._restoreInput = null;
        this._restoreBlock = null;
        this._confirm = null;
    }

    async _submit(form, button, status, replace = false) {
        const code = this._input.value.trim();
        if (!code) {
            this._input.focus();
            return;
        }
        button.disabled = true;
        this._input.disabled = true;
        this._showStatus(status, t('registerBusy'), '#ccc');

        const panel = this._panel;
        const result = await this.onSubmit(code, replace);
        if (panel !== this._panel) return; // closed meanwhile

        if (result.confirm) {
            this._showStatus(status, t(result.message, result.vars), '#fb5');
            panel.appendChild(this._buildConfirm(form, button, status));
        } else if (result.ok) {
            this._finish(panel, form, status, result, result.playerKey ? this._buildKeyBlock(result.playerKey) : null);
        } else {
            this._showStatus(status, t(result.message, result.vars), '#f77');
            button.disabled = false;
            this._input.disabled = false;
            this._input.select();
            this._input.focus();
        }
    }

    /** "I still have my key" → check it with the server and store it. */
    async _submitRestore(form, button, status) {
        const key = this._restoreInput.value.trim();
        if (!key) {
            this._restoreInput.focus();
            return;
        }
        button.disabled = true;
        this._restoreInput.disabled = true;
        this._showStatus(status, t('registerRestoreBusy'), '#ccc');

        const panel = this._panel;
        const result = await this.onRestore(key);
        if (panel !== this._panel) return;

        if (result.ok) {
            this._finish(panel, form, status, result, null);
        } else {
            this._showStatus(status, t(result.message, result.vars), '#f77');
            button.disabled = false;
            this._restoreInput.disabled = false;
            this._restoreInput.select();
            this._restoreInput.focus();
        }
    }

    /** Success (new key or restored): form away, green status, key block, export block, Close. */
    _finish(panel, form, status, result, keyBlock) {
        form.style.display = 'none';
        if (this._restoreBlock) this._restoreBlock.style.display = 'none';
        this._showStatus(status, t(result.message, result.vars), '#7c7');
        if (keyBlock) panel.appendChild(keyBlock);
        const exportText = this._exportText();
        if (exportText) panel.appendChild(this._buildExportBlock(exportText));
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = t('close');
        close.style.cssText = BTN_GREY + 'margin-top:10px;';
        close.addEventListener('click', () => this.hide());
        panel.appendChild(close);
        if (!keyBlock) setTimeout(() => close.focus(), FOCUS_DELAY_MS);
    }

    /** The export text AFTER the key was stored (so it contains the key); '' when unavailable. */
    _exportText() {
        if (!this.getExport) return '';
        try {
            return String(this.getExport() || '');
        } catch (e) {
            console.warn('[ST] Register: export text failed:', e);
            return '';
        }
    }

    /** "You already have a key …": Continue (send again with replace) or Cancel (form back). */
    _buildConfirm(form, button, status) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = t('registerContinue');
        go.style.cssText = BTN_PRIMARY + 'background:#8a4a1a;border-color:#b8662a;';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = t('cancel');
        cancel.style.cssText = BTN_GREY;
        go.addEventListener('click', () => {
            row.remove();
            this._confirm = null;
            this._submit(form, button, status, true);
        });
        cancel.addEventListener('click', () => {
            row.remove();
            this._confirm = null;
            status.style.display = 'none';
            button.disabled = false;
            this._input.disabled = false;
            this._input.focus();
        });
        this._confirm = row;
        setTimeout(() => cancel.focus(), FOCUS_DELAY_MS);
        row.append(go, cancel);
        return row;
    }

    /** The new key: notice, read-only field + Copy. */
    _buildKeyBlock(key) {
        const block = document.createElement('div');
        block.style.marginTop = '10px';

        const notice = document.createElement('div');
        notice.textContent = t('registerKeyNotice');
        notice.style.cssText = 'color:#ddd;margin-bottom:8px;line-height:1.4;';

        const field = document.createElement('input');
        field.type = 'text';
        field.readOnly = true;
        field.value = key;
        field.spellcheck = false;
        field.style.cssText = MONO_FIELD;
        field.addEventListener('focus', () => field.select());

        const { row, feedback } = this._copyRow(field, key);
        block.append(notice, row, feedback);
        setTimeout(() => { field.focus(); field.select(); }, FOCUS_DELAY_MS);
        return block;
    }

    /** The /st config export text (incl. the key) as a backup, with Copy. */
    _buildExportBlock(text) {
        const block = document.createElement('div');
        block.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #444;';

        const title = document.createElement('div');
        title.innerHTML = `<b style="color:#8cf">${escapeHtml(t('registerExportTitle'))}</b>`;
        title.style.marginBottom = '4px';

        const notice = document.createElement('div');
        notice.textContent = t('registerExportNotice');
        notice.style.cssText = 'color:#ddd;margin-bottom:8px;line-height:1.4;';

        const area = document.createElement('textarea');
        area.value = text;
        area.readOnly = true;
        area.spellcheck = false;
        area.rows = 4;
        area.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:11px;resize:vertical;word-break:break-all;';
        area.addEventListener('focus', () => area.select());

        const { row, feedback } = this._copyRow(area, text);
        block.append(title, notice, row, feedback);
        return block;
    }

    /** field + Copy button side by side, with a feedback line underneath. */
    _copyRow(field, text) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:flex-start;';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = t('copy');
        copy.style.cssText = BTN_PRIMARY;
        const feedback = document.createElement('div');
        feedback.style.cssText = 'min-height:16px;margin-top:4px;font-size:11px;';
        copy.addEventListener('click', async () => {
            const ok = await copyText(text, field);
            feedback.textContent = t(ok ? 'copied' : 'copyFailed');
            feedback.style.color = ok ? '#7c7' : '#f77';
            if (!ok) field.select();
        });
        row.append(field, copy);
        return { row, feedback };
    }

    /** "I still have my key": a link that opens the restore field + button. */
    _buildRestoreBlock(status) {
        const block = document.createElement('div');
        block.style.cssText = 'margin-top:12px;padding-top:8px;border-top:1px solid #444;';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = t('registerHaveKey');
        toggle.style.cssText = 'padding:0;background:none;border:none;color:#8cf;cursor:pointer;font-size:12px;text-decoration:underline;';

        const section = document.createElement('form');
        section.autocomplete = 'off';
        section.style.cssText = 'display:none;margin-top:8px;';

        const intro = document.createElement('div');
        intro.textContent = t('registerRestoreIntro');
        intro.style.cssText = 'color:#aaa;margin-bottom:8px;line-height:1.4;';

        const label = document.createElement('label');
        label.textContent = t('registerRestoreLabel');
        label.style.cssText = 'display:block;margin-bottom:4px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 100;
        input.style.cssText = FIELD + 'font-family:Consolas,monospace;';
        label.htmlFor = input.id = `${PANEL_ID}-restore-key`;

        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = t('registerRestoreButton');
        button.style.cssText = BTN_PRIMARY + 'margin-top:10px;';

        section.append(intro, label, input, button);
        section.addEventListener('submit', (e) => {
            e.preventDefault();
            this._submitRestore(section, button, status);
        });
        toggle.addEventListener('click', () => {
            const open = section.style.display === 'none';
            section.style.display = open ? 'block' : 'none';
            if (open) setTimeout(() => input.focus(), FOCUS_DELAY_MS);
        });

        block.append(toggle, section);
        this._restoreInput = input;
        return block;
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
        input.style.cssText = FIELD;
        label.htmlFor = input.id = `${PANEL_ID}-code`;

        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = t('registerButton');
        button.style.cssText = BTN_PRIMARY + 'margin-top:10px;';

        const status = document.createElement('div');
        status.style.cssText = 'display:none;margin-top:10px;font-weight:bold;';

        form.append(intro, label, input, button);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this._submit(form, button, status);
        });

        // Status sits between the form and the restore option, so both report into it
        panel.append(close, title, form, status);
        this._restoreBlock = this.onRestore ? this._buildRestoreBlock(status) : null;
        if (this._restoreBlock) panel.appendChild(this._restoreBlock);
        this._input = input;
        return panel;
    }
}

/** Clipboard API first; select + execCommand as fallback (older/insecure contexts). */
export async function copyText(text, field) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through */ }
    try {
        field.focus();
        field.select();
        return document.execCommand('copy');
    } catch {
        return false;
    }
}
