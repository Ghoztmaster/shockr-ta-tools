// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * base-status.js — one panel with the status of every own base.
 *
 * On by default. Shockr toolbar (crosshair icon) or `/st basestatus`. Per own
 * base: move cooldown, protection, alerted (base name in red), support weapon
 * (name + level), where it is calibrated and a Recall button; "Recall all" on
 * top when anything is calibrated. Click a base name: base view; the focus
 * button centres the world map on the base.
 *
 * Since 5.45.0 this panel replaces the SupportCalibrate panel; the world-map
 * button "Calibrate all support" and `/st support recall` stay in SupportCalibrate.
 *
 * Game API (the same getters as MaelstromTools' BaseStatus; own implementation):
 *   cooldown:   max(city.get_MoveCooldownEndStep(), city.get_MoveRestictionEndStep())  (sic: Restiction)
 *   protection: city.get_ProtectionEndStep()
 *   alerted:    city.get_isAlerted()
 *   time:       MainData.get_Time().GetTimespanString(endStep, GetServerStep()); "00:00" = none
 *   support:    city.get_SupportData() (null = none), get_SupportDedicatedBaseId() / ...BaseName()
 *   focus:      webfrontend.gui.UtilView.centerCityOnRegionViewWindow(cityId)
 * VERIFIED LIVE (2026-11-09): every getter above on the current client.
 */
import { chatMessage } from '../lib/main.js';
import { t, escapeHtml } from '../lib/i18n.js';
import { ICONS } from '../lib/toolbar.js';
import { OverviewPanel, ownBases, openBase } from '../lib/overview-panel.js';
import { recallCity, recallAll } from './support-calibrate.js';

const TOOLBAR_ID = 'basestatus';
const VIEW_RECALL = 'recall';
const VIEW_RECALL_ALL = 'recallall';
const VIEW_FOCUS = 'focus';

function call(city, fn, fallback) {
    try { return typeof city[fn] === 'function' ? city[fn]() : fallback; } catch { return fallback; }
}

/** Time left until a server step, '' when passed (MaelstromTools shows nothing for "00:00"). */
export function stepTime(endStep) {
    try {
        const time = ClientLib.Data.MainData.GetInstance().get_Time();
        const s = time.GetTimespanString(Number(endStep) || 0, time.GetServerStep());
        return s === '00:00' ? '' : s;
    } catch {
        return '';
    }
}

/** "Ion Cannon Support (24)", or null without a support weapon. */
function weaponLabel(city) {
    try {
        const sd = city.get_SupportData();
        if (!sd) return null;
        const faction = ClientLib.Data.MainData.GetInstance().get_Player().get_Faction();
        const Tech = ClientLib.Base.Tech;
        const name = Tech.GetProductionBuildingNameFromFaction(Tech.GetTechNameFromTechId(sd.get_Type(), faction), faction);
        return `${name || '?'} (${sd.get_Level()})`;
    } catch {
        return null;
    }
}

/** Panel rows, one per own base. */
export function readStatus() {
    const rows = [];
    for (const city of ownBases()) {
        try {
            const cooldownEnd = Math.max(Number(call(city, 'get_MoveCooldownEndStep', 0)) || 0,
                Number(call(city, 'get_MoveRestictionEndStep', 0)) || 0);
            const weapon = weaponLabel(city);
            const dedicated = Number(call(city, 'get_SupportDedicatedBaseId', 0)) || 0;
            let on = null;
            if (weapon && dedicated) on = call(city, 'get_SupportDedicatedBaseName', '') || String(dedicated);
            rows.push({
                id: city.get_Id(),
                name: city.get_Name(),
                alerted: !!call(city, 'get_isAlerted', false),
                cooldown: stepTime(cooldownEnd),
                protection: stepTime(call(city, 'get_ProtectionEndStep', 0)),
                weapon,
                on,
            });
        } catch { /* skip */ }
    }
    return rows;
}

const BTN = 'cursor:pointer;padding:1px 8px;border:1px solid #5f8fb4;border-radius:3px;background:#0d2a40;color:#4fc3f7;white-space:nowrap;';
const FOCUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px;"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

export function renderStatus(rows) {
    if (!rows.length) return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t('baseStatusNoData'))}</div>`;
    const th = 'padding:3px 5px;text-align:left;font-weight:normal;color:#999;';
    const td = 'padding:3px 5px;white-space:nowrap;';
    let html = '';
    if (rows.some(r => r.on)) {
        html += `<div style="margin:4px 0 6px;"><span data-id="0" data-view="${VIEW_RECALL_ALL}" style="${BTN}">${escapeHtml(t('supportRecallAll'))}</span></div>`;
    }
    html += '<table style="border-collapse:collapse;width:100%;">'
        + `<tr style="border-bottom:1px solid #444;"><th style="${th}">${escapeHtml(t('ovColBase'))}</th>`
        + `<th style="${th}">${escapeHtml(t('baseStatusColCooldown'))}</th><th style="${th}">${escapeHtml(t('baseStatusColProtection'))}</th>`
        + `<th style="${th}">${escapeHtml(t('supportColWeapon'))}</th><th style="${th}">${escapeHtml(t('supportColOn'))}</th><th></th><th></th></tr>`;
    for (const r of rows) {
        const nameColor = r.alerted ? '#ff5252' : '#4fc3f7';
        const nameTitle = r.alerted ? `${t('baseStatusAlerted')} - ${t('ovJumpHint')}` : t('ovJumpHint');
        let onCell = '';
        if (r.weapon) onCell = r.on ? escapeHtml(r.on) : `<span style="color:#777;">${escapeHtml(t('supportNotCalibrated'))}</span>`;
        html += '<tr style="border-bottom:1px solid #2a2a2a;">'
            + `<td data-id="${r.id}" title="${escapeHtml(nameTitle)}" style="${td}color:${nameColor};cursor:pointer;">${escapeHtml(r.name)}</td>`
            + `<td style="${td}text-align:right;">${escapeHtml(r.cooldown)}</td>`
            + `<td style="${td}text-align:right;">${escapeHtml(r.protection)}</td>`
            + `<td style="${td}${r.weapon ? '' : 'color:#777;'}">${escapeHtml(r.weapon || t('baseStatusNone'))}</td>`
            + `<td style="${td}">${onCell}</td>`
            + `<td style="${td}text-align:right;">${r.on ? `<span data-id="${r.id}" data-view="${VIEW_RECALL}" style="${BTN}">${escapeHtml(t('supportRecall'))}</span>` : ''}</td>`
            + `<td style="${td}"><span data-id="${r.id}" data-view="${VIEW_FOCUS}" title="${escapeHtml(t('baseStatusFocus'))}" style="cursor:pointer;color:#4fc3f7;">${FOCUS}</span></td>`
            + '</tr>';
    }
    return html + '</table>';
}

/** Centre the world map on an own base (not ghost). */
export function focusBase(id) {
    try {
        const city = ownBases().find(c => c.get_Id() === id);
        if (!city || call(city, 'get_IsGhostMode', false)) return false;
        webfrontend.gui.UtilView.centerCityOnRegionViewWindow(id);
        return true;
    } catch (err) {
        console.error('[ST] BaseStatus: focus failed', err);
        return false;
    }
}

export class BaseStatus {
    /** Short description for `/st help`. */
    get description() { return t('descBaseStatus'); }

    constructor(config, toolbar, cli) {
        this.name = 'BaseStatus';
        this.config = config;
        this.toolbar = toolbar;
        this.cli = cli;
        this.running = false;
        this.panel = new OverviewPanel(config, {
            id: 'st-basestatus-panel',
            prefix: 'BaseStatus',
            width: 640,
            title: () => t('baseStatusTitle'),
            read: () => readStatus(),
            render: (rows) => renderStatus(rows),
            onRowClick: (id, view) => this._onPanelClick(id, view),
        });
    }

    async start() {
        this.running = true;
        this.toolbar.register({
            id: TOOLBAR_ID,
            icon: ICONS.crosshair,
            label: () => t('toolbarBaseStatus'),
            onClick: () => this.panel.toggle(),
        });
        this.cli.register('basestatus', () => this.panel.toggle());
    }

    stop() {
        this.running = false;
        this.panel.destroy();
        this.toolbar.unregister(TOOLBAR_ID);
        this.cli.unregister('basestatus');
    }

    /** One-line status for `/st status`. */
    statusText() {
        try {
            const rows = readStatus();
            return t('baseStatusStatus', {
                n: rows.length,
                cooldown: rows.filter(r => r.cooldown).length,
                alerted: rows.filter(r => r.alerted).length,
            });
        } catch {
            return t('baseStatusNoData');
        }
    }

    _report(names) {
        chatMessage(`[ST] ${escapeHtml(names.length ? t('supportRecalled', { bases: names.join(', ') }) : t('supportNothingToRecall'))}`);
        this.panel.refresh();
    }

    _onPanelClick(id, view) {
        if (view === VIEW_RECALL_ALL) {
            this._report(recallAll());
        } else if (view === VIEW_RECALL) {
            const city = ownBases().find(c => c.get_Id() === id);
            this._report(city && recallCity(city) ? [city.get_Name()] : []);
        } else if (view === VIEW_FOCUS) {
            focusBase(id);
        } else {
            openBase(id);
        }
    }
}
