/**
 * player-status.js — color alliance bases on the world map by online status.
 *
 * Replaces the BaseColors.GetBaseColor function to return colors based on
 * alliance member online state and diplomatic relations.
 *
 * Colors:
 *   Own     → #00bcd4 (cyan — distinct from unknown, fixes Shockr issue #9)
 *   Online  → #76ff03 (bright green)
 *   Away    → #ffd600 (amber)
 *   Offline → #5a5653 (dark grey)
 *   Hidden  → #ffff00 (yellow)
 *   Friend  → #76ff03
 *   NAP     → #bbdefb
 *   Foe     → #f44336
 *   Unknown → #ffffff
 *
 * Finding the function: the RegionCity fingerprint scan fails when
 * Maelstrom_CityOnlineStateColorer loads first and replaces the original
 * function. Instead, we find the obfuscated name via the readable
 * 'GetBaseColor' anchor on BaseColors.prototype — the obfuscated key is
 * always the one right before it in the prototype key list.
 *
 * Last verified: 2026-09-30
 *   BaseColors obfuscated: SEIVJN (before GetBaseColor in proto keys)
 *   OnlineState: 0=Offline, 1=Online, 2=Away, 3=Hidden
 *   AllianceRelation: 1=Friend, 2=NAP, 3=Foe
 */

import { t } from '../lib/i18n.js';

const PLAYER_COLORS = {
    0: '#5a5653',   // Offline
    1: '#76ff03',   // Online
    2: '#ffd600',   // Away
    3: '#ffff00',   // Hidden
};

const RELATION_COLORS = {
    1: '#76ff03',   // Friend
    2: '#bbdefb',   // NAP
    3: '#f44336',   // Foe
};

const OWN_COLOR = '#00bcd4';    // Cyan — own bases
const DEFAULT_COLOR = '#ffffff'; // Unknown

function getPlayerColor(playerId, allianceId) {
    const md = ClientLib.Data.MainData.GetInstance();
    const alliance = md.get_Alliance();
    const myAllianceId = alliance.get_Id();

    // Own bases → cyan
    if (md.get_Player().id === playerId) {
        return OWN_COLOR;
    }

    // Alliance members → color by online state
    if (myAllianceId > 0 && myAllianceId === allianceId) {
        try {
            const memberData = alliance.get_MemberData().d[playerId];
            if (memberData) {
                return PLAYER_COLORS[memberData.OnlineState] || '#c8c800';
            }
        } catch { /* fall through */ }
        return '#c8c800'; // alliance member but no data yet
    }

    // Diplomatic relations
    try {
        const relation = alliance.GetRelation(allianceId);
        if (RELATION_COLORS[relation]) {
            return RELATION_COLORS[relation];
        }
    } catch { /* fall through */ }

    return DEFAULT_COLOR;
}

export class PlayerStatus {
    /** Short description for `/st help`. */
    get description() { return t('descPlayerStatus'); }

    constructor() {
        this.name = 'PlayerStatus';
        this.running = false;
        this._patchedNames = [];
        this._oldFunctions = {};
        this._refreshInterval = null;
        this._events = [];
    }

    async start() {
        const proto = ClientLib.Data.BaseColors.prototype;

        // Find obfuscated function name via GetBaseColor anchor
        const obfName = this._findObfuscatedName(proto);
        if (!obfName && typeof proto.GetBaseColor !== 'function') {
            console.warn('[ST] PlayerStatus: BaseColors function not found — feature disabled');
            this.running = true;
            return;
        }

        // Replace both the obfuscated and readable versions
        const toReplace = [];
        if (obfName && typeof proto[obfName] === 'function') toReplace.push(obfName);
        if (typeof proto.GetBaseColor === 'function') toReplace.push('GetBaseColor');

        for (const name of toReplace) {
            this._oldFunctions[name] = proto[name];
            proto[name] = getPlayerColor;
            this._patchedNames.push(name);
        }

        // Hook alliance change → repaint
        const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
        this._attachEvent(alliance, 'Change', ClientLib.Data.AllianceChange, () => {
            try {
                ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
            } catch { /* ignore */ }
        });

        // Refresh member data every 30 seconds
        this._refreshInterval = setInterval(() => {
            try {
                ClientLib.Data.MainData.GetInstance().get_Alliance().RefreshMemberData();
            } catch { /* ignore */ }
        }, 30000);

        // Initial repaint
        try {
            ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
        } catch { /* ignore */ }

        this.running = true;
        console.log(`[ST] PlayerStatus: started (patched: ${this._patchedNames.join(', ')})`);
    }

    stop() {
        const proto = ClientLib.Data.BaseColors.prototype;

        // Restore original functions
        for (const name of this._patchedNames) {
            if (this._oldFunctions[name]) {
                proto[name] = this._oldFunctions[name];
            }
        }
        this._patchedNames = [];
        this._oldFunctions = {};

        // Remove events
        for (const ev of this._events) {
            try {
                webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb);
            } catch { /* ignore */ }
        }
        this._events = [];

        // Clear interval
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = null;
        }

        // Repaint to restore default colors
        try {
            ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
        } catch { /* ignore */ }

        this.running = false;
    }

    _attachEvent(source, name, type, cb) {
        this._events.push({ source, name, type, cb });
        webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
    }

    /**
     * Find the obfuscated function name by looking at proto keys.
     * The obfuscated name (6 uppercase letters) sits right before
     * 'GetBaseColor' in the prototype key list.
     */
    _findObfuscatedName(proto) {
        const keys = Object.keys(proto);
        const idx = keys.indexOf('GetBaseColor');
        if (idx <= 0) return null;

        const candidate = keys[idx - 1];
        // Verify it's a 6-char uppercase obfuscated name and a function
        if (/^[A-Z]{6}$/.test(candidate) && typeof proto[candidate] === 'function') {
            return candidate;
        }
        return null;
    }
}
