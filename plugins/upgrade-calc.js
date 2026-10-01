/**
 * upgrade-calc.js — upgrade cost + saving time per building of the current own city.
 *
 * Toggled with `/st upgradecalc`: shows every building that is not max level
 * with the cost of its next level and how long it takes to save up for it at
 * the current production rate (fastest first). Closed by default.
 *
 * Pure client-side — no fetch, no document-wide listeners. While the panel is
 * open a light interval watches for a city switch and refreshes the numbers.
 *
 * Data paths (verified in the F12 console):
 *   city  = MainData.get_Cities().get_CurrentOwnCity()
 *   bd    = city.get_CityBuildingsData()
 *   list  = bd.GetAllBuildingsByTechName(ClientLib.Base.ETechName.<X>)  — collection (.l / .d)
 *           (no "all buildings" getter, so we loop over every ETechName value)
 *   b.get_CurrentLevel(), b.HasReachedMaxLevel(), b.get_TechGameData_Obj()
 *   cost  = ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(level + 1, tgd)
 *           → [{ Type: 1, Count }, { Type: 5, Count }]  — buildings cost Tib + Power only
 *   stock = city.GetResourceCount(type)
 *   rate  = city.GetResourceGrowPerHour(type, true, true)   — incl. package + POI
 */
import { chatMessage } from '../lib/main.js';

const PANEL_ID = 'st-upgradecalc-panel';

const RES_TIB = 1;
const RES_POWER = 5;

/** How often the open panel checks for a city switch / refreshes the numbers. */
const WATCH_INTERVAL_MS = 2000;
const REFRESH_INTERVAL_MS = 30000;

export class UpgradeCalc {
    constructor(config, cli) {
        this.name = 'UpgradeCalc';
        this.config = config;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._content = null;
        this._timer = null;
        this._cityId = null;
        this._lastRender = 0;
    }

    async start() {
        this.running = true;
        this.cli.register('upgradecalc', () => this.toggle());
    }

    stop() {
        this.running = false;
        this._hide();
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
            this._content = null;
        }
    }

    /** One-line status for `/st status`. */
    statusText() {
        return this._isOpen() ? 'paneel open' : 'paneel dicht (/st upgradecalc)';
    }

    /** `/st upgradecalc`: close the panel if open, otherwise show it for the current own city. */
    toggle() {
        if (this._isOpen()) {
            this._hide();
            return;
        }

        const city = getCurrentOwnCity();
        if (!city) {
            chatMessage('[ST] Upgrade Calculator: geen eigen stad geselecteerd');
            return;
        }

        this._ensurePanel();
        this._render(city);
        this._panel.style.display = 'block';
        this._timer = setInterval(() => this._tick(), WATCH_INTERVAL_MS);
    }

    /** Re-render on a city switch, and periodically so stock/time stay current. */
    _tick() {
        if (!this._isOpen()) return;
        const city = getCurrentOwnCity();
        if (!city) return;
        const switched = city.get_Id() !== this._cityId;
        if (switched || Date.now() - this._lastRender >= REFRESH_INTERVAL_MS) {
            this._render(city);
        }
    }

    _render(city) {
        this._cityId = city.get_Id();
        this._lastRender = Date.now();
        try {
            this._content.innerHTML = renderPanel(city, getUpgradeRows(city));
        } catch (err) {
            console.error('[ST] UpgradeCalc: render failed', err);
            this._content.innerHTML = `<div style="color:#e57373;">Upgrade Calculator: fout — ${escapeHtml(err.message)}</div>`;
        }
    }

    _isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    _hide() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._panel) this._panel.style.display = 'none';
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return this._panel;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            display: none;
            position: fixed;
            left: 0px;
            bottom: 40px;
            z-index: 9999;
            width: 440px;
            max-height: 60vh;
            overflow-y: auto;
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.88);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 8px 10px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;

        const close = document.createElement('div');
        close.textContent = '✕';
        close.title = 'Close';
        close.style.cssText = 'position:absolute;top:4px;right:8px;cursor:pointer;color:#999;font-size:13px;line-height:1;';
        close.addEventListener('click', () => this._hide());
        close.addEventListener('mouseenter', () => { close.style.color = '#fff'; });
        close.addEventListener('mouseleave', () => { close.style.color = '#999'; });

        const content = document.createElement('div');
        content.style.paddingRight = '14px';  // keep header clear of ✕

        panel.appendChild(close);
        panel.appendChild(content);
        document.body.appendChild(panel);
        this._panel = panel;
        this._content = content;
        return panel;
    }
}

function getCurrentOwnCity() {
    try {
        return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity() || null;
    } catch {
        return null;
    }
}

/**
 * All buildings of a city that can still be upgraded, with next-level cost
 * and saving time, sorted fastest first.
 */
export function getUpgradeRows(city) {
    const stock = { tib: city.GetResourceCount(RES_TIB), power: city.GetResourceCount(RES_POWER) };
    const rate = {
        tib: city.GetResourceGrowPerHour(RES_TIB, true, true),
        power: city.GetResourceGrowPerHour(RES_POWER, true, true),
    };

    const rows = [];
    for (const { name, buildings } of getBuildingsByType(city)) {
        buildings.forEach((b, i) => {
            if (b.HasReachedMaxLevel()) return;
            const level = b.get_CurrentLevel();
            const cost = getUpgradeCost(b, level + 1);
            if (!cost) return;

            const hours = Math.max(
                hoursNeeded(cost.tib, stock.tib, rate.tib),
                hoursNeeded(cost.power, stock.power, rate.power),
            );
            rows.push({
                name: buildings.length > 1 ? `${name} ${i + 1}` : name,
                level,
                tib: cost.tib,
                power: cost.power,
                hours,
            });
        });
    }

    rows.sort((a, b) => (a.hours - b.hours) || ((a.tib + a.power) - (b.tib + b.power)));
    return { rows, stock, rate };
}

/**
 * Buildings grouped per tech type. There is no "all buildings" getter, so
 * every ETechName value is tried; non-building tech names return nothing.
 * Numbering (Power Plant 1, 2, ...) follows the collection order.
 */
function getBuildingsByType(city) {
    const bd = city.get_CityBuildingsData();
    const techNames = ClientLib.Base.ETechName;
    const seen = new Set();
    const groups = [];

    const values = [...new Set(Object.values(techNames).filter(v => typeof v === 'number'))];
    for (const tech of values) {
        let buildings = [];
        try { buildings = toArray(bd.GetAllBuildingsByTechName(tech)); } catch { /* not a building */ }
        if (!buildings.length) {
            try {
                const unique = bd.GetUniqueBuildingByTechName(tech);
                if (unique) buildings = [unique];
            } catch { /* not a unique building */ }
        }
        buildings = buildings.filter(b => b && !seen.has(b));
        if (!buildings.length) continue;
        buildings.forEach(b => seen.add(b));
        groups.push({ name: buildingName(buildings[0], tech), buildings });
    }
    return groups;
}

/** Tib + Power cost of upgrading a building to `level`, or null if unknown. */
function getUpgradeCost(building, level) {
    const tgd = building.get_TechGameData_Obj();
    if (!tgd) return null;
    const reqs = ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(level, tgd);
    if (!reqs || !reqs.length) return null;

    let tib = 0, power = 0;
    for (const r of reqs) {
        if (r.Type === RES_TIB) tib += r.Count;
        else if (r.Type === RES_POWER) power += r.Count;
    }
    return { tib, power };
}

/** Hours until `stock` reaches `cost` at `perHour`; 0 if already enough. */
function hoursNeeded(cost, stock, perHour) {
    const missing = cost - stock;
    if (missing <= 0) return 0;
    if (!(perHour > 0)) return Infinity;
    return missing / perHour;
}

/** Readable building name: GAMEDATA display name, else the ETechName key. */
function buildingName(building, tech) {
    try {
        const tgd = building.get_TechGameData_Obj();
        if (tgd && typeof tgd.dn === 'string' && tgd.dn) return tgd.dn;
        if (tgd && typeof tgd.n === 'string' && tgd.n && !/^\d+$/.test(tgd.n)) return tgd.n;
    } catch { /* fall through */ }
    const key = Object.keys(ClientLib.Base.ETechName).find(k => ClientLib.Base.ETechName[k] === tech);
    return key ? key.replace(/_/g, ' ') : `Tech ${tech}`;
}

/** Qooxdoo/ClientLib collection (.l array or .d map) or plain array → array. */
function toArray(coll) {
    if (!coll) return [];
    if (Array.isArray(coll)) return coll;
    if (Array.isArray(coll.l)) return coll.l;
    if (coll.d) return Object.values(coll.d);
    return [];
}

/** Build panel HTML: header with stock/production, per-building table. */
function renderPanel(city, { rows, stock, rate }) {
    const td = 'padding:1px 4px;';
    const num = td + 'text-align:right;white-space:nowrap;';
    const tibColor = 'color:#8bc34a;';
    const powColor = 'color:#ffca28;';

    let html = `<div style="font-weight:bold;margin-bottom:4px;color:#fff;">🔧 Upgrades — ${escapeHtml(city.get_Name())}</div>`;
    html += `<div style="margin-bottom:6px;color:#aaa;">`
        + `<span style="${tibColor}">Tib</span> ${fmt(stock.tib)} (+${fmt(rate.tib)}/u) · `
        + `<span style="${powColor}">Power</span> ${fmt(stock.power)} (+${fmt(rate.power)}/u)</div>`;

    if (!rows.length) {
        return html + '<div style="color:#999;">Alle gebouwen op max-level</div>';
    }

    html += '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr style="color:#999;"><th style="${td}text-align:left;">Gebouw</th><th style="${num}">Level</th>`
        + `<th style="${num}${tibColor}">Tib</th><th style="${num}${powColor}">Power</th><th style="${num}">Tijd</th></tr>`;
    for (const r of rows) {
        const ready = r.hours === 0;
        html += `<tr><td style="${td}">${escapeHtml(r.name)}</td><td style="${num}">${r.level}→${r.level + 1}</td>`
            + `<td style="${num}">${fmt(r.tib)}</td><td style="${num}">${fmt(r.power)}</td>`
            + `<td style="${num}${ready ? 'color:#8bc34a;font-weight:bold;' : ''}">${fmtHours(r.hours)}</td></tr>`;
    }
    html += '</table>';
    return html;
}

function fmtHours(h) {
    if (h === 0) return 'Gereed';
    if (!isFinite(h)) return '∞';
    const totalMin = Math.ceil(h * 60);
    return `${Math.floor(totalMin / 60)}u ${String(totalMin % 60).padStart(2, '0')}m`;
}

function fmt(n) {
    return Math.round(n).toLocaleString('de-DE');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
