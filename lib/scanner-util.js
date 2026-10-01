/**
 * scanner-util.js — extract base layout, units, and buildings from a city.
 *
 * Produces a scan payload compatible with the alliance server's ScanPayload model.
 * Depends on ClientLib patches ($OffenseUnits, $DefenseUnits) being applied.
 */
import { Base62, LayoutPacker, UnitPacker, packUnitXY } from './packer.js';

/**
 * Extract a full scan payload from a loaded city.
 * @param {object} city — a ClientLib city object (must be loaded, not ghost)
 * @returns {object|null} scan payload ready for POST, or null if extraction fails
 */
export function extractScan(city) {
    try {
        const md = ClientLib.Data.MainData.GetInstance();
        const player = md.get_Player();
        const server = md.get_Server();

        return {
            city_id: city.get_Id(),
            world_id: server.get_WorldId(),
            x: city.get_PosX(),
            y: city.get_PosY(),
            name: city.get_Name(),
            owner: city.get_OwnerName() || player.name,
            owner_id: city.get_OwnerId(),
            alliance: getAllianceName(city, md),
            alliance_id: getAllianceId(city, md),
            faction: city.get_CityFaction(),
            level_base: city.get_LvlBase(),
            level_off: city.get_LvlOffense(),
            level_def: city.get_LvlDefense(),
            tiles: getLayout(city),
            buildings: getBuildings(city),
            ...getUnits(city),
            upgrades: getUpgrades(city),
            scanned_by: player.name,
            version: city.get_Version(),
            timestamp: Date.now(),
        };
    } catch (e) {
        console.warn('[ST] extractScan failed:', e);
        return null;
    }
}

/** Get alliance name, handling own-base edge case. */
function getAllianceName(city, md) {
    if (city.get_OwnerId() === md.get_Player().id) {
        const alliance = md.get_Alliance();
        return alliance ? alliance.get_Name() : '';
    }
    return city.get_OwnerAllianceName() || '';
}

/** Get alliance ID, handling own-base edge case. */
function getAllianceId(city, md) {
    if (city.get_OwnerId() === md.get_Player().id) {
        const alliance = md.get_Alliance();
        return alliance ? alliance.get_Id() : 0;
    }
    return city.get_OwnerAllianceId() || 0;
}

/** Pack city layout (9×16 resource grid) into base62. */
function getLayout(city) {
    const rows = [];
    for (let y = 0; y < 16; y++) {
        const row = [];
        for (let x = 0; x < 9; x++) {
            row.push(city.GetResourceType(x, y));
        }
        rows.push(LayoutPacker.pack(row));
    }
    return Base62.pack(rows);
}

/** Pack buildings into base62. */
function getBuildings(city) {
    try {
        const buildings = city.get_Buildings();
        if (!buildings || !buildings.d) return '';
        const packed = Object.values(buildings.d).map(unit => packUnit(unit));
        return Base62.pack(packed);
    } catch {
        return '';
    }
}

/** Pack offense and defense units into base62 strings. */
function getUnits(city) {
    try {
        const units = city.get_CityUnitsData();
        if (!units) return { defense_units: '', offense_units: '' };

        const defUnits = units.$DefenseUnits;
        const offUnits = units.$OffenseUnits;
        const faction = city.get_CityFaction();

        const def = defUnits && defUnits.d
            ? Base62.pack(Object.values(defUnits.d).map(u => packUnit(u)))
            : '';

        // Forgotten/NPC bases have no offense
        const off = (faction === 1 || faction === 2) && offUnits && offUnits.d
            ? Base62.pack(Object.values(offUnits.d).map(u => packUnit(u)))
            : '';

        return { defense_units: def, offense_units: off };
    } catch {
        return { defense_units: '', offense_units: '' };
    }
}

/** Pack a single unit: xy + mdb id + level. */
function packUnit(unit) {
    const xy = packUnitXY(unit.get_CoordX(), unit.get_CoordY());
    return UnitPacker.pack({
        xy,
        id: unit.get_MdbUnitId(),
        level: unit.get_CurrentLevel(),
    });
}

/** Get research/upgrade data from a city. */
function getUpgrades(city) {
    try {
        if (city.IsOwnBase()) {
            return getPlayerResearch();
        }
        const modules = city.get_ActiveModules();
        if (!modules) return {};

        const upgrades = {};
        for (const mod of modules) {
            const unitMod = getUnitModule(mod);
            if (!unitMod) continue;
            const { id, level } = unitMod;
            if (!upgrades[id] || upgrades[id] < level) {
                upgrades[id] = level;
            }
        }
        return upgrades;
    } catch {
        return {};
    }
}

/** Get player's own research levels. */
function getPlayerResearch() {
    try {
        const research = ClientLib.Data.MainData.GetInstance().get_Player().get_PlayerResearch();
        const output = {};
        for (const type of [1, 2]) { // TechOffense, TechDefense
            for (const re of research.GetResearchItemListByType(type).l) {
                if (re.get_CurrentLevel() === 0) continue;
                output[re.get_GameDataUnit_Obj().i] = re.get_CurrentLevel();
            }
        }
        return output;
    } catch {
        return {};
    }
}

/** Map a module ID to a unit ID + level. Cached. */
const _unitModuleCache = new Map();
function getUnitModule(moduleId) {
    if (_unitModuleCache.size === 0) {
        // Build cache from GAMEDATA
        try {
            for (const unit of Object.values(GAMEDATA.units)) {
                for (const mod of unit.m) {
                    _unitModuleCache.set(mod.i, {
                        id: unit.i,
                        level: mod.r.length === 0 ? 1 : 2,
                    });
                }
            }
        } catch { /* ignore */ }
    }
    return _unitModuleCache.get(moduleId) || null;
}
