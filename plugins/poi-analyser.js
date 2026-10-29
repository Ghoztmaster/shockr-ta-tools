// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * poi-analyser.js — POI bonuses on the world map and in the info panel
 * (replaces the POI part of Tiberium Alliances Info Sticker and
 * Tiberium Alliances Real POI Bonus).
 *
 * POI bonuses are alliance-wide in the game (see lib/poi-util.js): every base
 * of every member gets the same bonus, so this plugin does NOT show a
 * per-base bonus - there is none. What it shows:
 *
 *   1. Map labels at every POI in view: "Tib 32" (type + level), top-left of
 *      the cell (CampTracker / Base Info's spot - the game's own name/level
 *      text sits at the bottom of the cell). Gold = held
 *      by the own alliance (its bonus is active for you), red = another
 *      alliance, grey = free. Tooltip: type, level, score, owner.
 *   2. Info panel of an own / alliance base: section "POI" with the own
 *      alliance's active bonuses per type (+12.3k/h tiberium, +10% infantry,
 *      … with rank), only types with a bonus; "no POI bonus" when none.
 *   3. Info panel of a POI: type, level, score, owner, and the REAL gain
 *      (not owned) or loss (owned) of that POI for the own alliance - TA Real
 *      POI Bonus' calculation incl. the rank multiplier; when the rank would
 *      change, one read-only RankingGetData request (cached 10 min).
 *
 * Map labels only while the world map is shown (scroll/zoom repositions,
 * region changes rescan, plus a 3 s interval). Stopping removes labels and
 * panel sections.
 */
import { t } from '../lib/i18n.js';
import {
    isWorldMapVisible, cellToScreen, viewSize, addToMap,
    attachMapEvents, detachMapEvents,
} from '../lib/map-overlay.js';
import {
    KEY_ORDER, fmtBonus, fmtNumber, ownAlliance, allianceBonuses,
    visiblePois, poiFromVisObject, poiScore, realPoiDelta, rankedPoiDelta,
    poiDeltaContext, fetchPoiRanking,
} from '../lib/poi-util.js';

const REFRESH_MS = 3000;
export const COLORS = { own: '#ffc107', enemy: '#ef5350', free: '#bdbdbd' };
/** Info widgets of own / alliance bases (webfrontend.gui.region.*): the alliance bonus applies there. */
const BASE_INFOS = ['RegionCityStatusInfoOwn', 'RegionCityStatusInfoAlliance'];
const POI_INFO = 'RegionPointOfInterestStatusInfo';

/** Label text on the map: "Tib 32". */
export function labelText(poi) {
    return `${t(`poiShort_${poi.key}`)} ${Math.floor(poi.level)}`;
}

/** 'own' | 'enemy' | 'free' for a POI owner. */
export function ownerKind(ownerId, ownId) {
    if (!ownerId) return 'free';
    return ownId && ownerId === ownId ? 'own' : 'enemy';
}

/** Panel lines for the own alliance's bonuses: only types with a bonus, KEY_ORDER. */
export function bonusLines(bonuses) {
    return (bonuses || [])
        .filter(b => b.value > 0)
        .sort((a, b) => KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key))
        .map(b => t(b.rank ? 'poiBonusLineRank' : 'poiBonusLine',
            { type: t(`poiName_${b.key}`), bonus: fmtBonus(b.key, b.value, true), rank: b.rank }));
}

export class PoiAnalyser {
    /** Short description for `/st help`. */
    get description() { return t('descPoiAnalyser'); }

    constructor(config) {
        this.name = 'PoiAnalyser';
        // its info-panel block only renders on the panel's next appear: a live enable says so
        this.appearsOnSelect = true;
        this.config = config;
        this.running = false;
        this.labels = new Map();      // "x:y" -> { el, x, y }
        this._events = [];
        this._interval = null;
        this._raf = null;
        this._listeners = [];         // {widget, id}
        this._panel = null;           // qx container + labels
        this._poiPanelKey = null;     // "x:y" of the POI whose panel is open
        this._warned = false;
    }

    async start() {
        this.running = true;
        try {
            this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
        } catch { this._events = []; }
        this._interval = setInterval(() => this.update(), REFRESH_MS);
        this._hookPanels();
        this.update();
        console.log('[ST] PoiAnalyser: started');
    }

    stop() {
        this.running = false;
        detachMapEvents(this, this._events);
        this._events = [];
        if (this._interval) clearInterval(this._interval);
        if (this._raf) cancelAnimationFrame(this._raf);
        this._interval = this._raf = null;
        for (const { widget, id } of this._listeners) {
            try { widget.removeListenerById(id); } catch { /* ignore */ }
        }
        this._listeners = [];
        if (this._panel) {
            try {
                const parent = this._panel.container.getLayoutParent();
                if (parent) parent.remove(this._panel.container);
                this._panel.container.dispose();
            } catch { /* ignore */ }
            this._panel = null;
        }
        this._poiPanelKey = null;
        this._clear();
    }

    /** One-line status for `/st status`. */
    statusText() {
        const n = (allianceBonuses() || []).filter(b => b.value > 0).length;
        return t('poiStatus', { labels: this.labels.size, types: n });
    }

    _warn(msg, e) {
        if (this._warned) return;
        this._warned = true;
        console.warn(`[ST] PoiAnalyser: ${msg}`, e && e.message ? e.message : '');
    }

    // ─── Map labels ──────────────────────────────────────────────────

    _schedule() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            this.update();
        });
    }

    _clear() {
        for (const { el } of this.labels.values()) el.remove();
        this.labels.clear();
    }

    /** Rescan the visible POIs and render their labels; never throws. */
    update() {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            const own = ownAlliance();
            const keep = new Set();
            for (const poi of visiblePois()) {
                const key = `${poi.x}:${poi.y}`;
                keep.add(key);
                let label = this.labels.get(key);
                if (!label) {
                    label = { el: this._createElement(), x: poi.x, y: poi.y };
                    this.labels.set(key, label);
                }
                const kind = ownerKind(poi.ownerId, own && own.id);
                label.el.textContent = labelText(poi);
                label.el.style.color = COLORS[kind];
                label.el.title = t('poiLabelTitle', {
                    type: t(`poiName_${poi.key}`), level: Math.floor(poi.level),
                    score: fmtNumber(poiScore(poi.level)),
                    owner: poi.ownerId ? poi.ownerName || `#${poi.ownerId}` : t('poiOwnerNone'),
                });
                this._place(label);
            }
            for (const [key, label] of this.labels) {
                if (!keep.has(key)) {
                    label.el.remove();
                    this.labels.delete(key);
                }
            }
        } catch (e) {
            this._warn('update failed', e);
        }
    }

    _reposition() {
        try {
            if (!isWorldMapVisible()) {
                this._clear();
                return;
            }
            for (const label of this.labels.values()) this._place(label);
        } catch { /* ignore */ }
    }

    _place(label) {
        // CampTracker / Base Info's spot (top-left of the cell): the game draws
        // the POI's own name + level at the bottom of the cell.
        const { left, top } = cellToScreen(label.x, label.y, 0.1, 0.1);
        const view = viewSize();
        if (top < 0 || left < 0 || top > view.height || left > view.width) {
            if (label.el.parentElement) label.el.remove();
            return;
        }
        label.el.style.left = left + 'px';
        label.el.style.top = top + 'px';
        addToMap(label.el);
    }

    _createElement() {
        const el = document.createElement('div');
        Object.assign(el.style, {      // Base Info's label style
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: '10',
            fontFamily: 'Iosevka Term',
            fontWeight: 'bold',
            fontSize: '12px',
            padding: '1px 4px',
            borderRadius: '3px',
            background: 'rgba(0,0,0,0.75)',
            whiteSpace: 'nowrap',
        });
        el.setAttribute('data-st-poi', '1');
        return el;
    }

    // ─── Info panel ──────────────────────────────────────────────────

    _hookPanels() {
        let region;
        try {
            region = webfrontend.gui.region;
        } catch (e) {
            this._warn('region info widgets not available — panel disabled', e);
            return;
        }
        for (const name of [...BASE_INFOS, POI_INFO]) {
            try {
                const cls = region && region[name];
                if (!cls || typeof cls.getInstance !== 'function') continue;
                const widget = cls.getInstance();
                const id = widget.addListener('appear', () => this._onAppear(widget, name), this);
                this._listeners.push({ widget, id });
            } catch (e) {
                this._warn(`could not hook ${name}`, e);
            }
        }
    }

    _ensurePanel() {
        if (this._panel) return this._panel;
        try {
            const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
                marginTop: 6, textColor: 'text-region-tooltip',
            });
            const title = new qx.ui.basic.Label('POI').set({ font: 'font_size_14', textColor: 'text-region-value' });
            const body = new qx.ui.basic.Label('').set({ rich: true, textColor: COLORS.own });
            box.add(title);
            box.add(body);
            this._panel = { container: box, title, body };
        } catch (e) {
            this._warn('could not build the panel', e);
        }
        return this._panel;
    }

    _setPanel(widget, lines, color = COLORS.own) {
        const panel = this._ensurePanel();
        if (!panel) return;
        panel.title.setValue(t('poiTitle'));
        panel.body.setValue(lines.map(escape).join('<br>'));
        panel.body.setTextColor(color);
        widget.add(panel.container);   // a qx widget has one parent: this moves it
    }

    _onAppear(widget, name) {
        if (!this.running) return;
        try {
            if (name === POI_INFO) this._showPoi(widget);
            else this._showBase(widget);
        } catch (e) {
            this._warn('panel update failed', e);
        }
    }

    _showBase(widget) {
        this._poiPanelKey = null;
        const bonuses = allianceBonuses();
        if (!bonuses) return;   // no alliance: no POI bonus at all, no section
        const lines = bonusLines(bonuses);
        this._setPanel(widget, lines.length ? [t('poiAllianceBonus'), ...lines] : [t('poiNone')],
            lines.length ? COLORS.own : COLORS.free);
    }

    /** The selected POI vis object (selection first, else the panel's own object). */
    _selectedPoi(widget) {
        try {
            const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
            if (sel && poiFromVisObject(sel)) return sel;
        } catch { /* try the panel */ }
        try {
            const obj = typeof widget.getObject === 'function' ? widget.getObject() : null;
            if (obj && poiFromVisObject(obj)) return obj;
        } catch { /* unknown */ }
        return null;
    }

    _showPoi(widget) {
        const vis = this._selectedPoi(widget);
        const poi = vis && poiFromVisObject(vis);
        if (!poi) return;
        const own = ownAlliance();
        const kind = ownerKind(poi.ownerId, own && own.id);
        const score = poiScore(poi.level);
        const head = t('poiInfoLine', {
            type: t(`poiName_${poi.key}`), level: Math.floor(poi.level), score: fmtNumber(score),
            owner: poi.ownerId ? poi.ownerName || `#${poi.ownerId}` : t('poiOwnerNone'),
        });
        let key = null;
        try { key = `${vis.get_RawX()}:${vis.get_RawY()}`; } catch { key = `${poi.key}:${poi.level}:${poi.ownerId}`; }
        this._poiPanelKey = key;
        if (!own) {
            this._setPanel(widget, [head], COLORS[kind]);
            return;
        }
        const ctx = this._deltaContext(poi, own, score);
        if (!ctx) {
            this._setPanel(widget, [head], COLORS[kind]);
            return;
        }
        const direct = realPoiDelta(ctx, ctx.total);
        if (direct.value !== null) {
            this._setPanel(widget, [head, this._deltaText(poi.key, direct)], COLORS[kind]);
            return;
        }
        this._setPanel(widget, [head, t(direct.kind === 'loss' ? 'poiRealLoss' : 'poiRealGain', { value: t('poiLoading') })], COLORS[kind]);
        this._fetchRanking(poi.poiType, own.id, (rows) => {
            if (!this.running || this._poiPanelKey !== key) return;
            const ranked = rankedPoiDelta({ ...ctx, poiOwnerId: poi.ownerId }, rows, ctx.total);
            this._setPanel(widget, [head, this._deltaText(poi.key, ranked)], COLORS[kind]);
        });
    }

    _deltaText(key, d) {
        return t(d.kind === 'loss' ? 'poiRealLoss' : 'poiRealGain', { value: fmtBonus(key, d.value, d.kind === 'gain') });
    }

    /** Rank/score of the own alliance for this POI type + the game's bonus formula. */
    _deltaContext(poi, own, score) {
        return poiDeltaContext(poi.poiType, poi.ownerId, own.id, score);
    }

    /** Other alliances' scores for this POI type (RankingGetData, read-only), cached 10 min. */
    _fetchRanking(poiType, ownId, done) {
        if (!fetchPoiRanking(poiType, ownId, done)) this._warn('RankingGetData failed');
    }
}

function escape(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

