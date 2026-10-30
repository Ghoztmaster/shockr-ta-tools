// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * main.js — entry point for Shockr TA Tools v5.30.0
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
import { buildHelp, buildHelpPanel, kebab } from './help.js';
import { HelpPanel } from './help-panel.js';
import { RegisterPanel } from './register-panel.js';
import { exportConfig } from './config-transfer.js';
import { announceUpdateOnce } from './update-check.js';
import { Toolbar, ICONS } from './toolbar.js';
import { PluginManager } from './plugin-manager.js';
import { PluginPanel } from './plugin-panel.js';

// Plugins
import { CampTracker } from '../plugins/camp-tracker.js';
import { KillInfo } from '../plugins/kill-info.js';
import { PlayerStatus } from '../plugins/player-status.js';
import { LayoutScanner } from '../plugins/layout-scanner.js';
import { AllianceScanner } from '../plugins/alliance-scanner.js';
import { RepairGuard } from '../plugins/repair-guard.js';
import { AutoRepair } from '../plugins/auto-repair.js';
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
import { PoiAnalyser } from '../plugins/poi-analyser.js';
import { SectorHud } from '../plugins/sector-hud.js';
import { MovableMenu } from '../plugins/movable-menu.js';
import { TransferAll } from '../plugins/transfer-all.js';
import { LootSummary } from '../plugins/loot-summary.js';
import { ChatHelper } from '../plugins/chat-helper.js';
import { PvpAlert } from '../plugins/pvp-alert.js';
import { TargetBoard } from '../plugins/target-board.js';
import { MarkerNav } from '../plugins/marker-nav.js';
import { TunnelPoiAnalyzer } from '../plugins/tunnel-poi-analyzer.js';
import { SpamBlock } from '../plugins/spam-block.js';
import { Stabs } from '../plugins/stabs.js';

const ST_VERSION = '5.33.0';

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
    // 5.26.0: one shared button + grid for every panel; plugins register in start()
    // 5.28.0: + the Plugins panel (created below, once the plugin list exists)
    let pluginPanel = null;
    const toolbar = new Toolbar(config, {
        onConfig: () => cli.openConfigMenu(),
        onPlugins: () => pluginPanel && pluginPanel.toggle(),
    });

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
        new AutoRepair(config),
        new UpgradeCalc(config, toolbar),
        targetWatcher,
        attackTracker,
        watchList,
        new BaseInfo(config),
        new AttackRange(config),
        new MapLabels(config, api, { targetWatcher, attackTracker }),
        new TunnelInfo(config),
        new FormationSaver(config, cli),
        new Wavy(config),
        new PoiAnalyser(config),
        new SectorHud(config),
        new MovableMenu(config),
        new TransferAll(config),
        new LootSummary(config),
        new ChatHelper(config),
        new PvpAlert(config),
        new TargetBoard(config, api, toolbar, cli),
        new MarkerNav(config, toolbar, cli),
        new TunnelPoiAnalyzer(config, toolbar, cli),
        new SpamBlock(config, toolbar, cli),
        new Stabs(config, toolbar),
    ];

    // 6. Start enabled plugins. TargetWatcher's default went from off to on in 5.12.1:
    // existing installs keep it off unless the player turned it on.
    config.pinChangedDefaults(plugins, { TargetWatcher: false });
    const manager = new PluginManager(config, plugins, chatMessage);
    manager.resolveConflicts();          // AutoRepair <-> RepairGuard: both stored on -> RepairGuard wins
    for (const plugin of plugins) {
        if (!manager.isEnabled(plugin)) {
            console.log(`[ST] ${plugin.name}: disabled`);
            continue;
        }
        if (await manager.start(plugin)) console.log(`[ST] ${plugin.name}: started`);
    }
    pluginPanel = new PluginPanel(manager, () => toolbar.anchorRect());

    // 7. Register CLI commands
    const unknownPlugin = () => chatMessage(`[ST] ${t('unknownPlugin', { names: manager.offered().map(p => p.name).join(', ') })}`);
    cli.register('plugin', async (args) => {
        const [action, name] = args;
        if (action === 'list') {
            // hyphenated names, as /st help and `plugin enable|disable` show them
            for (const p of plugins) {
                chatMessage(`[ST] ${kebab(p.name)}: ${t(p.running ? 'pluginEnabled' : 'pluginDisabled')}`);
            }
            return;
        }
        if (action !== 'enable' && action !== 'disable') {
            chatMessage(`[ST] ${escapeHtml(t('pluginUsage'))}`);
            return;
        }
        const plugin = manager.find(name);
        if (!plugin) {
            unknownPlugin();
            return;
        }
        await manager.setEnabled(plugin, action === 'enable');
        pluginPanel.render();
    });

    // 5.28.0: which plugins the Plugins panel shows (the panel's gear does the same)
    cli.register('menu', (args) => {
        const [action, name] = args;
        if (action !== 'add' && action !== 'remove') {
            chatMessage(`[ST] ${escapeHtml(t('menuUsage'))}`);
            return;
        }
        const plugin = manager.find(name);
        if (!plugin || plugin.parked) {
            unknownPlugin();
            return;
        }
        manager.setInMenu(plugin, action === 'add');
        chatMessage(`[ST] ${t(action === 'add' ? 'menuAdded' : 'menuRemoved', { name: plugin.name })}`);
        pluginPanel.render();
    });

    cli.register('status', () => {
        chatMessage(`[ST] ${t('statusHeader', { version: ST_VERSION })}`);
        for (const p of plugins) {
            // statusState(): a plugin that is on but idle says so instead of "on" (STABS next to TABS)
            const state = (typeof p.statusState === 'function' && p.statusState()) || t(p.running ? 'pluginEnabled' : 'pluginDisabled');
            const extra = typeof p.statusText === 'function' ? ` — ${p.statusText()}` : '';
            chatMessage(`[ST] ${p.name}: ${state}${extra}`);
        }
        const reg = { player: 'registerStatusOn', shared: 'registerStatusShared', none: 'registerStatusOff' };
        chatMessage(`[ST] ${t(reg[api.registration])}`);
        const pause = { paused: 'scannerPausePaused', active: 'scannerPauseActive', unknown: 'scannerPauseUnknown', stopped: 'scannerPauseStopped' };
        chatMessage(`[ST] ${t(pause[online.describe()])}`);
    });

    // Enrollment: personal API key via the enrollment code from the alliance chat.
    // 5.25.0: "I still have my key" restores a key from an export (nothing new issued),
    // and every success shows the /st config export text as a backup.
    const registerPanel = new RegisterPanel(async (code, replace) => {
        const result = await api.enroll(code, replace);
        if (result.ok) chatMessage(`[ST] ${t('registerSuccessChat')}`);
        return result;
    }, {
        onRestore: async (key) => {
            const result = await api.restoreKey(key);
            if (result.ok) chatMessage(`[ST] ${t('registerRestoredChat')}`);
            return result;
        },
        getExport: () => exportConfig(config.data),
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
    // the toolbar always opens the popup (help.popup only concerns /st help)
    toolbar.register({
        id: 'help',
        icon: ICONS.help,
        label: () => t('toolbarHelp'),
        onClick: () => helpPanel.toggle(buildHelpPanel(ST_VERSION, plugins, cli.commands)),
    });
    toolbar.start();

    cli.start();
    idle.start();
    fixUnload();

    chatMessage(`[ST] ${t('loaded', { version: ST_VERSION, active: plugins.filter(p => p.running).length, total: plugins.length })}`);
    console.log(`[ST] v${ST_VERSION} ready`);

    // 8. 5.25.0: config wiped (script re-created via Tampermonkey "Import") -> tell the
    // player in the chat too (config.js already logged the console line)
    if (config.configLost) chatMessage(`[ST] ${t('configLost')}`);

    // 9. 5.25.0: one notice when the server knows a newer version. Uses the same
    // server as the plugins (api._url: api.url, or the default); silent on any failure.
    announceUpdateOnce({
        url: api._url,
        current: ST_VERSION,
        notify: (version) => chatMessage(`[ST] ${t('updateAvailable', { version })}`),
    }).catch(() => { /* informational only */ });
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
