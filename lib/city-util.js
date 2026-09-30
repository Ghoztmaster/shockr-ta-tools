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

/**
 * Wait for a city's data to load (poll until buildings are present).
 * @param {number} cityId
 * @param {number} maxAttempts
 * @returns {Promise<object|null>}
 */
export async function waitForCity(cityId, maxAttempts = 30) {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    for (let i = 0; i < maxAttempts; i++) {
        const city = cities.GetCity(cityId);
        if (city && !city.get_IsGhostMode() && city.GetBuildingsConditionInPercent() > 0) {
            return city;
        }
        await new Promise(r => setTimeout(r, 50 + 5 * i));
        // Force poll after a few tries
        if (i > 3) {
            try {
                const comm = ClientLib.Net.CommunicationManager.GetInstance();
                if (typeof comm.$Poll === 'function') comm.$Poll();
            } catch { /* ignore */ }
        }
    }
    return null;
}
