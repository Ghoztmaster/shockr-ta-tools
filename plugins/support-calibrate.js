// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * support-calibrate.js — calibrate every support weapon in range on one base,
 * and recall support, per base or all at once.
 *
 * On by default. Two entry points (the panel moved to BaseStatus in 5.45.0):
 *   1. World map, menu of an own or alliance base: "Calibrate all support".
 *      Every own base whose support weapon reaches that base gets
 *      SetDedicatedSupport(target). Bases already calibrated on it are left
 *      alone (setting it again could restart the calibration); the chat says
 *      how many were calibrated, already on it, or out of range.
 *   2. `/st support recall` (all) / `/st support recall <base name>`.
 *   recallCity / recallAll are also used by the BaseStatus panel.
 *
 * Game API (the same calls as MaelstromTools' support functions; own implementation):
 *   menu hook:  webfrontend.gui.region.RegionCityMenu.prototype.showMenu(visObject) wrapped;
 *               our qx button goes into the menu's Composite children (MaelstromTools' spot),
 *               shown only for visObject.get_VisObjectType() == RegionCityType with
 *               get_Type() Own or Alliance
 *   target:     visObject.get_Id(), get_RawX(), get_RawY(), get_Name()
 *   weapon:     city.get_SupportWeapon() (null = none), range weapon.r;
 *               in range: (x - targetX)² + (y - targetY)² <= r²
 *   calibrate:  city.SetDedicatedSupport(targetId); current: city.get_SupportDedicatedBaseId() / ...BaseName()
 *   recall:     city.RecallDedicatedSupport()
 * On stop: the original showMenu is put back (when nobody wrapped after us)
 * and our buttons are removed.
 *
 * Diagnostics (5.43.0, the menu button did not show up live): `/st support debug`
 * logs to the console whether our wrapper is still on showMenu, how often it
 * ran, and the structure of the menu (own keys with qx classname / basename,
 * inherited Composite keys, and the widget tree with button labels). The first
 * menu open also logs how many Composites were found, and warns when none.
 * VERIFIED LIVE (2026-11-09): the Composite route (a test button showed up in the
 * menu of an own base) and the support getters; calibrating itself not (the test
 * account has no support weapon).
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ownBases } from '../lib/overview-panel.js';

/** Map position of an own base (data city); get_X/get_Y as MaelstromTools, else get_PosX/Y. */
function cityPos(city) {
    const x = typeof city.get_X === 'function' ? city.get_X() : city.get_PosX();
    const y = typeof city.get_Y === 'function' ? city.get_Y() : city.get_PosY();
    return { x: Number(x), y: Number(y) };
}

function supportWeapon(city) {
    try {
        return typeof city.get_SupportWeapon === 'function' ? city.get_SupportWeapon() : null;
    } catch {
        return null;
    }
}

function dedicatedId(city) {
    try {
        return Number(city.get_SupportDedicatedBaseId()) || 0;
    } catch {
        return 0;
    }
}

/** May "Calibrate all support" be offered for this world-map object? Own or alliance base only. */
export function isSupportTarget(visObject) {
    try {
        if (!visObject) return false;
        if (visObject.get_VisObjectType() !== ClientLib.Vis.VisObject.EObjectType.RegionCityType) return false;
        const T = ClientLib.Vis.Region.RegionCity.ERegionCityType;
        const type = visObject.get_Type();
        return type === T.Own || type === T.Alliance;
    } catch {
        return false;
    }
}

/**
 * Calibrate every own support weapon that reaches the target.
 * @param {{id: number, x: number, y: number}} target
 * @returns {{calibrated: string[], already: string[], outOfRange: string[]}} base names
 */
export function calibrateAll(target) {
    const out = { calibrated: [], already: [], outOfRange: [] };
    for (const city of ownBases()) {
        let name = '?';
        try {
            name = city.get_Name();
            const weapon = supportWeapon(city);
            if (!weapon) continue;
            const r = Number(weapon.r);
            const p = cityPos(city);
            const dx = p.x - target.x;
            const dy = p.y - target.y;
            if (!(r > 0) || dx * dx + dy * dy > r * r) {
                out.outOfRange.push(name);
                continue;
            }
            if (dedicatedId(city) === target.id) {
                out.already.push(name);
                continue;
            }
            city.SetDedicatedSupport(target.id);
            out.calibrated.push(name);
            console.log(`[ST] SupportCalibrate: ${name} - SetDedicatedSupport(${target.id})`);
        } catch (err) {
            console.error(`[ST] SupportCalibrate: ${name} - calibrate failed`, err);
        }
    }
    return out;
}

/** Recall the support of one base; true when it was calibrated somewhere. */
export function recallCity(city) {
    if (!dedicatedId(city)) return false;
    city.RecallDedicatedSupport();
    console.log(`[ST] SupportCalibrate: ${city.get_Name()} - RecallDedicatedSupport()`);
    return true;
}

/** Recall every calibrated support weapon. @returns {string[]} base names recalled */
export function recallAll() {
    const names = [];
    for (const city of ownBases()) {
        try {
            if (recallCity(city)) names.push(city.get_Name());
        } catch (err) {
            console.error('[ST] SupportCalibrate: recall failed', err);
        }
    }
    return names;
}

// ─── Diagnostics helpers ─────────────────────────────────────────────

function qxName(o) {
    try {
        return o && typeof o === 'object' ? (o.classname || (o.constructor && o.constructor.classname) || null) : null;
    } catch {
        return null;
    }
}

function widgetLabel(o) {
    try { return typeof o.getLabel === 'function' ? o.getLabel() : undefined; } catch { return undefined; }
}

/** Widget tree (qx getChildren), depth-limited: [{cls, base, label, children}]. */
function widgetTree(w, depth = 0) {
    if (!w || depth > 5) return [];
    let kids = [];
    try { kids = typeof w.getChildren === 'function' ? w.getChildren() : []; } catch { kids = []; }
    return (kids || []).map(k => ({
        cls: qxName(k),
        base: k && k.basename,
        label: widgetLabel(k),
        children: widgetTree(k, depth + 1),
    }));
}

/** A RegionCityMenu instance: own keys holding qx objects, inherited Composite keys, widget tree. */
export function describeMenu(menu) {
    const own = [];
    const inherited = [];
    try {
        for (const k in menu) {
            let v;
            try { v = menu[k]; } catch { continue; }
            if (!v || typeof v !== 'object' || !qxName(v)) continue;
            const entry = { key: k, cls: qxName(v), base: v.basename, label: widgetLabel(v) };
            if (Object.prototype.hasOwnProperty.call(menu, k)) own.push(entry);
            else if (v.basename === 'Composite') inherited.push(entry);
        }
    } catch { /* partial */ }
    return { cls: qxName(menu), own, inheritedComposites: inherited, tree: widgetTree(menu) };
}

/** What the menu got: vis object type, city type and our verdict (debug). */
function describeTarget(v, allowed) {
    const get = (fn) => { try { return fn(); } catch { return null; } };
    return {
        visType: get(() => v.get_VisObjectType()),
        regionCityType: get(() => ClientLib.Vis.VisObject.EObjectType.RegionCityType),
        type: get(() => v.get_Type()),
        ownAlliance: get(() => [ClientLib.Vis.Region.RegionCity.ERegionCityType.Own, ClientLib.Vis.Region.RegionCity.ERegionCityType.Alliance]),
        name: get(() => v.get_Name()),
        allowed,
    };
}

/** RegionCityMenu instances from the qx object registry (debug before the menu was ever opened). */
function findMenuInstances() {
    const out = [];
    try {
        const Cls = webfrontend.gui.region.RegionCityMenu;
        const reg = qx.core.ObjectRegistry.getRegistry();
        for (const k in reg) if (reg[k] instanceof Cls) out.push(reg[k]);
    } catch { /* no registry */ }
    return out;
}

export class SupportCalibrate {
    /** Short description for `/st help`. */
    get description() { return t('descSupportCalibrate'); }

    constructor(config, cli) {
        this.name = 'SupportCalibrate';
        this.config = config;
        this.cli = cli;
        this.running = false;
        this._proto = null;
        this._original = null;
        this._wrapper = null;
        this._buttons = [];            // qx buttons we added
        this._menus = new Set();       // menu instances that carry them
        this._diag = { calls: 0, lastError: null, composites: null };
        this._target = null;           // visObject of the open menu
    }

    async start() {
        this.running = true;
        this._installMenuHook();
        this.cli.register('support', (args) => this._command(args));
    }

    stop() {
        this.running = false;
        this._removeMenuHook();
        this.cli.unregister('support');
    }

    /** One-line status for `/st status`. */
    statusText() {
        try {
            const bases = ownBases().filter(c => supportWeapon(c));
            return t('supportStatus', { n: bases.length, on: bases.filter(c => dedicatedId(c)).length });
        } catch {
            return t('supportStatusNoData');
        }
    }

    // ─── Chat command ────────────────────────────────────────────────

    _command(args) {
        const [action, ...rest] = args;
        if (action === 'debug') {
            this.debug();
            return;
        }
        if (action !== 'recall') {
            chatMessage(`[ST] ${escapeHtml(t('supportUsage'))}`);
            return;
        }
        const name = rest.join(' ').trim();
        if (!name || name.toLowerCase() === 'all') {
            this._reportRecall(recallAll());
            return;
        }
        const city = ownBases().find(c => c.get_Name().toLowerCase() === name.toLowerCase());
        if (!city) {
            chatMessage(`[ST] ${escapeHtml(t('supportUnknownBase', { name }))}`);
            return;
        }
        this._reportRecall(recallCity(city) ? [city.get_Name()] : []);
    }

    _reportRecall(names) {
        chatMessage(`[ST] ${escapeHtml(names.length ? t('supportRecalled', { bases: names.join(', ') }) : t('supportNothingToRecall'))}`);
    }

    // ─── Diagnostics ─────────────────────────────────────────────────

    /** `/st support debug`: hook state + menu structure to the console, a summary to the chat. */
    debug() {
        let proto = null;
        try { proto = webfrontend.gui.region.RegionCityMenu.prototype; } catch { proto = null; }
        const current = proto && proto.showMenu;
        const menus = [...this._menus];
        if (!menus.length) menus.push(...findMenuInstances());
        const report = {
            classFound: !!proto,
            hookInstalled: !!this._wrapper,
            wrapperIsCurrent: !!current && current === this._wrapper,
            currentShowMenuSource: typeof current === 'function' ? String(current).slice(0, 400) : String(current),
            wrapperCalls: this._diag.calls,
            lastError: this._diag.lastError,
            compositesFound: this._diag.composites,
            lastTarget: this._diag.lastTarget || null,
            buttonsAdded: this._buttons.length,
            menus: menus.map(describeMenu),
        };
        console.log('[ST] SupportCalibrate debug', report);
        try { console.log('[ST] SupportCalibrate debug (JSON)', JSON.stringify(report, null, 1)); } catch { /* cyclic: object log above */ }
        let hook = 'not installed';
        if (report.wrapperIsCurrent) hook = 'on top';
        else if (report.hookInstalled) hook = 'not on top';
        chatMessage(`[ST] ${escapeHtml(t('supportDebug', {
            hook,
            calls: report.wrapperCalls,
            composites: report.compositesFound === null ? '-' : report.compositesFound,
            menus: report.menus.length,
        }))}`);
        return report;
    }

    // ─── World-map menu ──────────────────────────────────────────────

    _installMenuHook() {
        let proto = null;
        try { proto = webfrontend.gui.region.RegionCityMenu.prototype; } catch { proto = null; }
        if (!proto || typeof proto.showMenu !== 'function') {
            console.warn('[ST] SupportCalibrate: RegionCityMenu.showMenu not found - no menu button (/st support recall still works)');
            return;
        }
        const plugin = this;
        const original = proto.showMenu;
        const wrapper = function (visObject) {
            try {
                plugin._diag.calls++;
                if (plugin.running) plugin._onShowMenu(this, visObject);
            } catch (err) {
                plugin._diag.lastError = err && err.message;
                console.error('[ST] SupportCalibrate: menu hook failed', err);
            }
            return original.apply(this, arguments);
        };
        proto.showMenu = wrapper;
        this._proto = proto;
        this._original = original;
        this._wrapper = wrapper;
    }

    _removeMenuHook() {
        if (this._proto && this._proto.showMenu === this._wrapper) this._proto.showMenu = this._original;
        // else: someone wrapped after us; our wrapper stays in the chain but is inert (running false)
        for (const b of this._buttons) {
            try {
                const parent = b.getLayoutParent();
                if (parent) parent.remove(b);
                b.dispose();
            } catch { /* already gone */ }
        }
        this._buttons = [];
        for (const m of this._menus) delete m.__stSupportButtons;   // a later start adds fresh buttons
        this._menus.clear();
        this._proto = this._original = this._wrapper = null;
    }

    /** First show of a menu instance: add our button to its Composite children; then show/hide it per target. */
    _onShowMenu(menu, visObject) {
        this._target = visObject;
        if (!menu.__stSupportButtons) {
            menu.__stSupportButtons = [];
            this._menus.add(menu);
            for (const k of Object.keys(menu)) {
                const c = menu[k];
                if (!c || c.basename !== 'Composite' || typeof c.add !== 'function') continue;
                const button = new qx.ui.form.Button(t('supportCalibrateAll'));
                button.addListener('execute', () => this._calibrateFromMenu());
                c.add(button);
                menu.__stSupportButtons.push(button);
                this._buttons.push(button);
            }
            this._diag.composites = menu.__stSupportButtons.length;
            console.log(`[ST] SupportCalibrate: menu opened first time - ${this._diag.composites} Composite(s) found for the button`);
            if (!this._diag.composites) {
                console.warn('[ST] SupportCalibrate: no Composite on the menu - structure:', describeMenu(menu));
            }
        }
        const show = isSupportTarget(visObject);
        this._diag.lastTarget = describeTarget(visObject, show);
        for (const b of menu.__stSupportButtons) {
            try {
                b.setLabel(t('supportCalibrateAll'));     // language switch
                b.setVisibility(show ? 'visible' : 'excluded');
            } catch { /* disposed */ }
        }
    }

    _calibrateFromMenu() {
        const v = this._target;
        if (!isSupportTarget(v)) return;
        let target;
        try {
            target = { id: v.get_Id(), x: Number(v.get_RawX()), y: Number(v.get_RawY()), name: v.get_Name() };
        } catch (err) {
            console.error('[ST] SupportCalibrate: target not readable', err);
            return;
        }
        const res = calibrateAll(target);
        const parts = [t('supportCalibrated', { name: target.name, n: res.calibrated.length })];
        if (res.already.length) parts.push(t('supportAlready', { n: res.already.length }));
        if (res.outOfRange.length) parts.push(t('supportOutOfRange', { n: res.outOfRange.length }));
        chatMessage(`[ST] ${escapeHtml(parts.join(' · '))}`);
    }
}
