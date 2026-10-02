/**
 * main.js — entry point for Shockr TA Tools v5.5.0
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
import { initI18n, t, escapeHtml } from './i18n.js';
import { buildHelp, buildHelpPanel } from './help.js';
import { HelpPanel } from './help-panel.js';

// Plugins
import { CampTracker } from '../plugins/camp-tracker.js';
import { KillInfo } from '../plugins/kill-info.js';
import { PlayerStatus } from '../plugins/player-status.js';
import { LayoutScanner } from '../plugins/layout-scanner.js';
import { AllianceScanner } from '../plugins/alliance-scanner.js';
import { RepairGuard } from '../plugins/repair-guard.js';
import { UpgradeCalc } from '../plugins/upgrade-calc.js';
import { TargetWatcher } from '../plugins/target-watcher.js';

const ST_VERSION = '5.5.0';

async function startup() {
    console.log(`[ST] Shockr TA Tools v${ST_VERSION} loading...`);

    // 1. Wait for ClientLib + qooxdoo + player data
    const ready = await waitForGame({ maxAttempts: 200, intervalMs: 100 });
    if (!ready) {
        console.error('[ST] Game client did not load in time — aborting.');
        return;
    }

    // 2. Config first — the language setting applies to every chat message below
    const config = new Config('st-config');
    initI18n(config);

    // 3. Apply ClientLib patches (fingerprint-based)
    const patchResults = applyPatches(PATCHES);
    const failed = patchResults.filter(r => !r.ok);
    if (failed.length > 0) {
        const names = failed.map(r => r.name).join(', ');
        console.warn(`[ST] Patch failures: ${names}`);
        chatMessage(`[ST] ${t('patchFailed', { names })}`);
    }

    // 4. Init core systems
    const cli = new Cli(config);
    const idle = new IdleDetect();
    const api = new ApiClient(config);

    // 5. Register plugins
    const plugins = [
        new CampTracker(config, cli),
        new KillInfo(config, cli),
        new PlayerStatus(),
        new LayoutScanner(config, cli, api, idle),
        new AllianceScanner(config, cli, api, idle),
        new RepairGuard(config),
        new UpgradeCalc(config),
        new TargetWatcher(config, api),
    ];

    // 6. Start enabled plugins
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
            chatMessage(`[ST] ${t('pluginStartFailed', { name: plugin.name, error: err.message })}`);
        }
    }

    // 7. Register CLI commands
    cli.register('plugin', (args) => {
        const [action, name] = args;
        // Accept both 'RepairGuard' and 'repair-guard'
        const norm = (s) => (s || '').toLowerCase().replace(/[-_]/g, '');
        const plugin = plugins.find(p => norm(p.name) === norm(name));
        if (!plugin) {
            chatMessage(`[ST] ${t('unknownPlugin', { names: plugins.map(p => p.name).join(', ') })}`);
            return;
        }
        if (action === 'enable') {
            config.set(`${plugin.name}.enabled`, true);
            if (!plugin.running) plugin.start();
            chatMessage(`[ST] ${t('pluginEnabledMsg', { name: plugin.name })}`);
        } else if (action === 'disable') {
            config.set(`${plugin.name}.enabled`, false);
            if (plugin.running) plugin.stop();
            chatMessage(`[ST] ${t('pluginDisabledMsg', { name: plugin.name })}`);
        } else {
            chatMessage(`[ST] ${escapeHtml(t('pluginUsage'))}`);
        }
    });

    cli.register('status', () => {
        chatMessage(`[ST] ${t('statusHeader', { version: ST_VERSION })}`);
        for (const p of plugins) {
            const extra = typeof p.statusText === 'function' ? ` — ${p.statusText()}` : '';
            chatMessage(`[ST] ${p.name}: ${t(p.running ? 'pluginEnabled' : 'pluginDisabled')}${extra}`);
        }
    });

    cli.register('version', () => {
        chatMessage(`[ST] ${t('versionLine', { version: ST_VERSION })}`);
    });

    // help.popup (default true): popup panel; false: monospace block in the chat
    const helpPanel = new HelpPanel();
    cli.register('help', () => {
        if (config.get('help.popup', true)) {
            helpPanel.toggle(buildHelpPanel(ST_VERSION, plugins, cli.commands));
        } else {
            helpPanel.hide();
            chatMessage(buildHelp(ST_VERSION, plugins, cli.commands));
        }
    });

    cli.start();
    idle.start();
    fixUnload();

    chatMessage(`[ST] ${t('loaded', { version: ST_VERSION, active: plugins.filter(p => p.running).length, total: plugins.length })}`);
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
