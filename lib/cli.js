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
                chatMessage(`[ST] ${key} = ${JSON.stringify(value)}`);
            } else if (action === 'get' && rest.length >= 1) {
                const val = this.config.get(rest[0]);
                chatMessage(`[ST] ${rest[0]} = ${JSON.stringify(val)}`);
            } else if (action === 'list') {
                const keys = Object.keys(this.config.data).sort();
                if (keys.length === 0) {
                    chatMessage('[ST] No config set');
                } else {
                    for (const k of keys) {
                        chatMessage(`[ST] ${k} = ${JSON.stringify(this.config.data[k])}`);
                    }
                }
            } else {
                chatMessage('[ST] Usage: /st config set|get|list <key> [value]');
            }
        });

        // Built-in: /st help
        this.register('help', () => {
            const cmds = Object.keys(this.commands).sort().join(', ');
            chatMessage(`[ST] Commands: ${cmds}`);
            chatMessage('[ST] Usage: /st <command> [args...]');
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
                chatMessage(`[ST] Error: ${err.message}`);
            }
        } else {
            chatMessage(`[ST] Unknown command: ${cmd}. Type /st help`);
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

    /** Parse string → number/boolean/string */
    _parseValue(str) {
        if (str === 'true') return true;
        if (str === 'false') return false;
        const num = parseFloat(str);
        if (!isNaN(num) && String(num) === str) return num;
        return str;
    }
}
