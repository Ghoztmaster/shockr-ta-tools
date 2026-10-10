/**
 * cli.js — /st chat command handler.
 *
 * Intercepts Enter key in the chat input. If the message starts with /st,
 * it parses the command and dispatches to registered handlers.
 *
 * Usage:
 *   const cli = new Cli(config);
 *   cli.register('version', () => chatMessage('[ST] v5.0.0'));
 *   cli.register('config', (args) => { ... });
 *   cli.start();
 */
import { chatMessage } from './main.js';
import { t, escapeHtml } from './i18n.js';

/**
 * Config keys (lower case) shown only as "set" / "not set" in `config set` and
 * `config list`. An explicit `config get <key>` shows the value itself (the
 * player needs the personal key to log in to the website); the chat line is
 * local (system message), nothing is sent.
 */
const SECRET_KEYS = ['api.playerkey'];

export class Cli {
    constructor(config) {
        this.config = config;
        this.commands = {};
        this.PREFIX = '/st';
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    /** Register a command handler. */
    register(name, handler) {
        this.commands[name.toLowerCase()] = handler;
    }

    /** Start listening for chat input. */
    start() {
        const el = this._getInputElement();
        if (el) {
            el.addEventListener('keydown', this._handleKeyDown);
        }

        // Built-in: /st config set <key> <value>
        this.register('config', (args) => {
            const [action, ...rest] = args;
            if (action === 'set' && rest.length >= 2) {
                const key = rest[0];
                const value = this._parseValue(rest.slice(1).join(' '));
                this.config.set(key, value);
                chatMessage(`[ST] ${key} = ${this._display(key, value)}`);
            } else if (action === 'get' && rest.length >= 1) {
                const val = this.config.get(rest[0]);
                const shown = SECRET_KEYS.includes(rest[0].toLowerCase()) && val
                    ? escapeHtml(String(val))
                    : this._display(rest[0], val);
                chatMessage(`[ST] ${escapeHtml(rest[0])} = ${shown}`);
            } else if (action === 'list') {
                const keys = Object.keys(this.config.data).sort();
                if (keys.length === 0) {
                    chatMessage(`[ST] ${t('noConfig')}`);
                } else {
                    for (const k of keys) {
                        chatMessage(`[ST] ${k} = ${this._display(k, this.config.data[k])}`);
                    }
                }
            } else {
                chatMessage(`[ST] ${escapeHtml(t('configUsage'))}`);
            }
        });
    }

    /** Stop listening. */
    stop() {
        const el = this._getInputElement();
        if (el) {
            el.removeEventListener('keydown', this._handleKeyDown);
        }
    }

    _handleKeyDown(e) {
        if (e.key !== 'Enter') return;

        const el = this._getInputElement();
        if (!el || !el.value.startsWith(this.PREFIX)) return;

        const parts = el.value.trim().split(/\s+/);
        // parts[0] = '/st', parts[1] = command, parts[2..] = args
        const cmd = (parts[1] || '').toLowerCase();
        const args = parts.slice(2);

        const handler = this.commands[cmd];
        if (handler) {
            try {
                handler(args);
            } catch (err) {
                chatMessage(`[ST] ${t('commandError', { error: err.message })}`);
            }
        } else {
            chatMessage(`[ST] ${escapeHtml(t('unknownCommand', { cmd }))}`);
        }

        el.value = '';
        el.focus();
        setTimeout(() => el.focus(), 5);
        e.preventDefault();
        return false;
    }

    _getInputElement() {
        try {
            return qx.core.Init.getApplication()
                .getChat()
                .getChatWidget()
                .getEditable()
                .getContentElement()
                .getDomElement();
        } catch {
            return null;
        }
    }

    /** Config value for the chat — secrets only as "set" / "not set". */
    _display(key, value) {
        if (SECRET_KEYS.includes(key.toLowerCase())) {
            return t(value ? 'configSecretSet' : 'configSecretNotSet');
        }
        return JSON.stringify(value);
    }

    /** Parse string → number/boolean/string */
    _parseValue(str) {
        if (str === 'true') return true;
        if (str === 'false') return false;
        const num = parseFloat(str);
        if (!isNaN(num) && String(num) === str) return num;
        return str;
    }
}
