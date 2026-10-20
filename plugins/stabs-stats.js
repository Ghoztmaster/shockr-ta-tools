// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * stabs-stats.js — battle statistics, repair costs and the simulation cache of
 * STABS (plugins/stabs.js). Pure: every ClientLib call goes through `env`, so
 * the numbers can be checked in Node.
 *
 * The rules are TABS V2's (TABS.UTIL.Stats.get_Stats / get_RepairCosts,
 * TABS.CACHE), rewritten. Where TABS has a quirk that shows in the numbers, it
 * is kept on purpose - the requirement is the same numbers as TABS:
 *   - building HP of a player base (GDI/NOD) come from the simulation (mh/h),
 *     of a Forgotten base from the unit data (max(level max, h*16));
 *   - repair costs: Tiberium/Crystal/Credits/Research ×0.7^attackCounter,
 *     research afterwards max(1, floor(rp × damage ratio));
 *   - "front" = what stands before a building in the same column: buildings
 *     with a higher y, and every defense structure in that column;
 *   - auto repair (rep) of a defense unit = lost HP × 0.7 × DF-health ratio ×
 *     DF level / max(DF level, unit level);
 *   - battle duration = cs × 100 ms, + 3 s when cs < md × 10.
 *
 * Simulation result (`SimulateBattle` command):
 *   data.d = { s: buildings, d: defense units, a: offense units,
 *              di: target id, ai: own city id, df: defender faction,
 *              dm / am: active modules defender / attacker, cs, md }
 *     unit = { i: MdbId, l: level, h: health/16, ci: combat id, x, y, ac: attack counter }
 *   data.e = [{ Key: ci, Value: { h, mh } }]   — health after the battle (×16 scale)
 */

/** ClientLib.Base.EResourceType values TABS keeps per entity. */
export const RES = { TIB: 1, CRY: 2, CREDITS: 3, RP: 6, RC_BASE: 7, RC_AIR: 8, RC_INF: 9, RC_VEH: 10 };
const RES_KEYS = Object.values(RES);
/** Resource types whose repair cost drops with the attack counter. */
const DECAYING = new Set([RES.TIB, RES.CRY, RES.CREDITS, RES.RP]);

export const ENEMY_KEYS = ['overall', 'structure', 'cy', 'cc', 'barracks', 'factory', 'airport', 'df', 'dhq',
    'support', 'defense', 'defenseArmored', 'defenseNonArmored'];
export const OFFENSE_KEYS = ['overall', 'infantry', 'vehicle', 'aircraft'];
/** Buildings with a "front" total, in TABS' order. */
const FRONT_KEYS = ['cy', 'cc', 'barracks', 'factory', 'airport', 'df', 'dhq', 'support'];

export function emptyHp() {
    return { max: 0, start: 0, end: 0, rep: 0, maxFront: 0, startFront: 0, endFront: 0 };
}

export function emptyRes() {
    const r = {};
    for (const k of RES_KEYS) r[k] = 0;
    return r;
}

function emptyEntity() {
    return { hp: emptyHp(), res: emptyRes() };
}

export function emptyStats() {
    const stats = { battleDuration: 0, enemy: {}, offense: {} };
    for (const k of ENEMY_KEYS) stats.enemy[k] = emptyEntity();
    for (const k of OFFENSE_KEYS) stats.offense[k] = emptyEntity();
    return stats;
}

function add(entity, hp, res) {
    for (const k of ['max', 'start', 'end', 'rep']) entity.hp[k] += hp[k];
    for (const k of RES_KEYS) entity.res[k] += res[k];
}

function addFront(entity, hp) {
    entity.hp.maxFront += hp.max;
    entity.hp.startFront += hp.start;
    entity.hp.endFront += hp.end;
}

export function battleDuration(cs, md) {
    return cs * 100 + (cs < md * 10 ? 3000 : 0);
}

/**
 * Repair cost of one unit (TABS get_RepairCosts).
 * @param {(ratio:number) => Array<{Type, Count}>|null} getCosts — the client call for this unit
 * @param {{max, start, end}} hp
 * @param {number} [attackCounter]
 */
export function repairCost(getCosts, hp, attackCounter = 0) {
    const res = emptyRes();
    let ratio;
    if (hp.start !== hp.end) {
        ratio = (hp.start - hp.end) / hp.max;
        const costs = getCosts(ratio);
        for (const c of costs || []) {
            if (!(c.Type in res)) continue;
            res[c.Type] = DECAYING.has(c.Type) ? c.Count * Math.pow(0.7, attackCounter) : c.Count;
        }
    }
    if (res[RES.RP] > 0) res[RES.RP] = Math.max(1, Math.floor(res[RES.RP] * ratio));
    return res;
}

/**
 * Statistics of one simulation.
 * @param {object} data — the SimulateBattle result
 * @param {object} env
 * @param {object} env.E — enums: GDI, NOD, Offense, Feet, Wheel, Track, Air, Air2, Structure,
 *     ArmorNone, tech: { cy, cc, barracks, factory, airport, df, dhq, support: [..] }
 * @param {(mdbId) => object} env.unit — ResMain.GetUnit_Obj
 * @param {(level, unit, bonus, modules) => number} env.maxHealth — ×16 scale
 * @param {(unit) => number} env.techName — ETechName of a building
 * @param {(unit, mdbId, level, ratio) => Array|null} env.repairCosts
 * @param {object} env.buildingInfo — { cy: {x, y}|null, … }; {} when the target is unknown
 * @param {(fn) => void} env.asAttacker — runs the offense loop (TABS switches the current city there)
 */
export function computeStats(data, env) {
    const { E } = env;
    const d = data.d;
    const stats = emptyStats();
    const enemy = stats.enemy;
    const offense = stats.offense;
    const sim = {};
    for (const e of data.e) sim[e.Key] = e.Value;
    const playerBase = d.df === E.GDI || d.df === E.NOD;
    const info = env.buildingInfo;
    const hasInfo = info.cy !== undefined;
    const costsFor = (unit, u) => (ratio) => env.repairCosts(unit, u.i, u.l, ratio);

    stats.battleDuration = battleDuration(d.cs, d.md);

    let efficiency = 0;
    let dfLevel = 1;
    for (const b of d.s) {
        const unit = env.unit(b.i);
        const hp = emptyHp();
        if (playerBase) {
            hp.max = sim[b.ci].mh;
            hp.start = sim[b.ci].h;
        } else {
            hp.max = Math.max(env.maxHealth(b.l, unit, false, d.dm), b.h * 16);
            hp.start = b.h * 16;
        }
        hp.end = sim[b.ci].h;
        const res = repairCost(costsFor(unit, b), hp);
        add(enemy.overall, hp, res);
        add(enemy.structure, hp, res);
        const kind = buildingKind(env.techName(unit), E.tech);
        if (kind) add(enemy[kind], hp, res);
        if (kind === 'df') {
            efficiency = 0.7 * (hp.end / hp.max);
            dfLevel = b.l;
        }
        if (hasInfo) {
            for (const k of FRONT_KEYS) {
                const pos = info[k];
                if (pos && pos.x === b.x && pos.y < b.y) addFront(enemy[k], hp);
            }
        }
    }

    for (const u of d.d) {
        const unit = env.unit(u.i);
        const hp = emptyHp();
        hp.max = Math.max(env.maxHealth(u.l, unit, playerBase, d.dm), u.h * 16);
        hp.start = u.h * 16;
        hp.end = sim[u.ci].h;
        hp.rep = ((u.h * 16 - sim[u.ci].h) * efficiency * dfLevel) / Math.max(dfLevel, u.l);
        const res = repairCost(costsFor(unit, u), hp, u.ac);
        add(enemy.overall, hp, res);
        add(enemy.defense, hp, res);
        add(unit.ptt === E.ArmorNone ? enemy.defenseNonArmored : enemy.defenseArmored, hp, res);
        if (hasInfo && unit.mt === E.Structure) {
            for (const k of FRONT_KEYS) {
                const pos = info[k];
                if (pos && pos.x === u.x) addFront(enemy[k], hp);
            }
        }
    }

    env.asAttacker(() => {
        for (const u of d.a) {
            const unit = env.unit(u.i);
            const hp = emptyHp();
            hp.max = Math.max(env.maxHealth(u.l, unit, false, d.am), u.h * 16);
            hp.start = u.h * 16;
            hp.end = sim[u.ci] !== undefined ? sim[u.ci].h : u.h * 16;
            const res = repairCost(costsFor(unit, u), hp);
            add(offense.overall, hp, res);
            const group = offenseGroup(unit.mt, E);
            if (group) add(offense[group], hp, res);
        }
    });
    return stats;
}

function buildingKind(techName, tech) {
    if (techName === tech.cy) return 'cy';
    if (techName === tech.cc) return 'cc';
    if (techName === tech.barracks) return 'barracks';
    if (techName === tech.factory) return 'factory';
    if (techName === tech.airport) return 'airport';
    if (techName === tech.df) return 'df';
    if (techName === tech.dhq) return 'dhq';
    if (tech.support.includes(techName)) return 'support';
    return null;
}

/** 'infantry' | 'vehicle' | 'aircraft' | null, from the movement type. */
export function offenseGroup(mt, E) {
    if (mt === E.Feet) return 'infantry';
    if (mt === E.Wheel || mt === E.Track) return 'vehicle';
    if (mt === E.Air || mt === E.Air2) return 'aircraft';
    return null;
}

// ─── Formation ───────────────────────────────────────────────────────

/**
 * Cache key of a formation (TABS hashes the same fields): the own city plus,
 * per enabled living unit, cell, type and level - order independent.
 * @param {Array<{x, y, i, l, enabled, h}>} units
 */
export function formationKey(units, ownId) {
    const parts = units
        .filter(u => u.enabled && u.h > 0)
        .map(u => [u.x, u.y, u.i, u.l])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3])
        .map(p => p.join(','));
    return `${ownId}|${parts.join(';')}`;
}

/**
 * The formation that was simulated, with the simulation's own unit fields
 * (ci, h, …) on each unit that matches by garrison state, type, level and cell.
 */
export function mergeFormation(formation, attackers) {
    for (const f of formation) {
        for (const a of attackers) {
            if (f.gs === a.gs && f.i === a.i && f.l === a.l && f.x === a.x && f.y === a.y) Object.assign(f, a);
        }
    }
    return formation;
}

// ─── Cache ───────────────────────────────────────────────────────────

/**
 * Simulation results per target, per formation key (TABS.CACHE). An entry
 * stops counting (valid = false) when the target changes (version), when the
 * own base's repair state changes, or when the alliance POI bonuses change
 * while the base is not repairing.
 */
export class SimCache {
    constructor() {
        this.cities = {};   // targetId -> { data: {version, recovery, air, inf, veh}, entries: {key: entry} }
    }

    city(targetId) {
        if (!this.cities[targetId]) this.cities[targetId] = { data: {}, entries: {} };
        return this.cities[targetId];
    }

    /**
     * Re-validate against the current game state, then the valid entry for `key`.
     * @param {object} state — { version: target version (-1 unknown), own: null | { version, recovery, poi: {air, inf, veh} | null } }
     */
    check(targetId, key, state) {
        this._validate(targetId, key, state);
        return this.get(targetId, key);
    }

    get(targetId, key) {
        const entry = this.city(targetId).entries[key];
        return entry && entry.valid ? entry : null;
    }

    add(targetId, key, entry) {
        this.city(targetId).entries[key] = { ...entry, valid: true };
    }

    /** Entries for the target, valid or not (the panel's count). */
    count(targetId) {
        const c = this.cities[targetId];
        return c ? Object.keys(c.entries).length : 0;
    }

    clear(targetId) {
        delete this.cities[targetId];
    }

    /** All entries for the target, valid or not. */
    entries(targetId) {
        const c = this.cities[targetId];
        return c ? Object.entries(c.entries).map(([key, entry]) => ({ key, entry })) : [];
    }

    /** The preset column's pick: see bestEntry. */
    best(targetId, criteria) {
        return bestEntry(this.entries(targetId), criteria);
    }

    _validate(targetId, key, state) {
        const c = this.city(targetId);
        const invalidateAll = () => { for (const k in c.entries) c.entries[k].valid = false; };
        if (state.version !== -1 && c.data.version !== state.version) {
            c.data.version = state.version;
            invalidateAll();
        }
        const own = state.own;
        if (!own || own.version === -1) return;
        const entry = c.entries[key];
        if (entry && entry.recovery !== own.recovery) entry.valid = false;
        const poi = own.poi;
        if (poi && own.recovery === false
            && (c.data.air !== poi.air || c.data.inf !== poi.inf || c.data.veh !== poi.veh)) {
            c.data.air = poi.air;
            c.data.inf = poi.inf;
            c.data.veh = poi.veh;
            if (state.version !== -1) c.data.version = state.version;
            invalidateAll();
        }
    }
}

// ─── Presets ─────────────────────────────────────────────────────────

/** Battle duration counts up to 2 minutes; longer is as bad as 2 minutes. */
const MAX_DURATION_MS = 120000;

/** HP left of a group plus what stands in front of it, within 0 .. max (+ front). */
function hpWithFront(hp) {
    return Math.min(Math.max(hp.end + hp.endFront, 0), hp.max + hp.maxFront);
}

/**
 * Criteria a preset ranks the cached simulations by. Each maps stats to a
 * number; lower is better.
 */
export const CRITERIA = {
    /** Enemy group (cy, overall, …) left standing, its front included. */
    enemyLeft: (group) => (s) => hpWithFront(s.enemy[group].hp),
    /** The slowest of the three offense repair times. */
    offenseRepair: (s) => {
        const r = s.offense.overall.res;
        return Math.max(r[RES.RC_AIR], r[RES.RC_INF], r[RES.RC_VEH]);
    },
    /** Own units left - more is better, hence negative. */
    offenseLost: (s) => -hpWithFront(s.offense.overall.hp),
    duration: (s) => Math.min(Math.max(s.battleDuration, 0), MAX_DURATION_MS),
};

/**
 * Columns of the statistics window. `live` shows the current formation; a
 * preset shows the best cached simulation by its criteria (TABS' presets).
 * CY: construction yard (with what stands in front of it) first, then the
 * whole enemy base, then the own repair time, own losses, battle duration.
 */
export const PRESETS = {
    live: { id: 'live', name: 'live', criteria: null },
    cy: {
        id: 'cy',
        name: 'CY',
        criteria: [CRITERIA.enemyLeft('cy'), CRITERIA.enemyLeft('overall'), CRITERIA.offenseRepair,
            CRITERIA.offenseLost, CRITERIA.duration],
    },
};

/** Compare two stats by the criteria in order; the first difference decides. */
export function compareByCriteria(a, b, criteria) {
    for (const c of criteria) {
        const d = c(a) - c(b);
        if (d) return d;
    }
    return 0;
}

/**
 * Best {key, entry} by the criteria: the best valid one, else the best of
 * the invalid ones (as TABS), null without entries.
 */
export function bestEntry(list, criteria) {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => compareByCriteria(a.entry.stats, b.entry.stats, criteria));
    return sorted.find(x => x.entry.valid) || sorted[0];
}

// ─── Display ─────────────────────────────────────────────────────────

/** "37.5 %" — 0 decimals at 0/100 and beyond, 1 from 10 %, else 2 (TABS). */
export function formatPercent(part, whole) {
    const percent = (part / whole) * 100;
    const digits = percent <= 0 || percent >= 100 ? 0 : (percent >= 10 ? 1 : 2);
    const rounded = Math.round(percent * Math.pow(10, digits)) / Math.pow(10, digits);
    return `${rounded.toFixed(digits)} %`;
}

/** 0 = green, 0.5 = yellow, 1 = red; darker towards both ends (TABS' colour scale). */
export function colorFromRatio(value) {
    if (!Number.isFinite(value)) return null;
    const hue = 120 * (1 - value);
    const light = 25 + Math.round((Math.max(value - 0.4, 0) * 2 + Math.max(0.4 - value, 0)) * 25);
    return `hsl(${hue}, 100%, ${light}%)`;
}

/** 'total-defeat' | 'total-victory' | 'victory' (TABS: offense gone first, then enemy gone). */
export function battleOutcome(stats) {
    if (stats.offense.overall.hp.end <= 0) return 'total-defeat';
    if (stats.enemy.overall.hp.end <= 0) return 'total-victory';
    return 'victory';
}

// ─── Statistics window: cell contents ────────────────────────────────

/** Defender rows in window order; the first three always show. */
export const ENEMY_ROWS = ['overall', 'defense', 'structure', 'cy', 'df', 'cc', 'barracks', 'factory', 'airport', 'support'];
const ALWAYS_SHOWN = new Set(['overall', 'structure', 'cy']);
export const REPAIR_ROWS = ['storage', 'overall', 'crystal', 'infantry', 'vehicle', 'aircraft'];
export const LOOT_ROWS = ['tiberium', 'crystal', 'credits', 'research', 'total'];
const LOOT_TYPES = {
    tiberium: [RES.TIB], crystal: [RES.CRY], credits: [RES.CREDITS], research: [RES.RP],
    total: [RES.TIB, RES.CRY, RES.CREDITS, RES.RP],
};
const EMPTY = { text: '-', color: null };

/**
 * Which optional Defender rows show: a group the target has, judged by the
 * live column (TABS judges by its first column). Without stats only the
 * fixed rows.
 */
export function visibleEnemyRows(liveStats) {
    return ENEMY_ROWS.filter(k => ALWAYS_SHOWN.has(k) || (liveStats && liveStats.enemy[k].hp.max > 0));
}

/** HP left "37.5 %", coloured by what is left. */
function hpCell(entity) {
    const hp = entity && entity.hp;
    if (!hp || hp.max <= 0) return EMPTY;
    return { text: formatPercent(hp.end, hp.max), color: colorFromRatio(hp.end / hp.max) };
}

/** Repair time, coloured by how much of that group was lost. */
function repairCell(entity, seconds, fmt) {
    const hp = entity && entity.hp;
    if (!hp || hp.max <= 0) return EMPTY;
    return { text: fmt.time(seconds), color: colorFromRatio(1 - hp.end / hp.max) };
}

/** Loot from the battle, coloured by the share of what the base holds. */
function lootCell(stats, loot, types, fmt) {
    if (!stats || stats.enemy.overall.hp.max <= 0 || !loot) return EMPTY;
    const got = types.reduce((s, k) => s + stats.enemy.overall.res[k], 0);
    const all = types.reduce((s, k) => s + (loot[k] || 0), 0);
    return { text: fmt.number(got), color: colorFromRatio(1 - got / all) };
}

/**
 * Everything one column of the statistics window shows.
 * @param {object|null} view — { stats, base, morale: {text, level}|null, storage: seconds|null, loot }
 * @param {{time: (s) => string, number: (n) => string}} fmt — the game's formatters
 * @returns {{battle, enemy, repair, loot}} cells {text, color, glow?}; outcome as a key
 */
export function columnCells(view, fmt) {
    const s = view && view.stats;
    const e = s ? s.enemy : null;
    const o = s ? s.offense : null;
    const rc = o ? o.overall.res : null;
    const battle = {
        outcome: s ? battleOutcome(s) : null,
        duration: { text: s && s.battleDuration > 0 ? fmt.time(s.battleDuration / 1000) : '-:--', color: null },
        base: { text: view && view.base ? view.base : '-', color: null },
        morale: view && view.morale ? {
            text: view.morale.text,
            color: view.morale.level === 2 ? '#ff4d4d' : (view.morale.level === 1 ? '#ff9a3c' : null),
        } : EMPTY,
    };
    const enemy = {};
    for (const k of ENEMY_ROWS) enemy[k] = hpCell(e && e[k]);
    const has = o && o.overall.hp.max > 0;
    const repair = {
        storage: { text: view && view.storage !== null && view.storage !== undefined ? fmt.time(view.storage) : '-', color: null },
        // the slowest repair type: TABS' "repair points" row, the bottleneck, glows
        overall: { ...repairCell(o && o.overall, rc ? Math.max(rc[RES.RC_BASE], rc[RES.RC_AIR], rc[RES.RC_INF], rc[RES.RC_VEH]) : 0, fmt), glow: true },
        crystal: has ? { text: fmt.number(rc[RES.CRY]), color: colorFromRatio(1) } : EMPTY,
        infantry: repairCell(o && o.infantry, rc ? rc[RES.RC_INF] : 0, fmt),
        vehicle: repairCell(o && o.vehicle, rc ? rc[RES.RC_VEH] : 0, fmt),
        aircraft: repairCell(o && o.aircraft, rc ? rc[RES.RC_AIR] : 0, fmt),
    };
    const loot = {};
    for (const k of LOOT_ROWS) loot[k] = lootCell(s, view && view.loot, LOOT_TYPES[k], fmt);
    return { battle, enemy, repair, loot };
}
