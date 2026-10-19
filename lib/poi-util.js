// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * poi-util.js — POI and sector helpers shared by poi-analyser and sector-hud.
 *
 * Game facts (from the reference scripts, not invented):
 *   - POI bonuses are ALLIANCE-WIDE: every base of every member gets the same
 *     bonus. There is no per-base POI bonus and no "base in range of a POI".
 *     Own alliance: alliance.get_POITiberiumBonus/…/get_POIDefenseBonus()
 *     (TA_MaelstromTools / Info Sticker), rank + score per type from
 *     alliance.get_POIRankScore()[poiType - EPOIType.RankedTypeBegin]
 *     ({r, s, ns, ps}, TA Real POI Bonus). Another alliance's bonus is not
 *     readable client-side.
 *   - POIs on the map: world object Type PointOfInterest; the details (type,
 *     level, owner alliance) come from the region vis object at that cell
 *     (get_Region().GetObjectFromPosition(x * gridW, y * gridH),
 *     get_VisObjectType() === RegionPointOfInterest, get_Type/get_Level/
 *     get_OwnerAllianceId/get_OwnerAllianceName - TA Real POI Bonus,
 *     TA Green Cross Tools). Only loaded (visible) map regions answer.
 *   - Own POIs, complete: alliance.get_OwnedPOIs() [{x, y, l, t}] (TA POIs Analyser).
 *   - Sectors: the world is split in get_SectorCount() compass sectors around
 *     its centre cell (Shockr's own calculation, see sectorNo). A sector has no
 *     owner in the game; "who holds it" here = who holds the POIs in it.
 */
import { visibleCellRange } from './map-overlay.js';

/** EPOIType enum names → short keys (same order as the game's ranked types). */
export const POI_KEYS = {
    TiberiumBonus: 'tib',
    CrystalBonus: 'cry',
    PowerBonus: 'pow',
    InfanteryBonus: 'inf',
    VehicleBonus: 'veh',
    AirBonus: 'air',
    DefenseBonus: 'def',
};
export const KEY_ORDER = ['tib', 'cry', 'pow', 'inf', 'veh', 'air', 'def'];
/** Production bonuses are per hour; combat bonuses are a percentage. */
export const RESOURCE_KEYS = new Set(['tib', 'cry', 'pow']);
/** Alliance getter per key (TA_MaelstromTools / Info Sticker). */
const BONUS_GETTERS = {
    tib: 'get_POITiberiumBonus',
    cry: 'get_POICrystalBonus',
    pow: 'get_POIPowerBonus',
    inf: 'get_POIInfantryBonus',
    veh: 'get_POIVehicleBonus',
    air: 'get_POIAirBonus',
    def: 'get_POIDefenseBonus',
};
/** Fallback sector abbreviations (index = sector number, as WarChiefs). */
const SECTOR_FALLBACK = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
const SECTOR_TR = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast'];

/** 2.1M / 890k / 950 / 12.5 */
export function fmtNumber(n) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'G';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 10) / 10);
}

/** "+12.3k/h" (production) or "+10%" (combat). */
export function fmtBonus(key, value, sign = false) {
    const s = sign && value > 0 ? '+' : '';
    return RESOURCE_KEYS.has(key) ? `${s}${fmtNumber(value)}/h` : `${s}${fmtNumber(value)}%`;
}

/** Short key ('tib', …) for a ClientLib.Base.EPOIType value, null if not a bonus type. */
export function poiKey(poiType) {
    try {
        const e = ClientLib.Base.EPOIType;
        for (const name of Object.keys(POI_KEYS)) if (e[name] === poiType) return POI_KEYS[name];
    } catch { /* enum missing */ }
    return null;
}

/**
 * Compass sector of cell (x, y). The world is cut into `count` equal slices
 * around its centre cell; slice 0 is centred on south (+y on the map) and the
 * numbers run clockwise as seen on the map: south, south-west, west, …
 * (the order of SECTOR_TR). A cell on a slice border goes to the next slice.
 */
export function sectorNo(x, y, worldWidth, worldHeight, count) {
    const dx = x - Math.floor(worldWidth / 2);
    const dy = y - Math.floor(worldHeight / 2);
    const turn = Math.atan2(-dx, dy) / (2 * Math.PI);    // 0 = south, 1/4 = west, 1/2 = north
    const slice = Math.round(turn * count);
    return ((slice % count) + count) % count;
}

/** World size + sector count from the server, or null. */
export function worldGeometry() {
    try {
        const s = ClientLib.Data.MainData.GetInstance().get_Server();
        const g = { width: s.get_WorldWidth(), height: s.get_WorldHeight(), count: s.get_SectorCount() };
        return g.width > 0 && g.height > 0 && g.count > 0 ? g : null;
    } catch {
        return null;
    }
}

/** The game's own (translated) sector abbreviation, fallback S/SW/W/… */
export function sectorAbbr(i) {
    try {
        const name = SECTOR_TR[i];
        const text = name ? String(qx.core.Init.getApplication().tr(`tnf:${name} abbr`)) : '';
        if (text && !text.startsWith('tnf:')) return text;
    } catch { /* qx not ready */ }
    return SECTOR_FALLBACK[i] || String(i);
}

/** Own alliance {id, name} or null (no alliance). */
export function ownAlliance() {
    try {
        const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
        if (!a || (typeof a.get_Exists === 'function' && !a.get_Exists())) return null;
        const id = Number(a.get_Id());
        return id > 0 ? { id, name: String(a.get_Name() || '') } : null;
    } catch {
        return null;
    }
}

/**
 * The own alliance's POI bonuses: [{key, value, rank, score}] in KEY_ORDER,
 * value 0 included (the caller decides what to show). null without alliance.
 */
export function allianceBonuses() {
    try {
        const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
        if (!ownAlliance()) return null;
        let ranks = [];
        try { ranks = a.get_POIRankScore() || []; } catch { /* no ranks */ }
        let begin = 0;
        try { begin = ClientLib.Base.EPOIType.RankedTypeBegin; } catch { /* keep 0 */ }
        const out = [];
        for (const [name, key] of Object.entries(POI_KEYS)) {
            let value = 0;
            try { value = Number(a[BONUS_GETTERS[key]]()) || 0; } catch { /* getter missing */ }
            let rs = null;
            try { rs = ranks[ClientLib.Base.EPOIType[name] - begin] || null; } catch { /* unknown */ }
            out.push({ key, value, rank: rs ? rs.r : null, score: rs ? rs.s : null });
        }
        return out;
    } catch {
        return null;
    }
}

/** Own alliance's POIs [{x, y, level}] (complete list, also off-screen). */
export function ownedPois() {
    try {
        const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
        if (!ownAlliance()) return [];
        return (a.get_OwnedPOIs() || []).map(p => ({ x: Number(p.x), y: Number(p.y), level: Number(p.l) }));
    } catch {
        return [];
    }
}

/** World object type for a POI (ClientLib enum, 4 as fallback). */
function poiObjectType() {
    try {
        const v = ClientLib.Data.WorldSector.ObjectType.PointOfInterest;
        if (typeof v === 'number') return v;
    } catch { /* fall back */ }
    return 4;
}

/** Details of a POI region vis object, or null for anything else / a tunnel exit. */
export function poiFromVisObject(obj) {
    try {
        if (!obj) return null;
        const visType = ClientLib.Vis.VisObject.EObjectType.RegionPointOfInterest;
        if (typeof obj.get_VisObjectType === 'function' && obj.get_VisObjectType() !== visType) return null;
        const worldType = obj.get_Type();
        let tunnel;
        try { tunnel = ClientLib.Data.WorldSector.WorldObjectPointOfInterest.EPOIType.TunnelExit; } catch { tunnel = undefined; }
        if (tunnel !== undefined && worldType === tunnel) return null;
        const poiType = ClientLib.Base.PointOfInterestTypes.GetPOITypeFromWorldPOIType(worldType);
        const key = poiKey(poiType);
        if (!key) return null;
        return {
            key,
            poiType,
            level: Number(obj.get_Level()),
            ownerId: Number(obj.get_OwnerAllianceId()) || 0,
            ownerName: String((typeof obj.get_OwnerAllianceName === 'function' && obj.get_OwnerAllianceName()) || ''),
        };
    } catch {
        return null;
    }
}

/** POIs in the visible map area: [{x, y, key, poiType, level, ownerId, ownerName}]. */
export function visiblePois() {
    const md = ClientLib.Data.MainData.GetInstance();
    const world = md.get_World();
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    const gw = region.get_GridWidth();
    const gh = region.get_GridHeight();
    const type = poiObjectType();
    const range = visibleCellRange();
    const out = [];
    for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
            try {
                const w = world.GetObjectFromPosition(x, y);
                if (!w || w.Type !== type) continue;   // cheap world check first
                const poi = poiFromVisObject(region.GetObjectFromPosition(x * gw, y * gh));
                if (poi) out.push({ x, y, ...poi });
            } catch { /* skip this cell */ }
        }
    }
    return out;
}

/** POI score of a level (game formula), 0 if unavailable. */
export function poiScore(level) {
    try { return Number(ClientLib.Base.PointOfInterestTypes.GetScoreByLevel(level)) || 0; } catch { return 0; }
}

/**
 * Real gain/loss of one POI for the own alliance without ranking data - TA
 * Real POI Bonus' direct cases, ported. `total(rank, score)` = the game's
 * GetTotalBonusByType for this POI type. Returns {kind, value}; value null
 * when the rank would change (then rankedPoiDelta with ranking data).
 * ctx: {own, ownerIsAlliance, poiScore, rank, score, nextScore, prevScore}
 */
export function realPoiDelta(ctx, total) {
    const { own, ownerIsAlliance, poiScore: ps, rank, score, nextScore, prevScore } = ctx;
    const current = total(rank, score);
    if (own) {
        if (prevScore <= 0 || score - ps >= prevScore) return { kind: 'loss', value: current - total(rank, score - ps) };
        return { kind: 'loss', value: null };
    }
    if (!score) return { kind: 'gain', value: null };
    if (nextScore <= 0 || rank <= 1) return { kind: 'gain', value: total(rank, score + ps) - current };
    if (ownerIsAlliance) return { kind: 'gain', value: null };
    if (score + ps > nextScore) return { kind: 'gain', value: null };
    if (score + ps < nextScore) return { kind: 'gain', value: total(rank, score + ps) - current };
    return { kind: 'gain', value: total(rank - 1, score + ps) - current };
}

/**
 * Real gain/loss with the other alliances' scores (RankingGetData rows
 * [{a: allianceId, pois: score}], own alliance already removed) - TA Real
 * POI Bonus' calculateBonus, ported.
 * ctx: {own, poiOwnerId, poiScore, rank, score}
 */
export function rankedPoiDelta(ctx, rows, total) {
    let others = rows.map(r => ({ a: r.a, pois: Number(r.pois) || 0 }));
    const isGain = !ctx.own;
    if (isGain && ctx.poiOwnerId) {
        const owner = others.find(r => r.a === ctx.poiOwnerId);
        if (owner) {
            owner.pois -= ctx.poiScore;
            others.sort((a, b) => b.pois - a.pois);
        }
    }
    const newScore = ctx.score + (isGain ? ctx.poiScore : -ctx.poiScore);
    let i = 0;
    while (i < others.length && others[i].pois > newScore) i++;
    const current = total(ctx.rank, ctx.score);
    const next = total(i + 1, newScore);
    return { kind: isGain ? 'gain' : 'loss', value: isGain ? next - current : current - next };
}

/**
 * Per sector: own / enemy / free POI counts and the status colour key.
 * @param {Array<{x, y, ownerId}>} pois  every known POI (one per cell)
 * @param {number|null} ownId            own alliance id
 * @returns {Array<{sector, own, enemy, free, status: 'own'|'enemy'|'none'}>} one per sector
 */
export function sectorSummary(pois, ownId, geo) {
    const out = [];
    for (let i = 0; i < geo.count; i++) out.push({ sector: i, own: 0, enemy: 0, free: 0, status: 'none' });
    for (const p of pois) {
        const s = out[sectorNo(p.x, p.y, geo.width, geo.height, geo.count)];
        if (!s) continue;
        if (!p.ownerId) s.free++;
        else if (ownId && p.ownerId === ownId) s.own++;
        else s.enemy++;
    }
    for (const s of out) {
        if (s.own > 0 && s.own >= s.enemy) s.status = 'own';
        else if (s.enemy > 0) s.status = 'enemy';
    }
    return out;
}
