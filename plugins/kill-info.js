/**
 * kill-info.js — plunder panel for the selected Forgotten base.
 *
 * Toggled with `/st plunder`: shows tiberium + crystal loot per defense
 * unit of the selected Forgotten base in a fixed panel (bottom right).
 * The panel stays until closed via ✕ or another `/st plunder`.
 *
 * Pure GAMEDATA calculation — no polling, no listeners on the game,
 * no obfuscated client functions.
 *
 * Plunder per unit:
 *   gd     = GAMEDATA.units[unit.get_MdbUnitId()]
 *   useLvl = highest non-null key in gd.r <= unit level (else max key)
 *   costs  = gd.r[useLvl].rer (Forgotten) || gd.r[useLvl].rr (GDI/Nod)
 *   t:2 = Tiberium, t:6 = Crystal
 */
import { chatMessage } from '../lib/main.js';

const PANEL_ID = 'mehrstrom-killinfo-panel';

const RES_TIB = 2;
const RES_CRY = 6;

/** Player factions; everything else is a Forgotten variant. */
const PLAYER_FACTIONS = [1, 2];

/** Plunder cache keyed by `${unitId}:${level}:${forgotten}`. */
const plunderCache = new Map();

export class KillInfo {
    constructor(config, cli) {
        this.name = 'KillInfo';
        this.config = config;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._content = null;
    }

    async start() {
        this.running = true;
        this.cli.register('plunder', () => this.toggle());
    }

    stop() {
        this.running = false;
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
            this._content = null;
        }
    }

    /** `/st plunder`: close the panel if open, otherwise show it for the selected FG base. */
    toggle() {
        if (this._isOpen()) {
            this._hide();
            return;
        }

        const city = getSelectedForgottenCity();
        const units = city ? getDefenseUnits(city) : [];
        if (!city || !units.length) {
            chatMessage('[ST] Select a Forgotten base first');
            return;
        }

        this._ensurePanel();
        this._content.innerHTML = renderPanel(city, units);
        this._panel.style.display = 'block';

        const { tib, cry } = getTotals(city, units);
        chatMessage(`[ST] Plunder: ${city.get_Name()} Lvl ${Math.floor(city.get_LvlBase())} — Tib ${fmt(tib)}, Crystal ${fmt(cry)}`);
    }

    _isOpen() {
        return !!this._panel && this._panel.style.display !== 'none';
    }

    _hide() {
        if (this._panel) this._panel.style.display = 'none';
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return this._panel;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            display: none;
            position: fixed;
            right: 0px;
            bottom: 40px;
            z-index: 9999;
            width: 360px;
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
 * Compute plunder for one unit from GAMEDATA. Cached per (unitId, level).
 * @returns {{ tib: number, cry: number }|null}
 */
export function getPlunder(unitId, level, forgotten = true) {
    const cacheKey = `${unitId}:${level}:${forgotten ? 1 : 0}`;
    if (plunderCache.has(cacheKey)) return plunderCache.get(cacheKey);

    let result = null;
    const gd = typeof GAMEDATA !== 'undefined' && GAMEDATA.units && GAMEDATA.units[unitId];
    if (gd && gd.r) {
        const keys = Object.keys(gd.r)
            .filter(k => gd.r[k] != null)
            .map(Number)
            .sort((a, b) => a - b);

        if (keys.length) {
            const eligible = keys.filter(k => k <= level);
            const useLvl = eligible.length ? eligible[eligible.length - 1] : keys[keys.length - 1];
            const entry = gd.r[useLvl];
            const costs = forgotten ? (entry.rer || entry.rr) : (entry.rr || entry.rer);

            let tib = 0, cry = 0;
            for (const c of costs || []) {
                if (c.t === RES_TIB) tib += c.c;
                else if (c.t === RES_CRY) cry += c.c;
            }
            result = { tib, cry };
        }
    }

    plunderCache.set(cacheKey, result);
    return result;
}

/** Resolve the currently selected world object to a loaded Forgotten city. */
function getSelectedForgottenCity() {
    const md = ClientLib.Data.MainData.GetInstance();
    const cities = md.get_Cities();

    let city = null;
    try {
        const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
        if (sel && typeof sel.get_Id === 'function') city = cities.GetCity(sel.get_Id());
    } catch { /* no selection */ }

    if (!city) {
        try { city = cities.get_CurrentCity(); } catch { /* ignore */ }
    }

    if (!city || city.get_IsGhostMode()) return null;
    if (PLAYER_FACTIONS.includes(city.get_CityFaction())) return null;
    return city;
}

/** Defense units of a city as an array of ClientLib unit objects. */
function getDefenseUnits(city) {
    const data = city.get_CityUnitsData();
    if (!data) return [];
    const def = data.$DefenseUnits;
    return def && def.d ? Object.values(def.d) : [];
}

/** Build panel HTML: header, per-unit table (grouped by type+level), totals. */
function renderPanel(city, units) {
    const forgotten = !PLAYER_FACTIONS.includes(city.get_CityFaction());
    const rows = new Map();
    let totalTib = 0, totalCry = 0;

    for (const unit of units) {
        const id = unit.get_MdbUnitId();
        const level = unit.get_CurrentLevel();
        const plunder = getPlunder(id, level, forgotten);
        if (!plunder) continue;

        const key = `${id}:${level}`;
        let row = rows.get(key);
        if (!row) {
            const gd = GAMEDATA.units[id];
            row = { name: gd ? gd.dn : `Unit ${id}`, level, count: 0, tib: 0, cry: 0 };
            rows.set(key, row);
        }
        row.count++;
        row.tib += plunder.tib;
        row.cry += plunder.cry;
        totalTib += plunder.tib;
        totalCry += plunder.cry;
    }

    const sorted = [...rows.values()].sort((a, b) => (b.tib + b.cry) - (a.tib + a.cry));
    const td = 'padding:1px 4px;';
    const num = td + 'text-align:right;';

    let html = `<div style="font-weight:bold;margin-bottom:6px;color:#fff;">⚔ Plunder — ${escapeHtml(city.get_Name())}</div>`;
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr style="color:#999;"><th style="${td}text-align:left;">Unit</th><th style="${num}">Lv</th>`
        + `<th style="${num}">#</th><th style="${num}color:#8bc34a;">Tib</th><th style="${num}color:#42a5f5;">Crystal</th></tr>`;
    for (const r of sorted) {
        html += `<tr><td style="${td}">${escapeHtml(r.name)}</td><td style="${num}">${r.level}</td>`
            + `<td style="${num}">${r.count}</td><td style="${num}">${fmt(r.tib)}</td><td style="${num}">${fmt(r.cry)}</td></tr>`;
    }
    html += `<tr style="border-top:1px solid #555;font-weight:bold;"><td style="${td}" colspan="3">Total</td>`
        + `<td style="${num}color:#8bc34a;">${fmt(totalTib)}</td><td style="${num}color:#42a5f5;">${fmt(totalCry)}</td></tr>`;
    html += '</table>';
    return html;
}

/** Total plunder over all defense units of a city. */
function getTotals(city, units) {
    const forgotten = !PLAYER_FACTIONS.includes(city.get_CityFaction());
    let tib = 0, cry = 0;
    for (const unit of units) {
        const plunder = getPlunder(unit.get_MdbUnitId(), unit.get_CurrentLevel(), forgotten);
        if (!plunder) continue;
        tib += plunder.tib;
        cry += plunder.cry;
    }
    return { tib, cry };
}

function fmt(n) {
    return Math.round(n).toLocaleString('de-DE');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
