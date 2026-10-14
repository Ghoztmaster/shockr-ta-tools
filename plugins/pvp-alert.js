/**
 * pvp-alert.js — alarm when one of your own bases is attacked while the game
 * tab is in the background.
 *
 * Port of "CENTER DRIVEN PvP Alert Status" v1.00 (der_flake, forked by XDaast):
 *   - every 5 s, only while the window has no focus: every own base is checked
 *     with `City.get_isAlerted()` (the game's own under-attack flag)
 *   - first alarm: page title "ALERT - Base <name> under attack!", alert favicon
 *     and the siren sound (setting `PvpAlert.sound`, default on — the original's
 *     `enable_sound`)
 *   - back to the game (window focused): title, favicon and siren are reset
 *
 * Differences from the original, all fixes:
 *   - the original set `was_attacked` inside the scan loop, before its
 *     `is_alerted && !was_attacked` check, so the alarm never fired; here the
 *     alarm fires once per attack and resets when you come back
 *   - the original's "relax" favicon was its own copy of the game icon; here the
 *     game's actual favicon is restored (the original's icon is the fallback)
 *     and one <link> is reused instead of a new one per alarm
 *   - the title is restored to what it was right before the alarm
 *
 * No game code is patched. Attacker names are not part of the client's alert
 * flag, so the console line names the base only.
 */
import { t } from '../lib/i18n.js';
import { ALERT_FAVICON, NORMAL_FAVICON, SIREN_SOUND } from './pvp-alert-assets.js';

const CHECK_INTERVAL_MS = 5000;

export class PvpAlert {
    /** Short description for `/st help`. */
    get description() { return t('descPvpAlert'); }

    constructor(config) {
        this.name = 'PvpAlert';
        this.config = config;
        this.running = false;
        this._timer = null;
        this._siren = null;
        this._alarmed = false;      // original: was_attacked
        this._victim = null;
        this._savedTitle = null;
        this._savedIcons = null;    // [{ el, href }] of the page's icon links before the alarm
        this._iconLink = null;
        this._alerted = new Set();  // base names alerted at the last check (console log on change)
    }

    async start() {
        this.running = true;
        this._timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
        console.log('[ST] PvpAlert: started');
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        if (this._alarmed) this._relax();
        this._alerted.clear();
        this.running = false;
        console.log('[ST] PvpAlert: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (this._alarmed) return t('pvpAlertStatusAlarm', { base: this._victim });
        const sound = t(this._soundOn() ? 'pvpAlertSoundOn' : 'pvpAlertSoundOff');
        return t('pvpAlertStatusWatching', { sound });
    }

    /** One poll: the original checkAlert(). */
    check() {
        const inBackground = !document.hasFocus();
        const alerted = alertedBases();
        this._logNew(alerted);

        if (inBackground && alerted.length && !this._alarmed) {
            // the original reports the last alerted base it finds
            this._alarm(alerted[alerted.length - 1]);
        } else if (this._alarmed && !inBackground) {
            this._relax();
        }
    }

    _alarm(victim) {
        this._alarmed = true;
        this._victim = victim;
        this._savedTitle = document.title;
        document.title = t('pvpAlertTitle', { base: victim });
        this._setFavicon(ALERT_FAVICON, 'image/gif');
        if (this._soundOn()) {
            try {
                if (!this._siren) this._siren = new Audio(SIREN_SOUND);
                const p = this._siren.play();
                if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
            } catch { /* no audio */ }
        }
    }

    _relax() {
        if (this._savedTitle !== null) document.title = this._savedTitle;
        this._savedTitle = null;
        this._restoreFavicon();
        if (this._siren) {
            try {
                this._siren.pause();
                this._siren.currentTime = 0;
            } catch { /* no audio */ }
        }
        this._alarmed = false;
        this._victim = null;
    }

    _soundOn() {
        return this.config.get('PvpAlert.sound', true) !== false;
    }

    /** `[ST] PvP Alert: ... attacks <base>` once per base when its alert flag goes up. */
    _logNew(alerted) {
        const now = new Set(alerted);
        for (const base of now) {
            if (!this._alerted.has(base)) console.log(`[ST] PvP Alert: (unknown) attacks ${base}`);
        }
        this._alerted = now;
    }

    _setFavicon(href, type) {
        const head = document.getElementsByTagName('head')[0];
        if (!head) return;
        if (!this._savedIcons) {
            this._savedIcons = [...document.querySelectorAll('link[rel~="icon"]')]
                .filter(el => el !== this._iconLink)
                .map(el => ({ el, href: el.getAttribute('href') }));
        }
        // other icon links would win over ours in some browsers: park them
        for (const { el } of this._savedIcons) el.removeAttribute('href');
        if (!this._iconLink) {
            this._iconLink = document.createElement('link');
            this._iconLink.rel = 'shortcut icon';
        }
        if (type) this._iconLink.type = type;
        else this._iconLink.removeAttribute('type');
        this._iconLink.href = href;
        if (!this._iconLink.parentNode) head.appendChild(this._iconLink);
    }

    _restoreFavicon() {
        const saved = (this._savedIcons || []).filter(s => s.href);
        if (saved.length) {
            for (const { el, href } of saved) el.setAttribute('href', href);
            if (this._iconLink && this._iconLink.parentNode) this._iconLink.parentNode.removeChild(this._iconLink);
        } else if (this._iconLink) {
            // the page had no favicon of its own: the original's normal icon
            this._setFavicon(NORMAL_FAVICON, null);
        }
        this._savedIcons = null;
    }
}

/** Names of your own bases whose under-attack flag is set. */
export function alertedBases() {
    const names = [];
    let all;
    try {
        all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
    } catch {
        return names;
    }
    for (const key in all) {
        const city = all[key];
        try {
            if (city && city.get_isAlerted()) names.push(city.get_Name());
        } catch { /* city not loaded */ }
    }
    return names;
}
