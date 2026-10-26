// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
// Portions derived from blacha/st (Shockr Tools), Copyright (c) 2020 Blayne Chard, MIT; see NOTICE.
/**
 * city-util.js — helper functions for working with cities and world objects.
 *
 * Provides: getMainCity, getObjectsNearCity, distance, waitForCity.
 * Depends on ClientLib patches being applied ($Id, $CampType, $Level).
 */

/**
 * Get the player's strongest offense city.
 * @returns {object|null} ClientLib city object, or null
 */
export function getMainCity() {
    let main = null;
    const allCities = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
    for (const city of Object.values(allCities.d)) {
        if (!main || main.get_LvlOffense() < city.get_LvlOffense()) {
            main = city;
        }
    }
    return main;
}

/**
 * Get all world objects near a city within attack range.
 * @param {object} city — a ClientLib city object
 * @returns {Map<number, { id, object, x, y, distance }>}
 */
export function getObjectsNearCity(city) {
    const cx = city.get_PosX();
    const cy = city.get_PosY();
    const maxDist = ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance();
    const world = ClientLib.Data.MainData.GetInstance().get_World();
    const output = new Map();

    for (let dy = -maxDist; dy < maxDist; dy++) {
        for (let dx = -maxDist; dx < maxDist; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= maxDist) continue;

            const x = cx + dx;
            const y = cy + dy;
            const obj = world.GetObjectFromPosition(x, y);
            if (!obj) continue;
            if (typeof obj.$Id === 'undefined') continue;

            const key = x * 100000 + y; // unique position key
            if (!output.has(key)) {
                output.set(key, { id: obj.$Id, object: obj, x, y, distance: dist });
            }
        }
    }
    return output;
}

/**
 * Get nearby objects from ALL of the player's cities.
 * @returns {Array<{ id, object, x, y, distance }>}
 */
export function getAllNearbyObjects() {
    const allCities = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
    const combined = new Map();
    for (const city of Object.values(allCities.d)) {
        const nearby = getObjectsNearCity(city);
        for (const [key, obj] of nearby) {
            if (!combined.has(key)) combined.set(key, obj);
        }
    }
    return Array.from(combined.values());
}

/**
 * Distance between two {x, y} points.
 */
export function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** How often the loaded city is checked locally (cheap, no server request). */
export const CITY_CHECK_MS = 20;
/** Minimum gap between two forced $Poll() calls (each one is a server request). */
export const CITY_POLL_MIN_GAP_MS = 70;
/** Give up on a city that has not loaded after this long. */
export const CITY_LOAD_TIMEOUT_MS = 2000;

/**
 * Wait for a city's data to load, right after set_CurrentCityId(cityId).
 *
 * Poll-on-demand: $Poll() (clientlib-patch) is forced at once, so the client
 * fetches the city now instead of on its next regular poll; it is repeated at
 * most every CITY_POLL_MIN_GAP_MS while the city is still missing (bloofi's
 * Base Scanner and MehrStrom's layout scan use the same 70 ms). The check
 * itself runs every CITY_CHECK_MS. Without $Poll this is a plain wait.
 * @param {number} cityId
 * @param {number} timeoutMs
 * @returns {Promise<object|null>} the city, or null after timeoutMs
 */
export async function waitForCity(cityId, timeoutMs = CITY_LOAD_TIMEOUT_MS) {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    const start = Date.now();
    let lastPoll = -Infinity;
    for (;;) {
        const city = cities.GetCity(cityId);
        if (city && !city.get_IsGhostMode() && city.GetBuildingsConditionInPercent() > 0) {
            return city;
        }
        const now = Date.now();
        if (now - start >= timeoutMs) return null;
        if (now - lastPoll >= CITY_POLL_MIN_GAP_MS) {
            lastPoll = now;
            try {
                const comm = ClientLib.Net.CommunicationManager.GetInstance();
                if (typeof comm.$Poll === 'function') comm.$Poll();
            } catch { /* a failing poll must not break the scan */ }
        }
        await new Promise(r => setTimeout(r, CITY_CHECK_MS));
    }
}
