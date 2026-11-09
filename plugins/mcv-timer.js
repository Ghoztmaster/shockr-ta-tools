// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * mcv-timer.js — progress to the next MCV (new base) in a small movable panel.
 *
 * Off by default — `/st plugin enable mcv-timer`; `/st mcv` shows / hides the
 * panel. Same content as MaelstromTools' "Next MCV" window (NetquiK mod; own
 * implementation, facts = game API):
 *   Credits: current / needed, %, estimated time ("1d.04:30"), or OK
 *   RP:      current / needed, %, or OK
 * Green = enough, red = not yet. The ▾/▸ button switches between the extended
 * and the compact view (one or two short lines); the choice is kept in
 * `mcvtimer.compact`, the position (drag the header) in McvTimer.x / .y —
 * both in the Shockr config, which lives in localStorage.
 * Refreshes every 10 s, as MaelstromTools.
 *
 * Game API:
 *   player = MainData.get_Player()
 *   techId = ClientLib.Base.Tech.GetTechIdFromTechNameAndFaction(ETechName.Research_BaseFound, player.get_Faction())
 *   item   = player.get_PlayerResearch().GetResearchItemFomMdbId(techId)   (sic: "Fom")
 *   next   = item.get_NextLevelInfo_Obj()   — null when every MCV is researched
 *   needed = next.rr[i].c per resource type next.rr[i].t (Gold = credits, ResearchPoints = RP)
 *   have   = player.GetCreditsCount(), player.get_ResearchPoints()
 *   growth = (player.get_Credits().Delta + .ExtraBonusDelta) × MainData.get_Time().get_StepsPerHour()   (credits / hour)
 * NOT VERIFIED LIVE on the current client (taken from MaelstromTools 0.1.5.5 Mod MCV).
 */
import { t, escapeHtml } from '../lib/i18n.js';
import { makeDraggable, loadPosition, clampPosition } from '../lib/drag.js';
import { compact as compactNumber } from '../lib/overview-panel.js';

const PANEL_ID = 'st-mcv-panel';
const REFRESH_MS = 10 * 1000;
const PANEL_WIDTH = 230;
const GREEN = '#92ff7f';
const RED = '#ff8a7f';

/** The game's compact number format (as MaelstromTools), else our own. */
export function fmt(n) {
    try {
        const f = webfrontend.phe.cnc.gui.util.Numbers.formatNumbersCompact;
        if (typeof f === 'function') return f(n);
    } catch { /* fallback */ }
    return compactNumber(n);
}

/** Hours → "1d.04:30" (MaelstromTools' format). */
export function daysFromHours(hours) {
    const d = Math.floor(hours / 24);
    const rest = hours - d * 24;
    const h = Math.floor(rest);
    const m = Math.floor((rest - h) * 60);
    return `${d}d.${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Pure: the numbers the panel shows.
 * @returns {{credits: {have, need, pct, ok, hoursLeft: ?number}, rp: {have, need, pct, ok}}}
 */
export function progress({ credits, creditsNeeded, rp, rpNeeded, creditsPerHour }) {
    const part = (have, need) => {
        const pct = need > 0 ? (have / need) * 100 : 100;
        return { have, need, pct, ok: pct >= 100 };
    };
    const c = part(credits, creditsNeeded);
    c.hoursLeft = !c.ok && creditsPerHour > 0 ? (creditsNeeded - credits) / creditsPerHour : null;
    return { credits: c, rp: part(rp, rpNeeded) };
}

/** Read the next MCV from the client: progress(...) input, null = no next MCV, undefined = no data yet. */
export function readMcv() {
    const md = ClientLib.Data.MainData.GetInstance();
    const player = md.get_Player();
    const techId = ClientLib.Base.Tech.GetTechIdFromTechNameAndFaction(ClientLib.Base.ETechName.Research_BaseFound, player.get_Faction());
    const item = player.get_PlayerResearch().GetResearchItemFomMdbId(techId);
    if (!item) return undefined;
    const next = item.get_NextLevelInfo_Obj();
    if (!next) return null;
    const needed = {};
    for (const r of Object.values(next.rr || {})) if (r && r.t > 0) needed[r.t] = r.c;
    const R = ClientLib.Base.EResourceType;
    const cr = player.get_Credits();
    return {
        credits: Number(player.GetCreditsCount()) || 0,
        creditsNeeded: Number(needed[R.Gold]) || 0,
        rp: Number(player.get_ResearchPoints()) || 0,
        rpNeeded: Number(needed[R.ResearchPoints]) || 0,
        creditsPerHour: ((Number(cr.Delta) || 0) + (Number(cr.ExtraBonusDelta) || 0)) * md.get_Time().get_StepsPerHour(),
    };
}

const span = (color, text) => `<span style="color:${color};">${escapeHtml(text)}</span>`;

/** Extended view: three lines (timer, credits, RP). */
export function renderExtended(p) {
    const c = p.credits;
    const r = p.rp;
    const timer = c.ok
        ? span(GREEN, t('mcvTimerReady'))
        : c.hoursLeft !== null ? escapeHtml(daysFromHours(c.hoursLeft)) : span(RED, t('mcvNoGrowth'));
    const line = (label, x) => `<div>${span(x.ok ? GREEN : RED, label)} `
        + `<span style="color:#ff8f00;">${escapeHtml(fmt(x.have))}</span> / ${escapeHtml(fmt(x.need))}`
        + ` <span style="color:#aaa;">${x.ok ? escapeHtml(t('mcvOk')) : `${Math.floor(x.pct * 10) / 10}%`}</span></div>`;
    return `<div>${escapeHtml(t('mcvTimeLabel'))} ${timer}</div>`
        + line(t('mcvCredits'), c)
        + line(t('mcvRp'), r);
}

/** Compact view: "C$ +1.2M" / "T$ 1d.04:30" and "RP +300k" / "RP @ 45.3%". */
export function renderCompact(p) {
    const c = p.credits;
    const r = p.rp;
    const cLine = c.ok
        ? span(GREEN, `C$ (+${fmt(c.have - c.need)})`)
        : span(RED, `T$ ${c.hoursLeft !== null ? daysFromHours(c.hoursLeft) : t('mcvNoGrowth')}`);
    const rLine = r.ok ? span(GREEN, `RP (+${fmt(r.have - r.need)})`) : span(RED, `RP (@${Math.floor(r.pct * 10) / 10}%)`);
    return `<div>${cLine}</div><div>${rLine}</div>`;
}

export class McvTimer {
    /** Short description for `/st help`. */
    get description() { return t('descMcvTimer'); }

    constructor(config, cli) {
        this.name = 'McvTimer';
        this.defaultEnabled = false;
        this.config = config;
        this.cli = cli;
        this.running = false;
        this._panel = null;
        this._body = null;
        this._toggle = null;
        this._title = null;
        this._timer = null;
        this._hidden = false;
        this._last = undefined;     // last readMcv() result
    }

    async start() {
        this.running = true;
        this._hidden = false;
        this._ensurePanel();
        this.refresh();
        this._timer = setInterval(() => this.refresh(), REFRESH_MS);
        this.cli.register('mcv', () => this.toggleVisible());
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this.cli.unregister('mcv');
        if (this._panel) this._panel.remove();
        this._panel = null;
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (this._last === null) return t('mcvStatusDone');
        if (!this._last) return t('mcvStatusNoData');
        const p = progress(this._last);
        return t('mcvStatus', { credits: Math.floor(p.credits.pct), rp: Math.floor(p.rp.pct) });
    }

    isCompact() {
        const v = this.config.get('mcvtimer.compact', false);
        return v === true || v === 'true';
    }

    toggleVisible() {
        this._hidden = !this._hidden;
        if (this._panel) this._panel.style.display = this._hidden ? 'none' : 'block';
    }

    toggleCompact() {
        this.config.set('mcvtimer.compact', !this.isCompact());
        this.refresh();
    }

    refresh() {
        if (!this.running || !this._panel) return;
        try {
            this._last = readMcv();
        } catch (err) {
            this._last = undefined;
            console.warn('[ST] McvTimer: read failed', err && err.message);
        }
        const compact = this.isCompact();
        this._title.textContent = t('mcvTitle');   // language switch
        this._toggle.textContent = compact ? '▸' : '▾';
        this._toggle.title = t(compact ? 'mcvExpand' : 'mcvCollapse');
        if (this._last === null) {
            this._body.innerHTML = `<div style="color:#aaa;">${escapeHtml(t('mcvAllDone'))}</div>`;
        } else if (!this._last) {
            this._body.innerHTML = `<div style="color:#aaa;">${escapeHtml(t('mcvNoData'))}</div>`;
        } else {
            const p = progress(this._last);
            this._body.innerHTML = compact ? renderCompact(p) : renderExtended(p);
        }
    }

    _ensurePanel() {
        if (this._panel && document.body.contains(this._panel)) return;
        const fallback = { x: Math.max(0, window.innerWidth - PANEL_WIDTH - 20), y: Math.max(0, window.innerHeight - 160) };
        const pos = clampPosition(loadPosition(this.config, 'McvTimer', fallback),
            { w: PANEL_WIDTH, h: 40 }, { w: window.innerWidth, h: window.innerHeight });
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed; left: ${pos.x}px; top: ${pos.y}px; z-index: 9998;
            min-width: 140px; max-width: ${PANEL_WIDTH}px; box-sizing: border-box;
            background: rgba(20, 20, 20, 0.88); color: #ddd;
            border: 1px solid #444; border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; line-height: 1.5;
            pointer-events: auto;`;
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:move;user-select:none;border-bottom:1px solid #333;';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1;color:#fff;font-weight:bold;';
        title.textContent = t('mcvTitle');
        const toggle = document.createElement('div');
        toggle.style.cssText = 'cursor:pointer;color:#999;font-size:13px;line-height:1;';
        toggle.addEventListener('mousedown', (e) => e.stopPropagation());   // not a drag
        toggle.addEventListener('click', () => this.toggleCompact());
        header.append(title, toggle);
        const body = document.createElement('div');
        body.style.cssText = 'padding:4px 8px 6px;white-space:nowrap;';
        panel.append(header, body);
        document.body.appendChild(panel);
        makeDraggable(panel, header, { config: this.config, prefix: 'McvTimer' });
        this._panel = panel;
        this._body = body;
        this._toggle = toggle;
        this._title = title;
    }
}
