/**
 * alliance-scanner.js — scan the bases of all own-alliance members and POST
 * them to the alliance server. Same pattern as layout-scanner.js.
 *
 * - Only scans when player is truly idle (20 min inactive)
 * - Manual scan via /st scanalliance (always works)
 * - Idle scans abort as soon as the player becomes active again
 * - Restores original city view after scanning
 * - 2 second delay between individual base scans
 * - Shares a scan lock with LayoutScanner (both switch the city view)
 *
 * Member bases are fetched with the GetPublicPlayerInfo server command,
 * which returns the player's cities as data.c[] = { i: cityId, n, x, y }.
 *
 * Config keys:
 *   api.url  — server URL (e.g. https://packetlab.nl/shockr)
 *   api.key  — alliance API key
 */
import { chatMessage } from '../lib/main.js';
import { waitForCity } from '../lib/city-util.js';
import { extractScan, acquireScanLock, releaseScanLock, scanLockHolder } from '../lib/scanner-util.js';

const SCAN_DELAY_MS = 2000;       // 2s between each base scan
const SCAN_INTERVAL_MS = 3600000; // re-scan every 60 minutes when idle
const PLAYER_INFO_DELAY_MS = 300; // pacing between GetPublicPlayerInfo calls
const PLAYER_INFO_TIMEOUT_MS = 10000;
const LOCK_WAIT_MS = 5000;        // idle scan: re-check a held scan lock every 5s
const LOCK_WAIT_MAX = 120;        // ... for at most 10 minutes

/** Local version cache to avoid re-scanning identical bases. */
const scannedVersions = new Map();

export class AllianceScanner {
    constructor(config, cli, apiClient, idleDetect) {
        this.name = 'AllianceScanner';
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
        this.cli.register('scanalliance', () => {
            if (!this.api.isConfigured) {
                chatMessage('[ST] Alliance scan not configured. Set api.url and api.key first.');
                return;
            }
            if (this._scanning) {
                chatMessage('[ST] Alliance scan already in progress...');
                return;
            }
            const holder = scanLockHolder();
            if (holder) {
                chatMessage(`[ST] ${holder} is scanning — try again when it is done.`);
                return;
            }
            chatMessage('[ST] Alliance scan started...');
            this.scanAll({ manual: true });
        });

        if (!this.api.isConfigured) {
            console.log('[ST] AllianceScanner: no API configured — scanner inactive');
            this.running = true;
            return;
        }

        // Only scan on idle — never immediately
        this.idle.on('idle', () => this._scanWhenFree());
        this._scanInterval = setInterval(() => {
            if (this.idle.isIdle) this._scanWhenFree();
        }, SCAN_INTERVAL_MS);

        this.running = true;
        console.log('[ST] AllianceScanner: started (server: ' + this.api._url + ')');
    }

    stop() {
        this.running = false;
        if (this._scanInterval) {
            clearInterval(this._scanInterval);
            this._scanInterval = null;
        }
    }

    /** Idle trigger: wait for another scanner (e.g. LayoutScanner) to finish first. */
    async _scanWhenFree() {
        for (let i = 0; i < LOCK_WAIT_MAX && scanLockHolder(); i++) {
            await sleep(LOCK_WAIT_MS);
            if (!this.idle.isIdle || !this.running) return;
        }
        this.scanAll({ manual: false });
    }

    /** Scan all bases of all alliance members. */
    async scanAll({ manual = false } = {}) {
        if (this._scanning) return;
        if (!this.api.isConfigured) return;
        if (!acquireScanLock(this.name)) return;

        this._scanning = true;
        const startTime = Date.now();
        let scanned = 0;
        let skipped = 0;
        let aborted = false;

        // Remember current city so we can restore it after scanning
        let originalCityId = null;
        try {
            originalCityId = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCityId();
        } catch { /* ignore */ }

        try {
            const cityIds = await getAllianceCityIds();
            const cities = ClientLib.Data.MainData.GetInstance().get_Cities();

            for (const cityId of cityIds) {
                // Idle scans stop as soon as the player is back
                if (!manual && !this.idle.isIdle) {
                    aborted = true;
                    break;
                }

                // Quick version check before loading the city
                try {
                    const existingCity = cities.GetCity(cityId);
                    if (existingCity && scannedVersions.get(cityId) === existingCity.get_Version()) {
                        skipped++;
                        continue;
                    }
                } catch { /* continue with full load */ }

                // Load city data
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
            if (manual || scanned > 0) {
                chatMessage(`[ST] Alliance scan complete: ${scanned} base(s) sent, ${skipped} skipped (${duration}s)`);
            }
            console.log(`[ST] AllianceScanner: ${scanned} sent, ${skipped} skipped, ${duration}s${aborted ? ' (aborted: player active)' : ''}`);

        } catch (e) {
            console.error('[ST] AllianceScanner error:', e);
            chatMessage('[ST] ⚠ Alliance scan failed: ' + e.message);
        } finally {
            // Restore original city view
            if (originalCityId) {
                try {
                    ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(originalCityId);
                } catch { /* ignore */ }
            }
            this._scanning = false;
            releaseScanLock(this.name);
        }
    }
}

/**
 * Collect the city IDs of all own-alliance members (including the player).
 * @returns {Promise<number[]>}
 */
async function getAllianceCityIds() {
    const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
    if (!alliance || !alliance.get_Id()) return [];

    const members = alliance.get_MemberDataAsArray() || [];
    const ids = [];

    for (const member of members) {
        if (!member || !member.Id) continue;
        const info = await getPublicPlayerInfo(member.Id);
        if (info && Array.isArray(info.c)) {
            for (const c of info.c) {
                if (c && c.i && !ids.includes(c.i)) ids.push(c.i);
            }
        }
        await sleep(PLAYER_INFO_DELAY_MS);
    }
    return ids;
}

/** Promise wrapper around the GetPublicPlayerInfo server command. */
function getPublicPlayerInfo(playerId) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), PLAYER_INFO_TIMEOUT_MS);
        try {
            ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand(
                'GetPublicPlayerInfo',
                { id: playerId },
                webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, null, (context, data) => {
                    clearTimeout(timer);
                    resolve(data || null);
                }),
                null
            );
        } catch (e) {
            clearTimeout(timer);
            console.warn('[ST] AllianceScanner: GetPublicPlayerInfo failed', e);
            resolve(null);
        }
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
