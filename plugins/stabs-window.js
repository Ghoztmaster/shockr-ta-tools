// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * stabs-window.js — the STABS statistics window, in the game's own style
 * (a qooxdoo window with the game's light panel decorators, like TABS and
 * the game's own windows). Only builds and fills widgets; what goes in the
 * cells comes from columnCells() in stabs-stats.js, the actions go back to
 * plugins/stabs.js through the callbacks.
 *
 * Layout (TABS' statistics window, rebuilt):
 *
 *   STABS: Statistic                                [X]
 *   ┌────┬─────────┬─────────┐
 *   │ P  │  live   │   CY    │   preset name
 *   │ O  │  icon   │  icon   │   outcome
 *   │ D  │  00:56  │  00:56  │   battle duration
 *   │ B  │  base   │  base   │   own base
 *   │ M  │         │         │   morale, only when not 100 %
 *   Defender      Total, Def, Base, CY, DF (+ CC, B, F, A, S when present)
 *   Own repair costs   storage, slowest type (glows), crystal, inf, veh, air
 *   Loot          tiberium, crystal, credits, research, total
 *   (icon)    [⊕][▶]  [⊕][▶]  simulate this column's formation / view it
 *   N simulations in cache                          Reset
 *
 * Section headers fold their section (stabs.section.<key>). A column whose
 * result is not the current formation is dimmed. Double click on a column
 * loads its formation.
 *
 * Built to the live DOM of TABS' window (docs/tabs-dom-reference.html): the
 * same widgets and layout settings give the same classes, sizes and images.
 */
import { t } from '../lib/i18n.js';
import { ENEMY_ROWS, REPAIR_ROWS, LOOT_ROWS } from './stabs-stats.js';

/** Game resource ids (qx resolves them; the same files the game's own UI uses). */
export const IMG = {
    stats: 'FactionUI/icons/icn_build_slots.png',
    simulate: 'FactionUI/icons/icon_attack_simulate_combat.png',
    play: 'webfrontend/theme/arrows/right.png',
    back: 'FactionUI/icons/icon_return.png',
    'total-defeat': 'FactionUI/icons/icon_reports_total_defeat.png',
    victory: 'FactionUI/icons/icon_reports_victory.png',
    'total-victory': 'FactionUI/icons/icon_reports_total_victory.png',
    enemyAll: 'FactionUI/icons/icon_arsnl_show_all.png',
    enemyBase: 'FactionUI/icons/icon_arsnl_base_buildings.png',
    enemyDefense: 'FactionUI/icons/icon_def_army_points.png',
    infantry: 'FactionUI/icons/icon_arsnl_off_squad.png',
    vehicle: 'FactionUI/icons/icon_arsnl_off_vehicle.png',
    aircraft: 'FactionUI/icons/icon_arsnl_off_plane.png',
    rcBase: 'webfrontend/ui/icons/icn_repair_points.png',
    rcOffense: 'webfrontend/ui/icons/icn_repair_off_points.png',
    rcInf: 'webfrontend/ui/icons/icon_res_repair_inf.png',
    rcVeh: 'webfrontend/ui/icons/icon_res_repair_tnk.png',
    rcAir: 'webfrontend/ui/icons/icon_res_repair_air.png',
    tiberium: 'webfrontend/ui/common/icn_res_tiberium.png',
    crystal: 'webfrontend/ui/common/icn_res_chrystal.png',
    credits: 'webfrontend/ui/common/icn_res_dollar.png',
    research: 'webfrontend/ui/common/icn_res_research_mission.png',
    transfer: 'FactionUI/icons/icon_transfer_resource.png',
};

const WIDTH = 201;              // TABS' window in the reference DOM (docs/tabs-dom-reference.html)
const ROW_HEIGHT = 18;
const LABEL_COLUMN = 29;
const DIM_OPACITY = 0.7;
const SECTIONS = ['enemy', 'repair', 'loot'];

/** The game's translation of `id` (the texts TABS shows), else `fallback`. */
export function gameText(id, fallback) {
    try {
        const s = String(qx.locale.Manager.tr(id));
        return s && s !== id ? s.replace(/:\s*$/, '') : fallback;
    } catch {
        return fallback;
    }
}

/** Name of a building type for the faction-neutral GDI tech, or `fallback`. */
function techName(name, fallback) {
    try {
        const tech = ClientLib.Base.Tech;
        return tech.GetTechDisplayNameFromTechId(tech.GetTechIdFromTechNameAndFaction(name, ClientLib.Base.EFactionType.GDIFaction)) || fallback;
    } catch {
        return fallback;
    }
}

/** Row label: an icon, else a short text; the tooltip names it. */
function rowLabel(text, icon, tip) {
    const atom = new qx.ui.basic.Atom(icon ? null : text, icon || null).set({
        alignX: 'center', alignY: 'middle', gap: 0, iconPosition: 'top', minHeight: ROW_HEIGHT,
        show: icon ? 'icon' : 'label', toolTipText: tip || text,
    });
    if (icon) {
        atom.setToolTipIcon(icon);
        atom.getChildControl('icon').set({ width: 18, height: 18, scale: true, alignY: 'middle' });
    }
    return atom;
}

function valueLabel(align) {
    return new qx.ui.basic.Label('-').set({ alignX: align, alignY: 'middle', minHeight: ROW_HEIGHT });
}

/**
 * 22×22 icon button in the game's "addpoints" style (DOM: div.qx-button-addpoints).
 * qx.ui.form.Button: ModelButton does not exist in game client 26.1.1.
 */
function iconButton(icon, tip, onClick) {
    const btn = new qx.ui.form.Button(null, icon).set({
        maxHeight: 22, minWidth: 22, toolTipText: tip, show: 'icon', iconPosition: 'top', appearance: 'button-addpoints',
    });
    btn.getChildControl('icon').set({ maxWidth: 16, maxHeight: 16, scale: true });
    btn.addListener('click', onClick);
    return btn;
}

export class StatsWindow {
    /**
     * @param {object} opts
     * @param {object} opts.config
     * @param {Array<{id, name, description}>} opts.presets — the columns
     * @param {() => void} opts.onUserClose
     * @param {(columnId) => void} opts.onSimulate — load the column's formation and simulate
     * @param {(columnId) => void} opts.onReplay
     * @param {(columnId) => void} opts.onLoad — double click: load the column's formation
     * @param {() => void} opts.onReset
     */
    constructor(opts) {
        this.opts = opts;
        this.win = null;
        this.rows = {};          // section -> { key -> [label widget, ...per column cells] }
        this.columns = [];       // per preset: { boxes: [composites], cells: {section: {key: widget}}, outcome }
        this.sections = {};      // key -> section composite
    }

    isOpen() {
        return !!this.win && this.win.isVisible();
    }

    open() {
        this._ensure();
        if (!this.win.isVisible()) this.win.open();
    }

    close() {
        if (this.win && this.win.isVisible()) this.win.close();
    }

    dispose() {
        if (!this.win) return;
        try {
            this.win.close();
            this.win.destroy();
        } catch { /* already gone */ }
        this.win = null;
        this.columns = [];
        this.rows = {};
        this.sections = {};
    }

    _ensure() {
        if (this.win) return;
        const { config, presets } = this.opts;
        const win = new qx.ui.window.Window(t('stabsTitle'), IMG.stats).set({
            layout: new qx.ui.layout.VBox(),
            contentPadding: 4,
            contentPaddingTop: 0,
            contentPaddingBottom: 3,
            width: WIDTH,
            allowMaximize: false,
            showMaximize: false,
            allowMinimize: false,
            showMinimize: false,
            resizable: false,
        });
        win.getChildControl('icon').set({ width: 20, height: 20, scale: true, alignY: 'middle' });
        const x = Number(config.get('stabs.panel.x'));
        const y = Number(config.get('stabs.panel.y'));
        win.moveTo(Number.isFinite(x) ? x : 124, Number.isFinite(y) ? y : 31);
        win.addListener('move', () => {
            const b = win.getBounds();
            if (b) {
                config.set('stabs.panel.x', b.left);
                config.set('stabs.panel.y', b.top);
            }
        });
        win.getChildControl('close-button').addListener('execute', () => this.opts.onUserClose());

        this.columns = presets.map(() => ({ boxes: [], cells: {}, outcome: null }));

        // battle: no header
        win.add(this._section('battle', null, [
            ['preset', rowLabel('P', null, t('stabsPreset'))],
            ['outcome', rowLabel('O', null, gameText('tnf:combat report', t('stabsOutcome')))],
            ['duration', rowLabel('D', null, t('stabsDuration'))],
            ['base', rowLabel('B', null, gameText('tnf:base', t('stabsBase')))],
            ['morale', rowLabel('M', null, t('stabsMorale'))],
        ]));
        const T = ClientLib.Base.ETechName;
        const enemyLabels = {
            overall: rowLabel(null, IMG.enemyAll, gameText('tnf:total', t('stabsTotal'))),
            defense: rowLabel(null, IMG.enemyDefense, gameText('tnf:defense', t('stabsDefense'))),
            structure: rowLabel(null, IMG.enemyBase, gameText('tnf:base', t('stabsStructure'))),
            cy: rowLabel('CY', null, techName(T.Construction_Yard, 'CY')),
            df: rowLabel('DF', null, techName(T.Defense_Facility, 'DF')),
            cc: rowLabel('CC', null, techName(T.Command_Center, 'CC')),
            barracks: rowLabel('B', IMG.infantry, techName(T.Barracks, 'B')),
            factory: rowLabel('F', IMG.vehicle, techName(T.Factory, 'F')),
            airport: rowLabel('A', IMG.aircraft, techName(T.Airport, 'A')),
            support: rowLabel('S', null, gameText('tnf:support', t('stabsSupport'))),
        };
        this._header(win, 'enemy', gameText('tnf:combat target', t('stabsEnemy')));
        win.add(this._section('enemy', true, ENEMY_ROWS.map(k => [k, enemyLabels[k]])));

        const repairLabels = {
            storage: rowLabel(null, IMG.rcBase, gameText('tnf:offense repair time', t('stabsRepairStorage'))),
            overall: rowLabel(null, IMG.rcOffense, gameText('tnf:repair points', t('stabsRepairPoints'))),
            crystal: rowLabel(null, IMG.crystal, gameText('tnf:crystals', t('stabsCrystal'))),
            infantry: rowLabel(null, IMG.rcInf, gameText('tnf:infantry repair title', t('stabsRepairInf'))),
            vehicle: rowLabel(null, IMG.rcVeh, gameText('tnf:vehicle repair title', t('stabsRepairVeh'))),
            aircraft: rowLabel(null, IMG.rcAir, gameText('tnf:aircraft repair title', t('stabsRepairAir'))),
        };
        this._header(win, 'repair', gameText('tnf:own repair cost', t('stabsRepair')));
        win.add(this._section('repair', true, REPAIR_ROWS.map(k => [k, repairLabels[k]])));

        const lootLabels = {
            tiberium: rowLabel(null, IMG.tiberium, gameText('tnf:tiberium', t('stabsTiberium'))),
            crystal: rowLabel(null, IMG.crystal, gameText('tnf:crystals', t('stabsCrystal'))),
            credits: rowLabel(null, IMG.credits, gameText('tnf:credits', t('stabsCredits'))),
            research: rowLabel(null, IMG.research, gameText('tnf:research points', t('stabsResearch'))),
            total: rowLabel(null, IMG.transfer, t('stabsLootTotal')),
        };
        this._header(win, 'loot', gameText('tnf:lootable resources:', t('stabsLoot')));
        win.add(this._section('loot', true, LOOT_ROWS.map(k => [k, lootLabels[k]])));

        win.add(this._buttons());

        // status bar inside the content, as TABS: count left, Reset right
        win.setShowStatusbar(true);
        const bar = win.getChildControl('statusbar').set({ paddingBottom: 6, paddingTop: 4 });
        win.add(bar);
        win.getChildControl('statusbar-text').set({ textColor: '#BBBBBB' });
        bar.add(new qx.ui.core.Spacer(), { flex: 1 });
        const reset = new qx.ui.basic.Label(t('stabsReset')).set({ textColor: '#115274' });
        reset.getContentElement().setStyle('text-decoration', 'underline');
        reset.addListener('click', () => this.opts.onReset());
        bar.add(reset);

        for (const key of SECTIONS) {
            if (config.get(`stabs.section.${key}`, true) === false) this.sections[key].exclude();
        }
        this.win = win;
    }

    /** Section header over the section box; a click folds the section. */
    _header(win, key, text) {
        const header = new qx.ui.container.Composite(new qx.ui.layout.Grow()).set({ alignX: 'center', alignY: 'middle', zIndex: 11 });
        header.add(new qx.ui.container.Composite(new qx.ui.layout.VBox(5)).set({
            decorator: 'pane-light-opaque', allowGrowX: true, allowGrowY: true,
        }));
        header.add(new qx.ui.basic.Label(text).set({
            paddingLeft: 9, paddingBottom: 2, allowGrowX: true, allowGrowY: true, font: 'font_size_13_bold_shadow',
        }));
        header.addListener('click', () => {
            const section = this.sections[key];
            const open = !section.isVisible();
            if (open) section.show();
            else section.exclude();
            this.opts.config.set(`stabs.section.${key}`, open);
        });
        win.add(header);
    }

    /**
     * A row of boxes: the label column, then one box per preset column.
     * @param {Array<[key, labelWidget]>} rows
     */
    _section(key, underHeader, rows) {
        const section = new qx.ui.container.Composite(new qx.ui.layout.HBox(-2)).set({
            decorator: 'pane-light-plain', allowGrowX: true, marginTop: underHeader ? -18 : 0,
        });
        const labels = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
            width: LABEL_COLUMN, padding: 9, marginTop: underHeader ? 10 : 0, allowGrowX: true,
        });
        this.rows[key] = {};
        for (const [rowKey, label] of rows) {
            labels.add(label);
            this.rows[key][rowKey] = [label];
        }
        section.add(labels, { flex: 0 });
        this.opts.presets.forEach((preset, i) => {
            const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
                allowGrowX: true, marginTop: underHeader ? 10 : 0, decorator: 'pane-light-opaque',
            });
            const col = this.columns[i];
            col.cells[key] = {};
            for (const [rowKey] of rows) {
                let cell;
                if (key === 'battle' && rowKey === 'preset') {
                    cell = valueLabel('center').set({ value: preset.name, toolTipText: preset.description });
                } else if (key === 'battle' && rowKey === 'outcome') {
                    cell = new qx.ui.basic.Atom('-', null).set({ alignX: 'center', alignY: 'middle', gap: 0, iconPosition: 'top', minHeight: ROW_HEIGHT, show: 'label' });
                    cell.getChildControl('icon').set({ width: 18, height: 18, scale: true, alignY: 'middle' });
                } else {
                    cell = valueLabel(key === 'battle' ? 'center' : 'right');
                }
                if (key === 'repair' && rowKey === 'overall') cell.getContentElement().setStyle('text-shadow', '0 0 3pt');
                box.add(cell, { flex: 1 });
                col.cells[key][rowKey] = cell;
                this.rows[key][rowKey].push(cell);
            }
            box.addListener('dblclick', () => this.opts.onLoad(preset.id));
            col.boxes.push(box);
            section.add(box, { flex: 1 });
        });
        this.sections[key] = section;
        return section;
    }

    _buttons() {
        const section = new qx.ui.container.Composite(new qx.ui.layout.HBox(-2)).set({ decorator: 'pane-light-plain', allowGrowX: true });
        const labels = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ width: LABEL_COLUMN, padding: 9, allowGrowX: true });
        // only an icon, not a button (as TABS)
        labels.add(rowLabel(null, IMG.simulate, t('stabsViewSimulation')).set({ marginTop: 1, marginBottom: 5 }));
        section.add(labels, { flex: 0 });
        this.opts.presets.forEach((preset, i) => {
            const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ allowGrowX: true, decorator: 'pane-light-opaque' });
            const pair = new qx.ui.container.Composite(new qx.ui.layout.HBox()).set({ allowGrowX: true });
            pair.add(iconButton(IMG.simulate, t('stabsLoadSimulate'), () => this.opts.onSimulate(preset.id)));
            pair.add(iconButton(IMG.play, t('stabsViewSimulation'), () => this.opts.onReplay(preset.id)));
            box.add(pair, { flex: 1 });
            this.columns[i].boxes.push(box);
            section.add(box, { flex: 1 });
        });
        return section;
    }

    /**
     * Fill the window.
     * @param {object} s
     * @param {Array<{cells, dim}>} s.columns — per preset, cells from columnCells()
     * @param {string[]} s.enemyRows — Defender rows to show
     * @param {boolean} s.moraleVisible
     * @param {number} s.cacheCount
     * @param {object} s.outcomeTitles — outcome key -> tooltip
     */
    update(s) {
        if (!this.win) return;
        s.columns.forEach(({ cells, dim }, i) => {
            const col = this.columns[i];
            if (!col) return;
            for (const section of ['enemy', 'repair', 'loot']) {
                for (const [k, cell] of Object.entries(cells[section])) setCell(col.cells[section][k], cell);
            }
            for (const k of ['duration', 'base', 'morale']) setCell(col.cells.battle[k], cells.battle[k]);
            const outcome = col.cells.battle.outcome;
            if (cells.battle.outcome) {
                outcome.set({ icon: IMG[cells.battle.outcome], toolTipIcon: IMG[cells.battle.outcome], toolTipText: s.outcomeTitles[cells.battle.outcome], show: 'icon' });
            } else {
                outcome.set({ show: 'label' });
                outcome.resetIcon();
                outcome.resetToolTipText();
            }
            for (const box of col.boxes) {
                box.setDecorator(dim ? 'pane-light-plain' : 'pane-light-opaque');
                box.setOpacity(dim ? DIM_OPACITY : 1);
            }
        });
        const shown = new Set(s.enemyRows);
        for (const k of ENEMY_ROWS) for (const w of this.rows.enemy[k]) w.setVisibility(shown.has(k) ? 'visible' : 'excluded');
        for (const w of this.rows.battle.morale) w.setVisibility(s.moraleVisible ? 'visible' : 'excluded');
        this.win.setStatus(t('stabsCacheCount', { n: s.cacheCount }));
    }
}

function setCell(widget, cell) {
    if (!widget || !cell) return;
    if (widget.getValue() !== cell.text) widget.setValue(cell.text);
    if (cell.color) widget.setTextColor(cell.color);
    else widget.resetTextColor();
}
