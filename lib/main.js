/**
 * main.js — entry point for Shockr TA Tools v5.15.0
 *
 * Waits for the game client to load, applies ClientLib patches,
 * then starts all enabled plugins.
 */
import { waitForGame } from './game-ready.js';
import { applyPatches, PATCHES } from './clientlib-patch.js';
import { Config } from './config.js';
import { Cli } from './cli.js';
import { IdleDetect } from './idle-detect.js';
import { OnlineStateWatch } from './online-state.js';
import { ApiClient } from './api-client.js';
import { fixUnload } from './bugfix.js';
import { initI18n, t, escapeHtml } from './i18n.js';
import { buildHelp, buildHelpPanel } from './help.js';
import { HelpPanel } from './help-panel.js';
import { RegisterPanel } from './register-panel.js';

// Plugins
import { CampTracker } from '../plugins/camp-tracker.js';
import { KillInfo } from '../plugins/kill-info.js';
import { PlayerStatus } from '../plugins/player-status.js';
import { LayoutScanner } from '../plugins/layout-scanner.js';
import { AllianceScanner } from '../plugins/alliance-scanner.js';
import { RepairGuard } from '../plugins/repair-guard.js';
import { UpgradeCalc } from '../plugins/upgrade-calc.js';
import { TargetWatcher } from '../plugins/target-watcher.js';
import { AttackTracker } from '../plugins/attack-tracker.js';
import { WatchList } from '../plugins/watchlist.js';
import { BaseInfo } from '../plugins/base-info.js';
import { AttackRange } from '../plugins/attack-range.js';
import { MapLabels } from '../plugins/map-labels.js';
import { TunnelInfo } from '../plugins/tunnel-info.js';
import { FormationSaver } from '../plugins/formation-saver.js';
import { Wavy } from '../plugins/wavy.js';

const ST_VERSION = '5.15.0';

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
    const online = new OnlineStateWatch();
    const api = new ApiClient(config);
    // 5.12.1: the scanner pause also holds the scan send queue; buffered scans go out on resume
    api.setSendGate(() => online.isPaused);
    online.on('resume', () => api.resumeQueue());
    // 5.13.0: start the online watch before any plugin, so the first check has run before a
    // scanner can start and nothing later in startup can leave it unstarted (never paused)
    online.start();

    // 5. Register plugins
    const attackTracker = new AttackTracker(config, api);
    const watchList = new WatchList(config, cli, api);
    const targetWatcher = new TargetWatcher(config, api);
    attackTracker.onUnclaimed = (claim) => watchList.notifyDefeated(claim);
    const plugins = [
        new CampTracker(config, cli),
        new KillInfo(config, cli),
        new PlayerStatus(config, cli),
        new LayoutScanner(config, cli, api, idle, online),
        new AllianceScanner(config, cli, api, idle, online),
        new RepairGuard(config),
        new UpgradeCalc(config),
        targetWatcher,
        attackTracker,
        watchList,
        new BaseInfo(config),
        new AttackRange(config),
        new MapLabels(config, api, { targetWatcher, attackTracker }),
        new TunnelInfo(config),
        new FormationSaver(config, cli),
        new Wavy(config),
    ];

    // 6. Start enabled plugins. TargetWatcher's default went from off to on in 5.12.1:
    // existing installs keep it off unless the player turned it on.
    config.pinChangedDefaults(plugins, { TargetWatcher: false });
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
        const reg = { player: 'registerStatusOn', shared: 'registerStatusShared', none: 'registerStatusOff' };
        chatMessage(`[ST] ${t(reg[api.registration])}`);
        const pause = { paused: 'scannerPausePaused', active: 'scannerPauseActive', unknown: 'scannerPauseUnknown', stopped: 'scannerPauseStopped' };
        chatMessage(`[ST] ${t(pause[online.describe()])}`);
    });

    // Enrollment: personal API key via the enrollment code from the alliance chat
    const registerPanel = new RegisterPanel(async (code) => {
        const result = await api.enroll(code);
        if (result.ok) chatMessage(`[ST] ${t('registerSuccessChat')}`);
        return result;
    });
    cli.register('register', () => registerPanel.open());

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
