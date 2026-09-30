/**
 * game-ready.js — wait for the TA game client to fully load.
 *
 * Checks: ClientLib exists, qooxdoo app is initialized, menu bar is present,
 * player data is loaded (player.name is non-empty).
 */

/**
 * @param {object} opts
 * @param {number} opts.maxAttempts — max polls before giving up (default 200)
 * @param {number} opts.intervalMs — ms between polls (default 100)
 * @returns {Promise<boolean>} true if game is ready, false if timed out
 */
export async function waitForGame({ maxAttempts = 200, intervalMs = 100 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
        if (isGameReady()) return true;
        await sleep(intervalMs);
    }
    return false;
}

/** Check all required game objects are present and populated. */
export function isGameReady() {
    try {
        if (typeof ClientLib === 'undefined') return false;
        if (typeof qx === 'undefined') return false;

        const app = qx.core.Init.getApplication();
        if (!app) return false;
        if (!app.getMenuBar()) return false;

        const md = ClientLib.Data.MainData.GetInstance();
        if (!md) return false;

        const player = md.get_Player();
        if (!player || !player.name) return false;

        return true;
    } catch {
        return false;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
