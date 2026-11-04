/**
 * auto-enroll.js — 5.36.0: registration in one command.
 *
 *   /st config set api.url https://packetlab.nl/shockr?code=ABC123
 *
 * The code= parameter is split off the URL: only the URL without the code is
 * stored (the code never lands in localStorage), and the code goes through the
 * same POST /api/enroll as /st register, with chat feedback instead of the popup.
 * Without a code nothing changes: the URL is stored, /st register stays manual.
 */
import { t, escapeHtml } from './i18n.js';

/**
 * Split the enrollment code off a server URL.
 * @param {*} value — the typed api.url value (a non-URL is passed through as is)
 * @returns {{url: *, code: string}} url without the code parameter; code '' when there is none
 */
export function splitEnrollCode(value) {
    if (typeof value !== 'string') return { url: value, code: '' };
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return { url: value, code: '' };
    }
    const code = (parsed.searchParams.get('code') || '').trim();
    if (!code) return { url: value, code: '' };
    parsed.searchParams.delete('code');
    return { url: parsed.toString(), code };
}

/**
 * The `/st config set api.url` hook: store the URL (without code), then enroll
 * when it carried a code and this player has no personal key yet.
 * @param {object} config
 * @param {object} api — ApiClient (registration, enroll)
 * @param {*} value — the typed value
 * @param {(html: string) => void} say — chat line
 * @returns {Promise<void>}
 */
export async function setApiUrl(config, api, value, say) {
    const { url, code } = splitEnrollCode(value);
    config.set('api.url', url);
    say(`[ST] api.url = ${escapeHtml(JSON.stringify(url))}`);
    if (!code) return;

    if (api.registration === 'player') {
        say(`[ST] ${escapeHtml(t('registerAutoAlready'))}`);
        return;
    }
    say(`[ST] ${escapeHtml(t('registerBusy'))}`);
    const result = await api.enroll(code);
    if (result.ok) {
        say(`[ST] ${escapeHtml(t('registerSuccessChat'))}`);
        say(`[ST] ${escapeHtml(t('registerAutoKeyHint'))}`);
    } else if (result.confirm) {
        // server 409: the player has a key from another browser; replacing it needs the popup's confirm
        say(`[ST] ${escapeHtml(t('registerAutoElsewhere'))}`);
    } else if (result.message === 'registerFailed') {
        say(`[ST] ${escapeHtml(t('registerFailed', result.vars))}`);
    } else {
        // the specific reason (invalid code, not authorized, ...) without its own ❌
        const reason = t(result.message, result.vars).replace(/^❌\s*/, '');
        say(`[ST] ${escapeHtml(t('registerFailed', { error: reason }))}`);
    }
}
