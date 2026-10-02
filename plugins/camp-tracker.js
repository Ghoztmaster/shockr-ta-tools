/**
 * camp-tracker.js — show numbered markers on the world map for nearby camps/outposts.
 *
 * Features:
 * - Numbered markers (#1, #2, ...) on the world map near the player's main base
 * - Configurable: size, font, fontSize, offense filter, count, alert
 * - Chat alert on new camp/outpost spawns
 * - Auto-updates on region scroll/zoom and sector changes
 * - Green markers for top 3, yellow-green for the rest
 *
 * Config keys (via /st config set camptracker.<key> <value>):
 *   size      — marker circle size in px (default 24)
 *   font      — font family (default 'Iosevka Term')
 *   fontsize  — font size in px (default 20)
 *   offense   — filter: hide camps below main offense + this value (default -1)
 *   count     — max markers shown (default 10)
 *   alert     — chat alert on new spawns (default true)
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';
import { getMainCity, getObjectsNearCity } from '../lib/city-util.js';

const DEFAULTS = {
    size: 24,
    font: 'Iosevka Term',
    fontsize: 20,
    offense: -1,
    count: 10,
    alert: true,
};

export class CampTracker {
    /** Short description for `/st help`. */
    get description() { return t('descCampTracker'); }

    constructor(config, cli) {
        this.name = 'CampTracker';
        this.config = config;
        this.running = false;
        this.markers = new Map();
        this._firstUpdate = true;
        this._updateTimer = null;
        this._lastStep = -1;
        this._events = [];

        // Bind methods for event handlers
        this._onRegionChange = () => this._updatePositions();
        this._onSectorUpdate = () => this._scheduleUpdate();
        this._onCitiesChange = () => this._scheduleUpdate();
    }

    async start() {
        this.running = true;

        // Use floating point base level for tooltips
        try {
            const rc = ClientLib.Vis.Region.RegionNPCBase.prototype;
            if (rc.get_BaseLevelFloat && !rc._st_patched_baselevel) {
                rc.get_BaseLevel = rc.get_BaseLevelFloat;
                rc._st_patched_baselevel = true;
            }
        } catch { /* optional */ }
        try {
            const rc2 = ClientLib.Vis.Region.RegionNPCCamp.prototype;
            if (rc2.get_BaseLevelFloat && !rc2._st_patched_baselevel) {
                rc2.get_BaseLevel = rc2.get_BaseLevelFloat;
                rc2._st_patched_baselevel = true;
            }
        } catch { /* optional */ }

        // Hook into region events
        const visMain = ClientLib.Vis.VisMain.GetInstance();
        const region = visMain.get_Region();
        const md = ClientLib.Data.MainData.GetInstance();

        this._attachEvent(region, 'PositionChange', ClientLib.Vis.PositionChange, this._onRegionChange);
        this._attachEvent(region, 'ZoomFactorChange', ClientLib.Vis.ZoomFactorChange, this._onRegionChange);
        this._attachEvent(region, 'SectorUpdated', ClientLib.Vis.Region.SectorUpdated, this._onSectorUpdate);
        this._attachEvent(md.get_Cities(), 'Change', ClientLib.Data.CitiesChange, this._onCitiesChange);

        // Initial update
        this._doUpdate();
        console.log('[ST] CampTracker: started');
    }

    stop() {
        this.running = false;

        // Remove event listeners
        for (const ev of this._events) {
            try {
                webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb);
            } catch { /* ignore */ }
        }
        this._events = [];

        // Remove markers
        for (const [, marker] of this.markers) {
            marker.el.remove();
        }
        this.markers.clear();

        if (this._updateTimer) {
            cancelAnimationFrame(this._updateTimer);
            this._updateTimer = null;
        }
    }

    /** Get a config value with default fallback. */
    _cfg(key) {
        return this.config.get(`camptracker.${key}`, DEFAULTS[key]);
    }

    /** Attach a ClientLib event and track for cleanup. */
    _attachEvent(source, name, type, cb) {
        this._events.push({ source, name, type, cb });
        webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
    }

    /** Schedule an update on next animation frame (debounced). */
    _scheduleUpdate() {
        if (this._updateTimer) return;

        const serverStep = ClientLib.Data.MainData.GetInstance().get_Time().GetServerStep();
        if (serverStep === this._lastStep) return;
        this._lastStep = serverStep;

        this._updateTimer = requestAnimationFrame(() => {
            this._updateTimer = null;
            this._doUpdate();
        });
    }

    /** Main update: find camps, manage markers, alert on new spawns. */
    _doUpdate() {
        const mainCity = getMainCity();
        if (!mainCity) return;

        const offLevel = parseInt(mainCity.get_LvlOffense());
        const minLevel = offLevel + this._cfg('offense');
        const maxCount = this._cfg('count');
        const alertEnabled = this._cfg('alert');

        // Find all NPC camps/outposts near main city
        const nearby = getObjectsNearCity(mainCity);
        const camps = [];

        for (const entry of nearby.values()) {
            const obj = entry.object;

            // Must have $CampType (= is a patched NPC camp)
            if (typeof obj.$CampType === 'undefined') continue;

            // Skip destroyed camps
            if (obj.$CampType === 0) continue;

            // Skip below minimum level
            if (typeof obj.$Level !== 'undefined' && obj.$Level < minLevel) continue;

            camps.push({ ...entry, campType: obj.$CampType, level: obj.$Level });
        }

        // Sort by ID descending (newest first) and take top N
        const newest = camps.sort((a, b) => b.id - a.id).slice(0, maxCount);

        // Track which existing markers are still valid
        const keepIds = new Set();

        newest.forEach((camp, index) => {
            keepIds.add(camp.id);

            const existing = this.markers.get(camp.id);
            if (existing) {
                // Update index (rank may have changed)
                existing.index = index;
                existing.x = camp.x;
                existing.y = camp.y;
            } else {
                // New camp — create marker
                this._addMarker(camp.id, camp.x, camp.y, index);

                // Alert (skip first load to avoid spam)
                if (!this._firstUpdate && alertEnabled && index === 0) {
                    const type = t(camp.campType === 2 ? 'campTypeCamp' : 'campTypeOutpost');
                    const time = new Date().toLocaleTimeString('de-DE', { hour12: false });
                    const cx = Math.round(camp.x);
                    const cy = Math.round(camp.y);
                    const coord = `<a style="color:${webfrontend.gui.util.BBCode.clrLink};cursor:pointer;" onClick="webfrontend.gui.UtilView.centerCoordinatesOnRegionViewWindow(${cx},${cy});">${cx}:${cy}</a>`;
                    chatMessage(`[ST] ${t('campSpawned', { time, level: camp.level || '?', type, coord })}`);
                }
            }
        });

        this._firstUpdate = false;

        // Remove markers for camps no longer in the list
        for (const [cityId, marker] of this.markers) {
            if (!keepIds.has(cityId)) {
                marker.el.remove();
                this.markers.delete(cityId);
            }
        }

        // Update all marker positions
        this._updatePositions();
    }

    /** Create a marker DOM element and track it. */
    _addMarker(cityId, x, y, index) {
        const el = document.createElement('div');
        el.title = t('markerTitle', { id: cityId });
        this._applyStyle(el);
        this.markers.set(cityId, { el, x, y, index });
        this._updateElement(el, x, y, index);
        this._addToDom(el);
    }

    /** Apply CSS styling to a marker element. */
    _applyStyle(el) {
        const size = this._cfg('size');
        Object.assign(el.style, {
            position: 'absolute',
            pointerEvents: 'none',
            fontFamily: this._cfg('font'),
            fontWeight: 'bold',
            fontSize: this._cfg('fontsize') + 'px',
            zIndex: '10',
            borderRadius: '50%',
            width: size + 'px',
            height: size + 'px',
            padding: '2px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            border: '2px solid rgba(0,0,0,0.87)',
        });
    }

    /** Update a single marker element's position and label. */
    _updateElement(el, x, y, index) {
        const visMain = ClientLib.Vis.VisMain.GetInstance();
        const region = visMain.get_Region();
        const gw = region.get_GridWidth();
        const gh = region.get_GridHeight();

        const screenTop = visMain.ScreenPosFromWorldPosY((y + 0.1) * gh);
        const screenLeft = visMain.ScreenPosFromWorldPosX((x + 0.1) * gw);
        const viewH = region.get_ViewHeight();
        const viewW = region.get_ViewWidth();

        // Hide if off screen
        if (screenTop < 0 || screenLeft < 0 || screenTop > viewH || screenLeft > viewW) {
            if (el.parentElement) el.remove();
            return;
        }

        el.style.top = screenTop + 'px';
        el.style.left = screenLeft + 'px';

        // Update label and color only when index changes
        if (el.getAttribute('st-idx') !== String(index)) {
            el.innerHTML = '#' + (index + 1);
            el.style.backgroundColor = index < 3
                ? 'rgba(0,240,0,0.9)'
                : 'rgba(200,240,0,0.9)';
            el.setAttribute('st-idx', String(index));
        }

        // Re-add to DOM if it was removed (off-screen cleanup)
        if (!el.parentElement) this._addToDom(el);
    }

    /** Update positions of all markers (called on scroll/zoom). */
    _updatePositions() {
        for (const [, { el, x, y, index }] of this.markers) {
            this._updateElement(el, x, y, index);
        }
    }

    /** Append a marker to the game's canvas parent. */
    _addToDom(el) {
        try {
            const canvas = document.querySelector('canvas');
            if (canvas && canvas.parentElement) {
                canvas.parentElement.appendChild(el);
            }
        } catch { /* ignore */ }
    }
}
