/**
 * layout-scanner.js — scan nearby FG base layouts and POST to alliance server.
 *
 * - Only scans when player is truly idle (20 min inactive)
 * - Manual scan via /st scan (always works)
 * - Restores original city view after scanning
 * - 2 second delay between individual base scans to avoid flickering
 * - Skips if player is in a base/battle view
 *
 * Config keys:
 *   api.url  — server URL (e.g. https://packetlab.nl/shockr)
 *   api.key  — alliance API key
 */
import { chatMessage } from '../lib/main.js';
import { t } from '../lib/i18n.js';
import { getAllNearbyObjects, waitForCity } from '../lib/city-util.js';
import { extractScan, acquireScanLock, releaseScanLock } from '../lib/scanner-util.js';

const SCAN_DELAY_MS = 2000;      // 2s between each base scan
const SCAN_INTERVAL_MS = 3600000; // re-scan every 60 minutes when idle

/** Local version cache to avoid re-scanning identical bases. */
const scannedVersions = new Map();

export class LayoutScanner {
    /** Short description for `/st help`. */
    get description() { return t('descLayoutScanner'); }

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
                chatMessage(`[ST] ${t('scanNotConfigured')}`);
                return;
            }
            if (this._scanning) {
                chatMessage(`[ST] ${t('scanInProgress')}`);
                return;
            }
            chatMessage(`[ST] ${t('scanManualStarted')}`);
            this.scanAll();
        });

        if (!this.api.isConfigured) {
            console.log('[ST] LayoutScanner: no API configured — scanner inactive');
            chatMessage(`[ST] ${t('scanNoServer')}`);
            this.running = true;
            return;
        }

        // Show consent notice on first enable
        const consentShown = this.config.get('layoutscanner.consent', false);
        if (!consentShown) {
            chatMessage(`[ST] ${t('scanConsent', { url: this.api._url })}`);
            this.config.set('layoutscanner.consent', true);
        }

        // Only scan on idle — never immediately
        this.idle.on('idle', () => this.scanAll());
        this._scanInterval = setInterval(() => {
            if (this.idle.isIdle) this.scanAll();
        }, SCAN_INTERVAL_MS);

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
        if (!acquireScanLock(this.name)) return;

        this._scanning = true;
        /** window.__stScannerActive = true; */
        const startTime = Date.now();
        let scanned = 0;
        let skipped = 0;

        // Remember current city so we can restore it after scanning
        let originalCityId = null;
        try {
            const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
            originalCityId = cities.get_CurrentCityId();
        } catch { /* ignore */ }

        try {
            const nearbyObjects = getAllNearbyObjects();

            for (const obj of nearbyObjects) {
                // Only NPC bases and camps (type 2 = NPCBase, type 3 = NPCCamp)
                if (obj.object.Type !== 2 && obj.object.Type !== 3) continue;

                // Skip destroyed camps
                if (typeof obj.object.$CampType !== 'undefined' && obj.object.$CampType === 0) continue;

                const cityId = obj.id;

                // Quick version check before loading the city
                // (avoid switching view if we already have this version)
                try {
                    const existingCity = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(cityId);
                    if (existingCity) {
                        const version = existingCity.get_Version();
                        if (scannedVersions.get(cityId) === version) {
                            skipped++;
                            continue;
                        }
                    }
                } catch { /* continue with full load */ }

                // Load city data
                const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
                cities.set_CurrentCityId(cityId);

                const city = await waitForCity(cityId, 20);
                if (!city) continue;

                // Version-based dedup (double check after load)
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

                // Pacing: 2 seconds between scans to avoid screen flickering
                await sleep(SCAN_DELAY_MS);
            }

            // Flush remaining
            await this.api.flush();

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            if (scanned > 0) {
                chatMessage(`[ST] ${t('scanComplete', { scanned, skipped, duration })}`);
            }
            console.log(`[ST] LayoutScanner: ${scanned} sent, ${skipped} skipped, ${duration}s`);

        } catch (e) {
            console.error('[ST] LayoutScanner error:', e);
            chatMessage(`[ST] ${t('scanFailed', { error: e.message })}`);
        } finally {
            // Restore original city view
            if (originalCityId) {
                try {
                    ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(originalCityId);
                } catch { /* ignore */ }
            }
            // window.__stScannerActive = false;
            this._scanning = false;
            releaseScanLock(this.name);
        }
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
