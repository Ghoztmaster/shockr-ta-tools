/**
 * formation-saver.js — save attack formations by name and load them back
 * (replaces SoO "TA Formation Saver").
 *
 * Commands (attack setup view only, with a target open):
 *   /st formation save <name>    save the current offense formation
 *   /st formation load <name>    put the army back in that formation
 *   /st formation list           saved formations of this world
 *   /st formation delete <name>  remove one
 *
 * A formation = per offense unit its type (MdbId), level, cell (x 0-8, y 0-3)
 * and enabled flag. Offense only — defense is never read or changed.
 *
 * Storage: localStorage 'st-formations' = { [worldId]: [{name, base, units,
 * savedAt}] }; names unique per world (case-insensitive), max 30 chars.
 * Nothing goes to the server, and no battle is ever started.
 *
 * Client route = the reference script's (TA_Formation_Saver 2.x):
 *   cities.get_CurrentOwnCity().get_CityArmyFormationsManager()
 *       .GetFormationByTargetBaseId(<target id>).get_ArmyUnits().l
 *   unit.get_CoordX/get_CoordY/get_Enabled, unit.MoveBattleUnit(x, y),
 *   unit.set_Enabled(e)
 * Differences from the reference, on purpose:
 *   - The reference restores by ARRAY INDEX (unit i of the save → unit i of
 *     the army), which only works on the same base/army. Here units are
 *     matched by TYPE (MdbId, same level preferred), so a formation also loads
 *     on another target, and units that are missing are reported.
 *   - The reference stores per target + own base; here per world by name.
 *   - Moving onto an occupied cell swaps in the client, so placement runs in
 *     passes until every matched unit sits on its cell (max units + 2).
 * Fallback when a unit has no MoveBattleUnit: formation.MoveBattleUnit(id, x, y)
 * (the MehrStrom CY-Optimizer route) — not verified live in this script.
 * Target id: get_CurrentForeignCityId(), else get_CurrentCity().get_Id()
 * (the reference uses the latter).
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';

const STORAGE_KEY = 'st-formations';
const NAME_MAX = 30;

// ─── Pure helpers (exported for tests) ───────────────────────────────

/** Trimmed, max NAME_MAX chars; '' if empty. */
export function cleanName(name) {
    return String(name || '').trim().slice(0, NAME_MAX);
}

export function loadStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

export function saveStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        return true;
    } catch (e) {
        console.warn('[ST] FormationSaver: save failed', e);
        return false;
    }
}

export function findFormation(list, name) {
    const key = cleanName(name).toLowerCase();
    return (list || []).find(f => f.name.toLowerCase() === key) || null;
}

/**
 * Assign saved units to army units by type: per saved unit an unused army
 * unit with the same MdbId, same level first, else the closest level.
 * @param {Array<{type, level, x, y, enabled}>} saved
 * @param {Array<{id, type, level}>} army
 * @returns {{moves: Array<{id, x, y, enabled}>, missing: Array<{type, name, level}>}}
 */
export function matchUnits(saved, army) {
    const used = new Set();
    const moves = [];
    const missing = [];
    for (const s of saved) {
        let best = null;
        for (const a of army) {
            if (used.has(a.id) || a.type !== s.type) continue;
            if (!best || Math.abs(a.level - s.level) < Math.abs(best.level - s.level)) best = a;
        }
        if (best) {
            used.add(best.id);
            moves.push({ id: best.id, x: s.x, y: s.y, enabled: s.enabled });
        } else {
            missing.push({ type: s.type, name: s.name, level: s.level });
        }
    }
    return { moves, missing };
}

/** "2× Predator, 1× Firehawk" */
export function summarizeMissing(missing) {
    const counts = new Map();
    for (const m of missing) {
        const name = m.name || String(m.type);
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts, ([name, n]) => `${n}× ${name}`).join(', ');
}

// ─── Client access ───────────────────────────────────────────────────

function worldId() {
    try {
        return String(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId());
    } catch {
        return null;
    }
}

/** True in the attack setup view. */
function inCombatSetup() {
    try {
        return ClientLib.Vis.VisMain.GetInstance().get_Mode() === ClientLib.Vis.Mode.CombatSetup;
    } catch {
        return false;
    }
}

/** The offense formation against the open target, or null. */
function currentFormation() {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    const own = cities.get_CurrentOwnCity();
    let targetId = 0;
    try { targetId = cities.get_CurrentForeignCityId(); } catch { /* fallback below */ }
    if (!targetId) {
        try { targetId = cities.get_CurrentCity().get_Id(); } catch { /* none */ }
    }
    if (!own || !targetId || targetId === own.get_Id()) return null;
    const formation = own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(targetId);
    if (!formation) return null;
    const units = formation.get_ArmyUnits();
    if (!units || !units.l) return null;
    return { formation, units: units.l, own };
}

function unitType(unit) {
    try {
        if (typeof unit.get_MdbUnitId === 'function') return unit.get_MdbUnitId();
    } catch { /* next */ }
    try { return unit.get_UnitGameData_Obj().i; } catch { return null; }
}

function unitName(unit) {
    try {
        const gd = unit.get_UnitGameData_Obj();
        return gd.dn || gd.n || String(unitType(unit));
    } catch {
        return String(unitType(unit));
    }
}

function unitLevel(unit) {
    try { return Number(unit.get_CurrentLevel()) || 0; } catch { return 0; }
}

function unitId(unit) {
    try { return unit.get_Id(); } catch { return null; }
}

/** Saved form of the army's units. */
function readUnits(units) {
    return units.map(u => ({
        type: unitType(u),
        name: unitName(u),
        level: unitLevel(u),
        x: u.get_CoordX(),
        y: u.get_CoordY(),
        enabled: typeof u.get_Enabled === 'function' ? !!u.get_Enabled() : true,
    }));
}

/** Move one unit; unit-level MoveBattleUnit (reference) first, formation-level as fallback. */
function moveUnit(formation, unit, x, y) {
    if (typeof unit.MoveBattleUnit === 'function') {
        unit.MoveBattleUnit(x, y);
    } else if (typeof formation.MoveBattleUnit === 'function') {
        formation.MoveBattleUnit(unit.get_Id(), x, y);
    }
}

/**
 * Place the matched units; repeats while swaps knocked placed units off.
 * @returns {number} units on their target cell at the end
 */
export function applyMoves(formation, units, moves) {
    const byId = new Map(units.map(u => [unitId(u), u]));
    const at = (m) => {
        const u = byId.get(m.id);
        return u && u.get_CoordX() === m.x && u.get_CoordY() === m.y;
    };
    for (let pass = 0; pass < moves.length + 2; pass++) {
        let changed = false;
        for (const m of moves) {
            if (at(m)) continue;
            try {
                moveUnit(formation, byId.get(m.id), m.x, m.y);
                changed = true;
            } catch (e) {
                console.warn('[ST] FormationSaver: move failed', e && e.message);
            }
        }
        if (!changed) break;
    }
    for (const m of moves) {
        const u = byId.get(m.id);
        if (!u || m.enabled === undefined) continue;
        try {
            if (typeof u.set_Enabled === 'function') u.set_Enabled(m.enabled);
        } catch { /* keep as is */ }
    }
    return moves.filter(at).length;
}

// ─── Plugin ──────────────────────────────────────────────────────────

export class FormationSaver {
    /** Short description for `/st help`. */
    get description() { return t('descFormationSaver'); }

    constructor(config, cli) {
        this.name = 'FormationSaver';
        this.config = config;
        this.cli = cli;
        this.running = false;
    }

    async start() {
        this.running = true;
        this.cli.register('formation', (args) => this.command(args || []));
        console.log('[ST] FormationSaver: started');
    }

    stop() {
        this.running = false;
    }

    /** `/st formation save|load|list|delete [name]` */
    command(args) {
        if (!this.running) return;
        const [action, ...rest] = args;
        const name = cleanName(rest.join(' '));
        switch (String(action || '').toLowerCase()) {
            case 'save': return name ? this.save(name) : say(escapeHtml(t('formationUsage')));
            case 'load': return name ? this.load(name) : say(escapeHtml(t('formationUsage')));
            case 'delete': return name ? this.remove(name) : say(escapeHtml(t('formationUsage')));
            case 'list': return this.list();
            default: return say(escapeHtml(t('formationUsage')));
        }
    }

    save(name) {
        const ctx = this._context();
        if (!ctx) return;
        const units = readUnits(ctx.units);
        if (!units.length) return say(t('formationNoUnits'));
        const store = loadStore();
        const list = store[ctx.world] || [];
        const existing = findFormation(list, name);
        const entry = { name, base: safeName(ctx.own), units, savedAt: Date.now() };
        store[ctx.world] = existing ? list.map(f => (f === existing ? entry : f)) : [...list, entry];
        if (!saveStore(store)) return say(t('formationStorageFailed'));
        say(t(existing ? 'formationOverwritten' : 'formationSaved', { name: escapeHtml(name), count: units.length }));
    }

    load(name) {
        const ctx = this._context();
        if (!ctx) return;
        const saved = findFormation(loadStore()[ctx.world], name);
        if (!saved) return say(t('formationNotFound', { name: escapeHtml(name) }));
        const army = ctx.units.map(u => ({ id: unitId(u), type: unitType(u), level: unitLevel(u) }));
        const { moves, missing } = matchUnits(saved.units, army);
        const placed = applyMoves(ctx.formation, ctx.units, moves);
        const total = saved.units.length;
        let msg = t('formationLoaded', { name: escapeHtml(saved.name), placed, total });
        if (missing.length) msg += ' — ' + t('formationMissing', { units: escapeHtml(summarizeMissing(missing)) });
        say(msg);
        console.log(`[ST] FormationSaver: loaded "${saved.name}" ${placed}/${total}, missing ${missing.length}`);
    }

    list() {
        const world = worldId();
        const list = (world && loadStore()[world]) || [];
        if (!list.length) return say(t('formationListEmpty'));
        say(t('formationListHeader', { count: list.length }));
        for (const f of list) {
            const date = new Date(f.savedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
            say(`${escapeHtml(f.name)} — ${t('formationListLine', { count: f.units.length, base: escapeHtml(f.base || '?'), date })}`);
        }
    }

    remove(name) {
        const world = worldId();
        if (!world) return;
        const store = loadStore();
        const list = store[world] || [];
        const found = findFormation(list, name);
        if (!found) return say(t('formationNotFound', { name: escapeHtml(name) }));
        store[world] = list.filter(f => f !== found);
        if (!saveStore(store)) return say(t('formationStorageFailed'));
        say(t('formationDeleted', { name: escapeHtml(found.name) }));
    }

    /** World + formation in the attack setup view, or null after telling the player why. */
    _context() {
        const world = worldId();
        if (!world || !inCombatSetup()) {
            say(t('formationNotInSetup'));
            return null;
        }
        let ctx = null;
        try { ctx = currentFormation(); } catch (e) { console.warn('[ST] FormationSaver: formation not readable', e); }
        if (!ctx) {
            say(t('formationNotInSetup'));
            return null;
        }
        return { ...ctx, world };
    }
}

function safeName(city) {
    try { return city.get_Name(); } catch { return ''; }
}

function say(msg) {
    chatMessage(`[ST] ${msg}`);
}
