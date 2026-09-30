/**
 * camp-tracker.js — show numbered markers on the world map for nearby camps/outposts.
 *
 * Features:
 * - Configurable: size, font, fontSize, offense filter, count, alert
 * - Chat alert on new camp/outpost spawns
 * - Auto-updates on region scroll/zoom and sector updates
 *
 * TODO: implement after in-game validation of ClientLib patches
 */
import { chatMessage } from '../lib/main.js';

const DEFAULTS = {
    size: 24,
    font: 'Iosevka Term',
    fontSize: 20,
    offense: -1,      // filter: camps below main's offense + this value are hidden
    count: 10,         // max markers shown
    alert: true,       // chat alert on new spawns
};

export class CampTracker {
    constructor(config, cli) {
        this.name = 'CampTracker';
        this.config = config;
        this.cli = cli;
        this.running = false;
        this.markers = new Map();
        this._firstUpdate = true;
    }

    async start() {
        this.running = true;
        // TODO: hook into region events
        // - PositionChange, ZoomFactorChange → updateMarkerPositions
        // - SectorUpdated, Cities.Change → doUpdate
        console.log('[ST] CampTracker: ready (implementation pending)');
    }

    stop() {
        this.running = false;
        for (const [, marker] of this.markers) {
            marker.el.remove();
        }
        this.markers.clear();
    }

    /** Get a config value with default fallback. */
    _cfg(key) {
        return this.config.get(`camptracker.${key}`, DEFAULTS[key]);
    }
}
