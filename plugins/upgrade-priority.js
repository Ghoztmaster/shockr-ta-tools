// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * upgrade-priority.js — which production building to upgrade first, per resource.
 *
 * On by default. Shockr toolbar (arrow-up icon) or `/st upgrades`. Tabs
 * Tiberium / Crystal / Power / Credits. Per base, per building that produces
 * that resource: type (x:y), to level, gain/h, factor, Tiberium and Power cost,
 * Tib/gain, Pow/gain, ETA (until the base can pay it) and an Upgrade button.
 * Filters per tab: only top buildings, only affordable, per base on/off;
 * "Upgrade all" upgrades every affordable row shown. Tab and filters are
 * kept in the config (localStorage): upgradeprio.tab, upgradeprio.top.<tab>,
 * upgradeprio.affordable.<tab>, upgradeprio.city.<tab>.<cityId>.
 *
 * UpgradeCalc (upgrade-calc.js) stays separate: that one shows the costs of
 * the current base; this one ranks the production buildings of all bases.
 *
 * Rules (the HuffyTools.UpgradePriority logic in MaelstromTools 0.1.5.5,
 * own implementation; facts = game API + formulas):
 *   buildings:  city.get_Buildings().d; skipped when level + 1 > Server.get_PlayerUpgradeCap()
 *               Tiberium/Crystal tab: Harvester (+ Harvester_Crystal), Silo
 *               Power: PowerPlant, Accumulator      Credits: Refinery, PowerPlant
 *   detail:     dv = city.GetBuildingDetailViewInfo(building); m = dv.OwnProdModifiers.d
 *   gain/h:     m[<res>Production].NewLvlDelta
 *             + package size: main = m[building.get_MainModifierTypeId()], p = m[<res>PackageSize]
 *               3600 / (main.TotalValue + main.NewLvlDelta) * (p.TotalValue + p.NewLvlDelta)
 *               - 3600 / main.TotalValue * p.TotalValue
 *   cost:       ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(level + 1, building.get_TechGameData_Obj())
 *   factor:     max over the cost types of 3600 * (cost / gain) / production/h of that type (lower = better);
 *               rows sorted by factor per base
 *   ETA:        max over Tiberium/Power of 3600 * (cost - in stock) / production/h
 *   state:      affordable (enough in the base) / by transfer (Power enough and all bases together
 *               have the Tiberium) / not affordable; only rows with gain > 0
 *   top:        the first not-affordable row, the row just before the first affordable one
 *               (without an affordable one: the last row) and the first affordable row
 *   upgrade:    CommunicationManager.SendCommand('UpgradeBuilding', {cityid, posX, posY, isPaid: true})
 * Deviations from HuffyTools: the "by transfer" total really sums the Tiberium of
 * all bases (HuffyTools read an empty cache, so it was always 0); "top" lists a row
 * only once; "Upgrade all" goes through the shown affordable rows in order (HuffyTools
 * popped from the end and stopped at the first row that was not affordable).
 * NOT VERIFIED LIVE: GetBuildingDetailViewInfo / OwnProdModifiers / UpgradeBuilding
 * on the current client.
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { OverviewPanel, ownBases, openBase, compact } from '../lib/overview-panel.js';
import { readCity } from './production-overview.js';
import { formatDuration } from './army-overview.js';

const TOOLBAR_ID = 'upgrades';
export const TABS = ['tib', 'cry', 'power', 'credits'];
const DEFAULT_TAB = 'credits';                 // HuffyTools opens on credits
const TAB_LABEL = { tib: 'resTiberium', cry: 'resCrystal', power: 'resPower', credits: 'resCredits' };
const UPGRADE_GAP_MS = 100;
const AFTER_UPGRADE_MS = 1000;                 // the game deducts the cost a moment after the command

export const STATE = { AFFORDABLE: 1, TRANSFER: 2, NO: 3 };

/** Tech names, modifiers and resource type of a tab (read from ClientLib at use). */
function tabSpec(tab) {
    const T = ClientLib.Base.ETechName;
    const M = ClientLib.Base.EModifierType;
    switch (tab) {
    case 'tib': return { techs: [T.Harvester, T.Harvester_Crystal, T.Silo], pkg: M.TiberiumPackageSize, prod: M.TiberiumProduction };
    case 'cry': return { techs: [T.Harvester, T.Harvester_Crystal, T.Silo], pkg: M.CrystalPackageSize, prod: M.CrystalProduction };
    case 'power': return { techs: [T.PowerPlant, T.Accumulator], pkg: M.PowerPackageSize, prod: M.PowerProduction };
    default: return { techs: [T.Refinery, T.PowerPlant], pkg: M.CreditsPackageSize, prod: M.CreditsProduction };
    }
}

/** Display name of a building type. */
function typeName(tech) {
    const T = ClientLib.Base.ETechName;
    const key = {
        [T.PowerPlant]: 'upPowerPlant', [T.Refinery]: 'upRefinery', [T.Harvester]: 'upHarvester',
        [T.Harvester_Crystal]: 'upHarvester', [T.Silo]: 'upSilo', [T.Accumulator]: 'upAccumulator',
    }[tech];
    return key ? t(key) : '?';
}

/**
 * Extra production per hour of the next level.
 * @param {object} mods — dv.OwnProdModifiers.d (modifier type → {TotalValue, NewLvlDelta})
 * @param {number|string} mainId — building.get_MainModifierTypeId()
 */
export function gainPerHour(mods, mainId, pkgType, prodType) {
    let gain = 0;
    for (const key of Object.keys(mods)) {
        const m = mods[key];
        const type = Number(key);
        if (type === Number(pkgType)) {
            const main = mods[mainId];
            if (!main) continue;
            const prev = 3600 / main.TotalValue * m.TotalValue;
            const next = 3600 / (main.TotalValue + main.NewLvlDelta) * (m.TotalValue + m.NewLvlDelta);
            const d = next - prev;
            if (Number.isFinite(d)) gain += d;
        } else if (type === Number(prodType)) {
            const d = Number(m.NewLvlDelta);
            if (Number.isFinite(d)) gain += d;
        }
    }
    return gain;
}

/**
 * Factor, ETA and state of one upgrade.
 * @param {{gain: number, costs: Object<number, number>, have: Object<number, number>,
 *          perHour: Object<number, number>, totalTib: number}} p — maps by EResourceType
 */
export function rate({ gain, costs, have, perHour, totalTib }) {
    const R = ClientLib.Base.EResourceType;
    let factor = 0;
    let eta = 0;
    let enough = true;
    let tibOk = true;
    let powerOk = true;
    for (const [type, count] of Object.entries(costs)) {
        if (!(count > 0)) continue;
        const prod = perHour[type] || 0;
        if (prod > 0) factor = Math.max(factor, 3600 * (count / gain) / prod);
        const missing = count - (have[type] || 0);
        if (missing > 0) {
            enough = false;
            if (Number(type) === R.Tiberium) tibOk = false;
            if (Number(type) === R.Power) powerOk = false;
            if (Number(type) === R.Tiberium || Number(type) === R.Power) {
                eta = Math.max(eta, prod > 0 ? 3600 * missing / prod : Infinity);
            }
        }
    }
    let state = STATE.NO;
    if (enough) state = STATE.AFFORDABLE;
    else if (powerOk && (tibOk || totalTib >= (costs[R.Tiberium] || 0))) state = STATE.TRANSFER;
    return { factor, eta, state };
}

/** HuffyTools' "only top buildings" pick on a factor-sorted list (each row once). */
export function topRows(rows) {
    if (!rows.length) return [];
    const firstNo = rows.findIndex(r => r.state !== STATE.AFFORDABLE);
    const firstYes = rows.findIndex(r => r.state === STATE.AFFORDABLE);
    const beforeYes = firstYes === -1 ? rows.length - 1 : firstYes - 1;
    const pick = new Set([firstNo, beforeYes, firstYes].filter(i => i >= 0));
    return [...pick].sort((a, b) => a - b).map(i => rows[i]);
}

function resMap(city) {
    const R = ClientLib.Base.EResourceType;
    const have = {};
    for (const type of [R.Tiberium, R.Crystal, R.Power]) {
        try { have[type] = Number(city.GetResourceCount(type)) || 0; } catch { have[type] = 0; }
    }
    return have;
}

function perHourMap(city) {
    const R = ClientLib.Base.EResourceType;
    let p = null;
    try { p = readCity(city, ClientLib.Data.MainData.GetInstance().get_Alliance()); } catch { p = null; }
    if (!p) return {};
    return { [R.Tiberium]: p.tib.total || 0, [R.Crystal]: p.cry.total || 0, [R.Power]: p.power.total || 0 };
}

/** Upgrade rows of one base for a tab, sorted by factor. */
export function cityRows(city, tab, totalTib) {
    const spec = tabSpec(tab);
    const R = ClientLib.Base.EResourceType;
    let cap = Infinity;
    try { cap = Number(ClientLib.Data.MainData.GetInstance().get_Server().get_PlayerUpgradeCap()) || Infinity; } catch { /* no cap */ }
    const have = resMap(city);
    const perHour = perHourMap(city);
    const rows = [];
    for (const b of Object.values(city.get_Buildings().d)) {
        try {
            const level = b.get_CurrentLevel();
            if (level + 1 > cap) continue;
            const tech = b.get_TechName();
            if (!spec.techs.includes(tech)) continue;
            const dv = city.GetBuildingDetailViewInfo(b);
            if (!dv || !dv.OwnProdModifiers) continue;
            const gain = gainPerHour(dv.OwnProdModifiers.d, b.get_MainModifierTypeId(), spec.pkg, spec.prod);
            if (!(gain > 0)) continue;
            const costs = {};
            for (const req of ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(level + 1, b.get_TechGameData_Obj()) || []) {
                if (!req || Number(req.Type) === 0) continue;
                costs[req.Type] = Number(req.Count) || 0;
            }
            const r = rate({ gain, costs, have, perHour, totalTib });
            const tib = costs[R.Tiberium] || 0;
            const power = costs[R.Power] || 0;
            rows.push({
                id: b.get_Id(),
                cityId: city.get_Id(),
                city: city.get_Name(),
                type: typeName(tech),
                x: b.get_CoordX(),
                y: b.get_CoordY(),
                level: level + 1,
                gain,
                factor: r.factor,
                tib,
                power,
                tibPerGain: tib / gain,
                powPerGain: power / gain,
                eta: r.eta,
                state: r.state,
            });
        } catch (err) {
            console.warn('[ST] UpgradePriority: building skipped', err && err.message);
        }
    }
    return rows.sort((a, b) => a.factor - b.factor);
}

/** Panel data for the selected tab and filters. */
export function readPriority(filters) {
    const { tab, top, affordable, cityOn } = filters;
    const R = ClientLib.Base.EResourceType;
    const bases = ownBases();
    let totalTib = 0;
    for (const c of bases) { try { totalTib += Number(c.GetResourceCount(R.Tiberium)) || 0; } catch { /* skip */ } }
    const cities = [];
    const rows = [];
    for (const city of bases) {
        const id = city.get_Id();
        const on = cityOn(id);
        cities.push({ id, name: city.get_Name(), on });
        if (!on) continue;
        let list = cityRows(city, tab, totalTib);
        if (affordable) list = list.filter(r => r.state === STATE.AFFORDABLE);
        if (top) list = topRows(list);
        rows.push(...list);
    }
    return { tab, top, affordable, cities, rows };
}

const BTN = 'cursor:pointer;padding:1px 8px;border:1px solid #5f8fb4;border-radius:3px;background:#0d2a40;color:#4fc3f7;white-space:nowrap;';

function check(on, label, view, id = 0) {
    return `<span data-id="${id}" data-view="${view}" style="cursor:pointer;white-space:nowrap;margin-right:12px;${on ? 'color:#fff;' : 'color:#888;'}">${on ? '☑' : '☐'} ${escapeHtml(label)}</span>`;
}

function fixed(n, digits) {
    if (!Number.isFinite(n)) return '—';
    return Math.abs(n) >= 1e4 ? compact(n) : n.toFixed(digits);
}

export function renderPriority(d) {
    const tabs = TABS.map((tab, i) => {
        const sel = tab === d.tab;
        return `<span data-id="${i}" data-view="tab" style="cursor:pointer;padding:3px 10px;margin-right:4px;border:1px solid ${sel ? '#5f8fb4' : '#444'};border-radius:3px 3px 0 0;${sel ? 'background:#0d2a40;color:#4fc3f7;' : 'color:#999;'}">${escapeHtml(t(TAB_LABEL[tab]))}</span>`;
    }).join('');
    let html = `<div style="margin:2px 0 8px;">${tabs}</div>`;
    html += '<div style="margin:0 0 6px;line-height:1.9;">'
        + check(d.top, t('upOnlyTop'), 'top')
        + check(d.affordable, t('upOnlyAffordable'), 'affordable')
        + `<span data-id="0" data-view="upgradeall" title="${escapeHtml(t('upUpgradeAllHint'))}" style="${BTN}">${escapeHtml(t('upUpgradeAll'))}</span>`
        + '</div><div style="margin:0 0 8px;line-height:1.9;">'
        + d.cities.map(c => check(c.on, c.name, 'city', c.id)).join('')
        + '</div>';
    if (!d.rows.length) return html + `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('upNone'))}</div>`;
    const th = 'padding:3px 5px;font-weight:normal;color:#999;white-space:nowrap;';
    const td = 'padding:3px 5px;white-space:nowrap;';
    const head = [
        ['ovColBase', 'left'], ['upColType', 'left'], ['upColLevel', 'right'], ['upColGain', 'right'], ['upColFactor', 'right'],
        ['resTiberium', 'right'], ['resPower', 'right'], ['upColTibGain', 'right'], ['upColPowGain', 'right'], ['upColEta', 'right'],
    ];
    html += '<table style="border-collapse:collapse;width:100%;"><tr style="border-bottom:1px solid #444;">'
        + head.map(([k, a]) => `<th style="${th}text-align:${a};">${escapeHtml(t(k))}</th>`).join('') + '<th></th></tr>';
    for (const r of d.rows) {
        let action = '';
        if (r.state === STATE.AFFORDABLE) action = `<span data-id="${r.id}" data-view="upgrade" style="${BTN}">${escapeHtml(t('upUpgrade'))}</span>`;
        else if (r.state === STATE.TRANSFER) action = `<span style="color:#e0b84f;" title="${escapeHtml(t('upTransferHint'))}">${escapeHtml(t('upTransfer'))}</span>`;
        const right = `${td}text-align:right;`;
        html += `<tr style="border-bottom:1px solid #2a2a2a;${r.state === STATE.NO ? 'color:#888;' : ''}">`
            + `<td data-id="${r.cityId}" title="${escapeHtml(t('ovJumpHint'))}" style="${td}color:#4fc3f7;cursor:pointer;">${escapeHtml(r.city)}</td>`
            + `<td style="${td}">${escapeHtml(`${r.type} (${r.x}:${r.y})`)}</td>`
            + `<td style="${right}">${r.level}</td>`
            + `<td style="${right}">${fixed(r.gain, 2)}</td>`
            + `<td style="${right}">${fixed(r.factor, 5)}</td>`
            + `<td style="${right}">${compact(r.tib)}</td>`
            + `<td style="${right}">${compact(r.power)}</td>`
            + `<td style="${right}">${compact(r.tibPerGain)}</td>`
            + `<td style="${right}">${compact(r.powPerGain)}</td>`
            + `<td style="${right}">${r.eta > 0 ? escapeHtml(formatDuration(r.eta)) : ''}</td>`
            + `<td style="${right}">${action}</td>`
            + '</tr>';
    }
    return html + '</table>';
}

/** Send one upgrade; resolves true when the server answered 0 (ok). */
export function sendUpgrade(row) {
    return new Promise((resolve) => {
        try {
            ClientLib.Net.CommunicationManager.GetInstance().SendCommand('UpgradeBuilding',
                { cityid: row.cityId, posX: row.x, posY: row.y, isPaid: true },
                phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, null,
                    (ctx, result) => resolve(Number(result) === 0)), null, true);
            console.log(`[ST] UpgradePriority: ${row.city} - UpgradeBuilding ${row.type} (${row.x}:${row.y}) to ${row.level}`);
        } catch (err) {
            console.warn('[ST] UpgradePriority: UpgradeBuilding failed', err && err.message);
            resolve(false);
        }
    });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export class UpgradePriority {
    /** Short description for `/st help`. */
    get description() { return t('descUpgradePriority'); }

    constructor(config, toolbar, cli) {
        this.name = 'UpgradePriority';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.busy = false;
        this.panel = new OverviewPanel(config, {
            id: 'st-upgradeprio-panel',
            prefix: 'UpgradePriority',
            width: 860,
            title: () => t('upTitle'),
            read: () => readPriority(this.filters()),
            render: (d) => renderPriority(d),
            onRowClick: (id, view) => this._onClick(id, view),
        });
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.upgrade,
            label: () => t('toolbarUpgradePriority'),
            onClick: () => this.panel.toggle(),
        });
        this.cli.register('upgrades', (args) => this._command(args));
    }

    stop() {
        this.running = false;
        this.panel.destroy();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('upgrades');
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('upStatus', { tab: t(TAB_LABEL[this.tab()]) });
    }

    tab() {
        const v = String(this.config.get('upgradeprio.tab', DEFAULT_TAB));
        return TABS.includes(v) ? v : DEFAULT_TAB;
    }

    /** Persistent filters of the selected tab. */
    filters() {
        const tab = this.tab();
        return {
            tab,
            top: this.config.get(`upgradeprio.top.${tab}`, true) !== false,
            affordable: this.config.get(`upgradeprio.affordable.${tab}`, true) !== false,
            cityOn: (id) => this.config.get(`upgradeprio.city.${tab}.${id}`, true) !== false,
        };
    }

    _command(args) {
        const tab = String(args[0] || '').toLowerCase();
        if (TABS.includes(tab)) {
            this.config.set('upgradeprio.tab', tab);
            if (!this.panel.isOpen()) this.panel.open();
            else this.panel.refresh();
            return;
        }
        this.panel.toggle();
    }

    _onClick(id, view) {
        const f = this.filters();
        switch (view) {
        case 'tab': if (TABS[id]) this.config.set('upgradeprio.tab', TABS[id]); break;
        case 'top': this.config.set(`upgradeprio.top.${f.tab}`, !f.top); break;
        case 'affordable': this.config.set(`upgradeprio.affordable.${f.tab}`, !f.affordable); break;
        case 'city': this.config.set(`upgradeprio.city.${f.tab}.${id}`, !f.cityOn(id)); break;
        case 'upgrade': {
            const row = (this.panel.data && this.panel.data.rows || []).find(r => r.id === id);
            if (row) this.upgrade([row]);
            return;
        }
        case 'upgradeall': this.upgrade((this.panel.data && this.panel.data.rows || []).filter(r => r.state === STATE.AFFORDABLE)); return;
        default: openBase(id); return;
        }
        this.panel.refresh();
    }

    /** Upgrade rows one after another; chat reports how many went through. */
    async upgrade(rows) {
        if (this.busy || !rows.length) return 0;
        this.busy = true;
        let ok = 0;
        try {
            for (let i = 0; i < rows.length; i++) {
                if (!this.running) break;
                if (await sendUpgrade(rows[i])) ok++;
                if (i < rows.length - 1) await wait(UPGRADE_GAP_MS);
            }
        } finally {
            this.busy = false;
        }
        chatMessage(`[ST] ${escapeHtml(t('upUpgraded', { ok, n: rows.length }))}`);
        await wait(AFTER_UPGRADE_MS);
        this.panel.refresh();
        return ok;
    }
}
