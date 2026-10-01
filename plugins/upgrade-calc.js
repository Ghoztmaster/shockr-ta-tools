/**
 * upgrade-calc.js — upgrade cost + saving time per building of the current own city.
 *
 * Off by default — `/st plugin enable upgradecalc`. While enabled, a floating
 * "UC" button sits on the right side of the screen whenever you view one of
 * your own bases (hidden on the world map and on enemy/Forgotten bases).
 * Clicking it toggles a panel with every building that is not max level, the
 * cost of its next level and how long it takes to save up for it at the
 * current production rate (fastest first).
 *
 * The button floats instead of being injected into the game's own base-view
 * button bar: that bar is a qooxdoo widget without a stable, readable handle.
 *
 * Pure client-side — no fetch, no document-wide listeners. A 1 s timer reads
 * two getters (view mode + viewed city) to show/hide the button; switching
 * base closes the panel. While the panel is open it refreshes every 30 s.
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
const PANEL_ID = 'st-upgradecalc-panel';
const BUTTON_ID = 'st-upgradecalc-button';

const RES_TIB = 1;
const RES_POWER = 5;

/** How often the button checks whether an own base is in view. */
const VIEW_CHECK_INTERVAL_MS = 1000;
/** How often the open panel refreshes stock/production/time. */
const REFRESH_INTERVAL_MS = 30000;

export class UpgradeCalc {
    constructor(config) {
        this.name = 'UpgradeCalc';
        this.defaultEnabled = false;
        this.config = config;
        this.running = false;
        this._panel = null;
        this._content = null;
        this._button = null;
        this._viewTimer = null;
        this._refreshTimer = null;
        this._viewKey = null;
    }

    async start() {
        this.running = true;
        this._ensureButton();
        this._checkView();
        this._viewTimer = setInterval(() => this._checkView(), VIEW_CHECK_INTERVAL_MS);
    }

    stop() {
        this.running = false;
        this._hide();
        if (this._viewTimer) {
            clearInterval(this._viewTimer);
            this._viewTimer = null;
        }
        for (const el of [this._panel, this._button]) {
            if (el) el.remove();
        }
        this._panel = null;
        this._content = null;
        this._button = null;
        this._viewKey = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return '/st plugin enable upgradecalc';
        return this._isOpen() ? 'knop in base-view, paneel open' : 'knop in base-view';
    }

    /** Button click: close the panel if open, otherwise show it for the current own city. */
    toggle() {
        if (this._isOpen()) {
            this._hide();
            return;
        }

        const city = getViewedOwnCity();
        if (!city) return;

        this._ensurePanel();
        this._render(city);
        this._panel.style.display = 'block';
        this._refreshTimer = setInterval(() => {
            const current = getViewedOwnCity();
            if (current) this._render(current);
        }, REFRESH_INTERVAL_MS);
    }

    /** Show the button only on own bases; close the panel when the view/base changes. */
    _checkView() {
        const city = getViewedOwnCity();
        const key = city ? String(city.get_Id()) : null;
        if (key !== this._viewKey) {
            this._viewKey = key;
            this._hide();
        }
        if (this._button) this._button.style.display = city ? 'block' : 'none';
    }

    _render(city) {
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
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._panel) this._panel.style.display = 'none';
    }

    _ensureButton() {
        if (this._button && document.body.contains(this._button)) return this._button;

        const top = this.config.get('UpgradeCalc.buttonTop', 220);
        const btn = document.createElement('div');
        btn.id = BUTTON_ID;
        btn.textContent = 'UC';
        btn.title = 'Upgrade Calculator';
        btn.style.cssText = `
            display: none;
            position: fixed;
            right: 4px;
            top: ${typeof top === 'number' ? top + 'px' : top};
            z-index: 9999;
            width: 32px;
            height: 32px;
            line-height: 32px;
            text-align: center;
            background: rgba(20, 20, 20, 0.88);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            pointer-events: auto;
        `;
        btn.addEventListener('click', () => this.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.color = '#fff'; btn.style.borderColor = '#888'; });
        btn.addEventListener('mouseleave', () => { btn.style.color = '#ddd'; btn.style.borderColor = '#444'; });

        document.body.appendChild(btn);
        this._button = btn;
        return btn;
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

/**
 * The own city currently shown in the base view, or null on the world map /
 * on an enemy or Forgotten base. In base view the viewed city
 * (get_CurrentCity) equals the selected own city (get_CurrentOwnCity).
 */
function getViewedOwnCity() {
    try {
        const vis = ClientLib.Vis.VisMain.GetInstance();
        if (vis.get_Mode() !== ClientLib.Vis.Mode.City) return null;
        const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
        const own = cities.get_CurrentOwnCity();
        const viewed = cities.get_CurrentCity();
        if (!own || !viewed || own.get_Id() !== viewed.get_Id()) return null;
        return own;
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
