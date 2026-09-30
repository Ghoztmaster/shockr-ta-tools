/**
 * kill-info.js — show plunder value tooltip on mouseover in battle view.
 *
 * Patches the battle-view tooltip to include repair cost (= plunder value)
 * for each unit.
 *
 * TODO: implement after in-game validation of ClientLib patches
 */

export class KillInfo {
    constructor() {
        this.name = 'KillInfo';
        this.running = false;
        this._oldFunction = null;
    }

    async start() {
        this.running = true;
        // TODO: find and patch the tooltip function
        // - Search for '"tnf:full hp needed to upgrade"' in $I prototypes
        // - Filter for 'DefenseTerrainFieldType' in function body
        // - Extract internal object + show function names
        // - Replace with version that adds plunder info
        console.log('[ST] KillInfo: ready (implementation pending)');
    }

    stop() {
        this.running = false;
        // TODO: restore original function
    }
}
