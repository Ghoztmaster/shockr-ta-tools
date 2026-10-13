/**
 * sector-hud.js — sector HUD on the world map (replaces WarChiefs - Tiberium
 * Alliances Sector HUD 22.05.04).
 *
 * The original shows one line top-left (desktop left 128, top 0): the view
 * centre's coordinates and its compass sector, "450:620 [NE]"; left click
 * pastes the coordinates into the chat input, right click asks for
 * coordinates to jump to. Ported, plus POI progress per sector:
 *
 *   450:620 [NE] · POI 4 own · 2 enemy · 9 free
 *   S 0  SW 2  W 0  NW 1  N 5  NE 4  E 0  SE 3      (own POIs per sector)
 *
 * A sector has no owner in the game (lib/poi-util.js); "who holds it" = who
 * holds the POIs in it. Colours: own alliance holds the most = green, another
 * alliance = red, none held = grey.
 *   - own POIs: alliance.get_OwnedPOIs() - complete, also off-screen
 *   - enemy / free: only the POIs SEEN on the map this session (the client
 *     only knows loaded regions) - the tooltip says so
 *
 * Only while the world map is shown; the view centre is read every second,
 * the visible POIs every 3 s. DOM overlay under document.body
 * (position: fixed), no qx window.
 */
import { t } from '../lib/i18n.js';
import { isWorldMapVisible } from '../lib/map-overlay.js';
import {
    sectorNo, sectorAbbr, worldGeometry, ownAlliance, ownedPois, visiblePois, sectorSummary,
} from '../lib/poi-util.js';

const TICK_MS = 1000;
const SCAN_MS = 3000;
export const STATUS_COLORS = { own: '#66bb6a', enemy: '#ef5350', none: '#9e9e9e' };

/** View centre cell - WarChiefs' get_Coords. */
export function viewCenter(region) {
    const zoom = region.get_ZoomFactor();
    return {
        x: Math.floor((region.get_PosX() + region.get_ViewWidth() / 2 / zoom) / region.get_GridWidth() - 0.5),
        y: Math.floor((region.get_PosY() + region.get_ViewHeight() / 2 / zoom) / region.get_GridHeight() - 0.5),
    };
}

/** "[coords]450:620[/coords]" parsing for the jump prompt (WarChiefs' regex). */
export function parseCoords(text) {
    const m = /(\[coords\])?#?(\d{1,4})\D(\d{1,4})/i.exec(String(text || ''));
    return m ? { x: parseInt(m[2], 10), y: parseInt(m[3], 10) } : null;
}

export class SectorHud {
    /** Short description for `/st help`. */
    get description() { return t('descSectorHud'); }

    constructor(config) {
        this.name = 'SectorHud';
        this.config = config;
        this.running = false;
        this.seen = new Map();        // "x:y" -> {x, y, ownerId} POIs seen on the map this session
        this.el = null;
        this._timer = null;
        this._lastScan = 0;
        this._warned = false;
    }

    async start() {
        this.running = true;
        this._timer = setInterval(() => this.tick(), TICK_MS);
        this.tick();
        console.log('[ST] SectorHud: started');
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        if (this.el) {
            this.el.remove();
            this.el = null;
        }
    }

    /** One-line status for `/st status`. */
    statusText() {
        return t('sectorHudStatus', { n: this.seen.size });
    }

    /** All known POIs: seen on the map + the complete own list (own wins). */
    knownPois(ownId) {
        const all = new Map(this.seen);
        for (const p of ownedPois()) all.set(`${p.x}:${p.y}`, { x: p.x, y: p.y, ownerId: ownId });
        return [...all.values()];
    }

    tick(now = Date.now()) {
        if (!this.running) return;
        try {
            if (!isWorldMapVisible()) {
                if (this.el) this.el.style.display = 'none';
                return;
            }
            if (now - this._lastScan >= SCAN_MS) {
                this._lastScan = now;
                for (const p of visiblePois()) this.seen.set(`${p.x}:${p.y}`, { x: p.x, y: p.y, ownerId: p.ownerId });
            }
            this.render();
        } catch (e) {
            if (!this._warned) {
                this._warned = true;
                console.warn('[ST] SectorHud: update failed', e && e.message);
            }
        }
    }

    render() {
        const geo = worldGeometry();
        if (!geo) return;
        const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
        const c = viewCenter(region);
        const here = sectorNo(c.x, c.y, geo.width, geo.height, geo.count);
        const own = ownAlliance();
        const summary = sectorSummary(this.knownPois(own && own.id), own && own.id, geo);
        const cur = summary[here];

        const el = this._ensureElement();
        el.style.display = '';
        el.textContent = '';
        const line1 = document.createElement('div');
        const coords = document.createElement('span');
        coords.textContent = `${c.x}:${c.y} `;
        const sec = document.createElement('span');
        sec.textContent = `[${sectorAbbr(here)}]`;
        sec.style.color = STATUS_COLORS[cur.status];
        sec.style.fontWeight = 'bold';
        const poi = document.createElement('span');
        poi.textContent = ' · ' + t('sectorHudPoi', { own: cur.own, enemy: cur.enemy, free: cur.free });
        line1.append(coords, sec, poi);

        const line2 = document.createElement('div');
        line2.style.marginTop = '1px';
        for (const s of summary) {
            const chip = document.createElement('span');
            chip.textContent = `${sectorAbbr(s.sector)} ${s.own}`;
            chip.style.color = STATUS_COLORS[s.status];
            chip.style.marginRight = '6px';
            if (s.sector === here) chip.style.textDecoration = 'underline';
            line2.appendChild(chip);
        }
        el.append(line1, line2);
        el.title = [
            ...summary.map(s => `${sectorAbbr(s.sector)}: ${t('sectorHudPoi', { own: s.own, enemy: s.enemy, free: s.free })}`),
            t('sectorHudSeenNote'),
            t('sectorHudClickNote'),
        ].join('\n');
    }

    _ensureElement() {
        if (this.el) return this.el;
        const el = document.createElement('div');
        Object.assign(el.style, {       // WarChiefs' spot: desktop left 128, top 0
            position: 'fixed',
            left: '128px',
            top: '0px',
            zIndex: '100000',
            padding: '2px 8px',
            background: 'rgba(0,0,0,0.75)',
            borderRadius: '0 0 4px 4px',
            color: '#ffffff',
            fontFamily: 'Iosevka Term, monospace',
            fontSize: '11px',
            lineHeight: '1.35',
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
        });
        el.setAttribute('data-st-sectorhud', '1');
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) this._pasteCoords();
            if (e.button === 2) this._jumpCoords();
        });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        document.body.appendChild(el);
        this.el = el;
        return el;
    }

    /** Left click: "[coords]x:y[/coords]" into the chat input at the cursor (WarChiefs' paste_Coords). */
    _pasteCoords() {
        try {
            const c = viewCenter(ClientLib.Vis.VisMain.GetInstance().get_Region());
            const input = qx.core.Init.getApplication().getChat().getChatWidget().getEditable();
            const dom = input.getContentElement().getDomElement();
            const value = dom.value || '';
            input.setValue([value.substring(0, dom.selectionStart), `[coords]${c.x}:${c.y}[/coords]`,
                value.substring(dom.selectionEnd)].join(' '));
        } catch (e) {
            console.warn('[ST] SectorHud: paste coords failed', e && e.message);
        }
    }

    /** Right click: ask for coordinates and centre the map there (WarChiefs' jump_Coords). */
    _jumpCoords() {
        try {
            const c = parseCoords(window.prompt(t('sectorHudJumpPrompt')));
            if (c) ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(c.x, c.y);
        } catch (e) {
            console.warn('[ST] SectorHud: jump failed', e && e.message);
        }
    }
}
