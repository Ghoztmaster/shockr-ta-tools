/**
 * main.js — entry point for Shockr TA Tools v5.3.0
 *
 * Waits for the game client to load, applies ClientLib patches,
 * then starts all enabled plugins.
 */
import { waitForGame } from './game-ready.js';
import { applyPatches, PATCHES } from './clientlib-patch.js';
import { Config } from './config.js';
import { Cli } from './cli.js';
import { IdleDetect } from './idle-detect.js';
import { ApiClient } from './api-client.js';
import { fixUnload } from './bugfix.js';

// Plugins
import { CampTracker } from '../plugins/camp-tracker.js';
import { KillInfo } from '../plugins/kill-info.js';
import { PlayerStatus } from '../plugins/player-status.js';
import { LayoutScanner } from '../plugins/layout-scanner.js';
import { AllianceScanner } from '../plugins/alliance-scanner.js';
import { RepairGuard } from '../plugins/repair-guard.js';
import { UpgradeCalc } from '../plugins/upgrade-calc.js';

const ST_VERSION = '5.3.0';

async function startup() {
    console.log(`[ST] Shockr TA Tools v${ST_VERSION} loading...`);

    // 1. Wait for ClientLib + qooxdoo + player data
    const ready = await waitForGame({ maxAttempts: 200, intervalMs: 100 });
    if (!ready) {
        console.error('[ST] Game client did not load in time — aborting.');
        return;
    }

    // 2. Apply ClientLib patches (fingerprint-based)
    const patchResults = applyPatches(PATCHES);
    const failed = patchResults.filter(r => !r.ok);
    if (failed.length > 0) {
        const names = failed.map(r => r.name).join(', ');
        console.warn(`[ST] Patch failures: ${names}`);
        chatMessage(`[ST] ⚠ Patch failed: ${names} — some features may not work. Check for a script update.`);
    }

    // 3. Init core systems
    const config = new Config('st-config');
    const cli = new Cli(config);
    const idle = new IdleDetect();
    const api = new ApiClient(config);

    // 4. Register plugins
    const plugins = [
        new CampTracker(config, cli),
        new KillInfo(config, cli),
        new PlayerStatus(),
        new LayoutScanner(config, cli, api, idle),
        new AllianceScanner(config, cli, api, idle),
        new RepairGuard(config),
        new UpgradeCalc(config),
    ];

    // 5. Start enabled plugins
    for (const plugin of plugins) {
        const enabled = config.get(`${plugin.name}.enabled`, plugin.defaultEnabled !== false);
        if (!enabled) {
            console.log(`[ST] ${plugin.name}: disabled`);
            continue;
        }
        try {
            await plugin.start();
            console.log(`[ST] ${plugin.name}: started`);
        } catch (err) {
            console.error(`[ST] ${plugin.name}: failed to start`, err);
            chatMessage(`[ST] ⚠ ${plugin.name} failed to start: ${err.message}`);
        }
    }

    // 6. Register CLI commands
    cli.register('plugin', (args) => {
        const [action, name] = args;
        // Accept both 'RepairGuard' and 'repair-guard'
        const norm = (s) => (s || '').toLowerCase().replace(/[-_]/g, '');
        const plugin = plugins.find(p => norm(p.name) === norm(name));
        if (!plugin) {
            chatMessage(`[ST] Unknown plugin. Available: ${plugins.map(p => p.name).join(', ')}`);
            return;
        }
        if (action === 'enable') {
            config.set(`${plugin.name}.enabled`, true);
            if (!plugin.running) plugin.start();
            chatMessage(`[ST] ${plugin.name} enabled`);
        } else if (action === 'disable') {
            config.set(`${plugin.name}.enabled`, false);
            if (plugin.running) plugin.stop();
            chatMessage(`[ST] ${plugin.name} disabled`);
        } else {
            chatMessage(`[ST] Usage: /st plugin enable|disable <name>`);
        }
    });

    cli.register('status', () => {
        chatMessage(`[ST] Shockr TA Tools v${ST_VERSION}`);
        for (const p of plugins) {
            const extra = typeof p.statusText === 'function' ? ` — ${p.statusText()}` : '';
            chatMessage(`[ST] ${p.name}: ${p.running ? 'aan' : 'uit'}${extra}`);
        }
    });

    cli.register('version', () => {
        chatMessage(`[ST] Shockr TA Tools v${ST_VERSION}`);
    });

    cli.start();
    idle.start();
    fixUnload();

    chatMessage(`[ST] v${ST_VERSION} loaded — ${plugins.filter(p => p.running).length}/${plugins.length} plugins active`);
    console.log(`[ST] v${ST_VERSION} ready`);
}

/** Send a message to the in-game chat (only visible to the player). */
function chatMessage(msg) {
    try {
        const chat = qx.core.Init.getApplication().getChat().getChatWidget();
        chat.showMessage(
            `<font color="lightblue">${msg}</font>`,
            webfrontend.gui.chat.ChatWidget.sender.system,
            31
        );
    } catch (e) {
        console.warn('[ST] Chat not available:', msg);
    }
}

// Export for plugins that need it
export { chatMessage };

// Go
startup().catch(err => console.error('[ST] Fatal:', err));
