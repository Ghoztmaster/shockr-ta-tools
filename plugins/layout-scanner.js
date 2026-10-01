/**
 * layout-scanner.js — scan nearby FG base layouts and POST to alliance server.
 *
 * - Runs when player is idle (20 min inactive) or on manual /st scan command
 * - Scans FG bases/camps/outposts within attack range
 * - Skips already-scanned bases (version-based dedup)
 * - Opt-in only: disabled by default, requires /st plugin enable LayoutScanner
 * - Requires api.url and api.key to be configured
 * - Chat feedback on scan progress
 *
 * Config keys:
 *   api.url  — server URL (e.g. https://packetlab.nl/shockr)
 *   api.key  — alliance API key
 */
import { chatMessage } from '../lib/main.js';
import { getAllNearbyObjects, waitForCity } from '../lib/city-util.js';
import { extractScan } from '../lib/scanner-util.js';

/** Local version cache to avoid re-scanning identical bases. */
const scannedVersions = new Map(); // cityId → version

export class LayoutScanner {
    constructor(config, cli, apiClient, idleDetect) {
        this.name = 'LayoutScanner';
        this.config = config;
        this.cli = cli;
        this.api = apiClient;
        this.idle = idleDetect;
        this.running = false;
        this._scanning = false;
        this._scanInterval = null;
    }

  async start() {
        // Register CLI command first — works even without API config
        this.cli.register('scan', () => {
            if (!this.api.isConfigured) {
                chatMessage('[ST] Scanner not configured. Set api.url and api.key first.');
                return;
            }
            chatMessage('[ST] Manual scan started...');
            this.scanAll();
        });

        if (!this.api.isConfigured) {            console.log('[ST] LayoutScanner: no API configured — scanner inactive');
            chatMessage('[ST] LayoutScanner enabled but no server configured. Set api.url and api.key first.');
            this.running = true;
            return;
        }

        // Show consent notice on first enable
        const consentShown = this.config.get('layoutscanner.consent', false);
        if (!consentShown) {
            chatMessage('[ST] ⚠ LayoutScanner sends base layouts to an external server (' +
                this.api._url + '). This includes base positions, units, and buildings ' +
                'of FG camps/outposts/bases near you. Disable with /st plugin disable LayoutScanner');
            this.config.set('layoutscanner.consent', true);
        }

        // Scan on idle and every 60 minutes
        this.idle.on('idle', () => this.scanAll());
        this._scanInterval = setInterval(() => {
            if (this.idle.isIdle) this.scanAll();
        }, 60 * 60 * 1000);

        this.running = true;
        console.log('[ST] LayoutScanner: started (server: ' + this.api._url + ')');
    }

    stop() {
        this.running = false;
        if (this._scanInterval) {
            clearInterval(this._scanInterval);
            this._scanInterval = null;
        }
    }

    /** Scan all nearby FG objects. */
    async scanAll() {
        if (this._scanning) return;
        if (!this.api.isConfigured) return;

        this._scanning = true;
        const startTime = Date.now();
        let scanned = 0;
        let skipped = 0;

        try {
            const nearbyObjects = getAllNearbyObjects();

            for (const obj of nearbyObjects) {
                // Only NPC bases and camps (type 2 = NPCBase, type 3 = NPCCamp)
                if (obj.object.Type !== 2 && obj.object.Type !== 3) continue;

                // Skip destroyed camps
                if (typeof obj.object.$CampType !== 'undefined' && obj.object.$CampType === 0) continue;

                const cityId = obj.id;

                // Load city data
                const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
                cities.set_CurrentCityId(cityId);

                const city = await waitForCity(cityId, 20);
                if (!city) continue;

                // Version-based dedup
                const version = city.get_Version();
                if (scannedVersions.get(cityId) === version) {
                    skipped++;
                    continue;
                }

                // Extract and send
                const payload = extractScan(city);
                if (!payload) continue;

                this.api.send(payload);
                scannedVersions.set(cityId, version);
                scanned++;

                // Pacing: small delay between scans to not hammer the game client
                await sleep(200);
            }

            // Flush remaining
            await this.api.flush();

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            if (scanned > 0) {
                chatMessage(`[ST] Scan complete: ${scanned} base(s) sent, ${skipped} skipped (${duration}s)`);
            }
            console.log(`[ST] LayoutScanner: ${scanned} sent, ${skipped} skipped, ${duration}s`);

        } catch (e) {
            console.error('[ST] LayoutScanner error:', e);
            chatMessage('[ST] ⚠ Scan failed: ' + e.message);
        } finally {
            this._scanning = false;
        }
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
