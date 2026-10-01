/**
 * api-client.js — POST scans to the Shockr Alliance Server.
 *
 * Handles:
 * - Configurable server URL and API key
 * - Batching (collect scans, flush every 30s or when 25 are queued)
 * - Retry with exponential backoff on failure
 * - Chat feedback on success/failure
 */
import { chatMessage } from './main.js';

const MAX_BATCH = 25;
const FLUSH_INTERVAL_MS = 30000;
const MAX_RETRIES = 3;

export class ApiClient {
    constructor(config) {
        this.config = config;
        this.queue = [];
        this._flushTimer = null;
    }

    /** Check if the API is configured (URL + key set). */
    get isConfigured() {
        return !!(this._url && this._key);
    }

    get _url() {
        return this.config.get('api.url', '');
    }

    get _key() {
        return this.config.get('api.key', '');
    }

    /** Queue a scan payload for sending. */
    send(payload) {
        if (!this.isConfigured) return;

        this.queue.push(payload);

        if (this.queue.length >= MAX_BATCH) {
            this.flush();
        } else if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
        }
    }

    /** Flush all queued scans to the server. */
    async flush() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        if (this.queue.length === 0 || !this.isConfigured) return;

        const batch = this.queue.splice(0, MAX_BATCH);
        let success = 0;
        let failed = 0;

        for (const payload of batch) {
            const ok = await this._sendOne(payload);
            if (ok) success++;
            else failed++;
        }

        if (success > 0) {
            console.log(`[ST] API: ${success} scan(s) sent`);
        }
        if (failed > 0) {
            chatMessage(`[ST] ⚠ ${failed} scan(s) failed to send`);
        }
    }

    /** Send a single scan with retry. */
    async _sendOne(payload, attempt = 0) {
        const url = this._url.replace(/\/$/, '') + '/api/scan';

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Alliance-Key': this._key,
                },
                body: JSON.stringify(payload),
            });

            if (resp.ok) {
                const data = await resp.json();
                return true;
            }

            if (resp.status === 403) {
                chatMessage('[ST] ⚠ API key rejected — check /st config set api.key');
                return false;
            }

            if (resp.status === 429) {
                // Rate limited — retry with backoff
                if (attempt < MAX_RETRIES) {
                    await sleep(1000 * Math.pow(2, attempt));
                    return this._sendOne(payload, attempt + 1);
                }
                return false;
            }

            // Other error
            console.warn(`[ST] API: ${resp.status} ${resp.statusText}`);
            return false;

        } catch (e) {
            // Network error — retry
            if (attempt < MAX_RETRIES) {
                await sleep(1000 * Math.pow(2, attempt));
                return this._sendOne(payload, attempt + 1);
            }
            console.warn('[ST] API: network error', e.message);
            return false;
        }
    }

    /** Stop the flush timer. */
    stop() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        // Try to flush remaining
        this.flush();
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
