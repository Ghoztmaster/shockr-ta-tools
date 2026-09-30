/**
 * player-status.js — color alliance bases on the world map by online status.
 *
 * Colors:
 *   Online  → #76ff03 (bright green)
 *   Away    → #ffd600 (amber)
 *   Offline → #5a5653 (dark grey)
 *   Hidden  → #ffff00 (yellow)
 *
 * Also colors relation-based bases:
 *   Friend  → #76ff03
 *   NAP     → #bbdefb
 *   Foe     → #f44336
 *   Own     → #00bcd4 (cyan — distinct from unknown, fixes issue #9)
 *
 * TODO: implement after in-game validation of ClientLib patches
 */

const PLAYER_COLORS = {
    1: '#76ff03',   // Online
    2: '#ffd600',   // Away
    0: '#5a5653',   // Offline
    3: '#ffff00',   // Hidden
};

export class PlayerStatus {
    constructor() {
        this.name = 'PlayerStatus';
        this.running = false;
    }

    async start() {
        this.running = true;
        // TODO:
        // 1. Patch ClientLib.Data.BaseColors via extractValueFromFunction('Color=', ...)
        // 2. Replace getPlayerColor function with our version
        // 3. Hook alliance.Change → SetColorDirty
        // 4. Interval: alliance.RefreshMemberData() every 30s
        console.log('[ST] PlayerStatus: ready (implementation pending)');
    }

    stop() {
        this.running = false;
        // TODO: restore original getPlayerColor
    }
}
