/**
 * i18n.js — user-facing texts in English, German and Dutch.
 *
 * Language: `/st config set language en|de|nl` (default en). t() reads the
 * config on every call, so a switch applies to the next message/render
 * without a reload. Missing keys fall back to English, then to the key.
 *
 * Only for what the player sees (chat, panels, /st output) — console logs
 * stay English. Game data (building/unit names) comes from the client.
 *
 * Strings are plain text; callers that put user input or <...> placeholders
 * into chat HTML escape them (escapeHtml).
 */

export const LANGUAGES = ['en', 'de', 'nl'];
const DEFAULT_LANGUAGE = 'en';

const STRINGS = {
    en: {
        // ── Core ──
        loaded: 'v{version} loaded — {active}/{total} plugins active',
        patchFailed: '⚠ Patch failed: {names} — some features may not work. Check for a script update.',
        pluginStartFailed: '⚠ {name} failed to start: {error}',
        unknownPlugin: 'Unknown plugin. Available: {names}',
        pluginEnabledMsg: '{name} enabled',
        pluginDisabledMsg: '{name} disabled',
        pluginUsage: 'Usage: /st plugin enable|disable <name>',
        statusHeader: 'Shockr Tools v{version} — status',
        pluginEnabled: 'on',
        pluginDisabled: 'off',
        versionLine: 'Shockr TA Tools v{version}',

        // ── CLI ──
        noConfig: 'No config set',
        configUsage: 'Usage: /st config set|get|list <key> [value]',
        commandError: 'Error: {error}',
        unknownCommand: 'Unknown command: {cmd}. Type /st help',

        // ── Help ──
        helpHeader: 'Shockr Tools v{version} — Commands',
        helpPlugins: 'Plugins',
        helpEnable: 'Enable a plugin',
        helpDisable: 'Disable a plugin',
        helpAvailablePlugins: 'Available plugins:',
        helpTools: 'Tools',
        helpCmdPlunder: 'Toggle plunder panel',
        helpCmdScan: 'Scan nearby FG bases now',
        helpCmdScanAlliance: 'Scan alliance bases now',
        helpSettings: 'Settings',
        helpConfigSet: 'Change a setting',
        helpConfigGet: 'Show a setting',
        helpConfigList: 'Show all settings',
        helpStatus: 'Show plugin status',
        helpVersion: 'Show script version',
        helpUsefulSettings: 'Useful settings:',
        helpSetLanguage: 'en / de / nl (default: en)',
        helpSetApiUrl: 'Server URL for scanners/watcher',
        helpSetApiKey: 'Alliance API key',
        helpSetButtonLeft: 'UC button X position (px)',
        helpSetButtonTop: 'UC button Y position (px)',
        helpHelp: 'This message',
        helpCloseHint: 'Press Escape, click ✕ or type /st help again to close. Show help in the chat instead: /st config set help.popup false',

        // ── Plugin descriptions ──
        descCampTracker: 'FG base markers on world map',
        descKillInfo: 'Plunder panel for the selected FG base',
        descPlayerStatus: 'Alliance base colors by online status',
        descLayoutScanner: 'Scan FG base layouts',
        descAllianceScanner: 'Scan alliance base layouts',
        descRepairGuard: 'Block Repair All buttons',
        descUpgradeCalc: 'Building upgrade cost & time panel',
        descTargetWatcher: 'Report viewed targets to alliance server',

        // ── Shared ──
        close: 'Close',
        apiKeyRejected: '⚠ API key rejected — check /st config set api.key',
        notAMember: '⚠️ Server: not recognized — scan a base first to register.',
        scansFailed: '⚠ {count} scan(s) failed to send',

        // ── CampTracker ──
        campSpawned: '{time}: New L{level} {type} spawned at {coord}',
        campTypeCamp: 'Camp',
        campTypeOutpost: 'Outpost',
        markerTitle: 'Object #{id}',

        // ── KillInfo ──
        plunderSelectFirst: 'Select a Forgotten base first',
        plunderChat: 'Plunder: {name} Lvl {level} — Tib {tib}, Crystal {cry}',
        plunderTitle: 'Plunder',
        plunderUnit: 'Unit',
        plunderLevel: 'Lv',
        plunderTib: 'Tib',
        plunderCrystal: 'Crystal',
        plunderTotal: 'Total',

        // ── LayoutScanner ──
        scanNotConfigured: 'Scanner not configured. Set api.url and api.key first.',
        scanInProgress: 'Scan already in progress...',
        scanManualStarted: 'Manual scan started...',
        scanNoServer: 'LayoutScanner enabled but no server configured. Set api.url and api.key first.',
        scanConsent: '⚠ LayoutScanner sends base layouts to an external server ({url}). This includes base positions, units, and buildings of FG camps/outposts/bases near you. Disable with /st plugin disable LayoutScanner',
        scanComplete: 'Scan complete: {scanned} base(s) sent, {skipped} skipped ({duration}s)',
        scanFailed: '⚠ Scan failed: {error}',

        // ── AllianceScanner ──
        allianceScanNotConfigured: 'Alliance scan not configured. Set api.url and api.key first.',
        allianceScanInProgress: 'Alliance scan already in progress...',
        allianceScanLocked: '{holder} is scanning — try again when it is done.',
        allianceScanStarted: 'Alliance scan started...',
        allianceScanComplete: 'Alliance scan complete: {scanned} base(s) sent, {skipped} skipped ({duration}s)',
        allianceScanFailed: '⚠ Alliance scan failed: {error}',

        // ── RepairGuard ──
        repairGuardEnabled: 'Repair Guard active — Repair All blocked',
        repairGuardBlocked: 'Repair Guard: Repair All blocked — repair per unit or /st plugin disable repair-guard',
        repairGuardStatusOff: 'Repair All allowed',
        repairGuardStatusOn: 'Repair All blocked ({count} patches)',

        // ── UpgradeCalc ──
        upgradeCalcTitle: 'Upgrades',
        upgradeCalcError: 'Upgrade Calculator: error — {error}',
        upgradeCalcPerHour: '/h',
        upgradeCalcAllMax: 'All buildings at max level',
        upgradeCalcBuilding: 'Building',
        upgradeCalcLevel: 'Level',
        upgradeCalcTib: 'Tib',
        upgradeCalcPower: 'Power',
        upgradeCalcTime: 'Time',
        upgradeCalcReady: 'Ready',
        upgradeCalcHours: '{h}h {m}m',
        upgradeCalcStatusButton: 'button in base view',
        upgradeCalcStatusOpen: 'button in base view, panel open',

        // ── TargetWatcher ──
        targetWatcherNoServer: 'TargetWatcher enabled but no server configured. Set api.url and api.key first.',
        targetWatcherWarning: '⚠️ {player} is also viewing {target}{since}',
        targetWatcherWarningMulti: '⚠️ {players} are also viewing {target}',
        targetWatcherSinceNow: ' (just now)',
        targetWatcherSince: ' (since {min} min)',
        targetWatcherStatusNoServer: 'no server configured (api.url / api.key)',
        targetWatcherStatusWatching: 'viewing {target} ({x}:{y}), {count} report(s) sent',
        targetWatcherStatusIdle: 'no target in view, {count} report(s) sent',
    },

    de: {
        loaded: 'v{version} geladen — {active}/{total} Plugins aktiv',
        patchFailed: '⚠ Patch fehlgeschlagen: {names} — einige Funktionen gehen evtl. nicht. Prüfe auf ein Script-Update.',
        pluginStartFailed: '⚠ {name} konnte nicht starten: {error}',
        unknownPlugin: 'Unbekanntes Plugin. Verfügbar: {names}',
        pluginEnabledMsg: '{name} aktiviert',
        pluginDisabledMsg: '{name} deaktiviert',
        pluginUsage: 'Verwendung: /st plugin enable|disable <name>',
        statusHeader: 'Shockr Tools v{version} — Status',
        pluginEnabled: 'an',
        pluginDisabled: 'aus',
        versionLine: 'Shockr TA Tools v{version}',

        noConfig: 'Keine Einstellungen gesetzt',
        configUsage: 'Verwendung: /st config set|get|list <key> [value]',
        commandError: 'Fehler: {error}',
        unknownCommand: 'Unbekannter Befehl: {cmd}. Tippe /st help',

        helpHeader: 'Shockr Tools v{version} — Befehle',
        helpPlugins: 'Plugins',
        helpEnable: 'Plugin aktivieren',
        helpDisable: 'Plugin deaktivieren',
        helpAvailablePlugins: 'Verfügbare Plugins:',
        helpTools: 'Werkzeuge',
        helpCmdPlunder: 'Plünder-Panel ein/aus',
        helpCmdScan: 'FG-Basen in der Nähe jetzt scannen',
        helpCmdScanAlliance: 'Allianz-Basen jetzt scannen',
        helpSettings: 'Einstellungen',
        helpConfigSet: 'Einstellung ändern',
        helpConfigGet: 'Einstellung anzeigen',
        helpConfigList: 'Alle Einstellungen anzeigen',
        helpStatus: 'Plugin-Status anzeigen',
        helpVersion: 'Script-Version anzeigen',
        helpUsefulSettings: 'Nützliche Einstellungen:',
        helpSetLanguage: 'en / de / nl (Standard: en)',
        helpSetApiUrl: 'Server-URL für Scanner/Watcher',
        helpSetApiKey: 'Allianz-API-Key',
        helpSetButtonLeft: 'UC-Button X-Position (px)',
        helpSetButtonTop: 'UC-Button Y-Position (px)',
        helpHelp: 'Diese Hilfe',
        helpCloseHint: 'Schließen mit Escape, ✕ oder erneut /st help. Hilfe stattdessen im Chat: /st config set help.popup false',

        descCampTracker: 'FG-Basis-Markierungen auf der Weltkarte',
        descKillInfo: 'Plünder-Panel für die gewählte FG-Basis',
        descPlayerStatus: 'Allianz-Basisfarben nach Online-Status',
        descLayoutScanner: 'FG-Basis-Layouts scannen',
        descAllianceScanner: 'Allianz-Basis-Layouts scannen',
        descRepairGuard: 'Repair-All-Buttons blockieren',
        descUpgradeCalc: 'Panel mit Upgrade-Kosten & -Dauer der Gebäude',
        descTargetWatcher: 'Angesehene Ziele an den Allianz-Server melden',

        close: 'Schließen',
        apiKeyRejected: '⚠ API-Key abgelehnt — prüfe /st config set api.key',
        notAMember: '⚠️ Server: nicht erkannt — scanne zuerst eine Basis, um dich zu registrieren.',
        scansFailed: '⚠ {count} Scan(s) konnten nicht gesendet werden',

        campSpawned: '{time}: Neues L{level} {type} erschienen bei {coord}',
        campTypeCamp: 'Camp',
        campTypeOutpost: 'Outpost',
        markerTitle: 'Objekt #{id}',

        plunderSelectFirst: 'Wähle zuerst eine Forgotten-Basis',
        plunderChat: 'Beute: {name} Lvl {level} — Tib {tib}, Kristall {cry}',
        plunderTitle: 'Beute',
        plunderUnit: 'Einheit',
        plunderLevel: 'Lv',
        plunderTib: 'Tib',
        plunderCrystal: 'Kristall',
        plunderTotal: 'Gesamt',

        scanNotConfigured: 'Scanner nicht eingerichtet. Setze zuerst api.url und api.key.',
        scanInProgress: 'Scan läuft bereits...',
        scanManualStarted: 'Manueller Scan gestartet...',
        scanNoServer: 'LayoutScanner aktiv, aber kein Server eingerichtet. Setze zuerst api.url und api.key.',
        scanConsent: '⚠ LayoutScanner sendet Basis-Layouts an einen externen Server ({url}). Das umfasst Positionen, Einheiten und Gebäude von FG-Camps/-Outposts/-Basen in deiner Nähe. Deaktivieren mit /st plugin disable LayoutScanner',
        scanComplete: 'Scan fertig: {scanned} Basis/Basen gesendet, {skipped} übersprungen ({duration}s)',
        scanFailed: '⚠ Scan fehlgeschlagen: {error}',

        allianceScanNotConfigured: 'Allianz-Scan nicht eingerichtet. Setze zuerst api.url und api.key.',
        allianceScanInProgress: 'Allianz-Scan läuft bereits...',
        allianceScanLocked: '{holder} scannt gerade — versuche es danach erneut.',
        allianceScanStarted: 'Allianz-Scan gestartet...',
        allianceScanComplete: 'Allianz-Scan fertig: {scanned} Basis/Basen gesendet, {skipped} übersprungen ({duration}s)',
        allianceScanFailed: '⚠ Allianz-Scan fehlgeschlagen: {error}',

        repairGuardEnabled: 'Repair Guard aktiv — Repair All blockiert',
        repairGuardBlocked: 'Repair Guard: Repair All blockiert — einzeln reparieren oder /st plugin disable repair-guard',
        repairGuardStatusOff: 'Repair All erlaubt',
        repairGuardStatusOn: 'Repair All blockiert ({count} Patches)',

        upgradeCalcTitle: 'Upgrades',
        upgradeCalcError: 'Upgrade Calculator: Fehler — {error}',
        upgradeCalcPerHour: '/h',
        upgradeCalcAllMax: 'Alle Gebäude auf Max-Level',
        upgradeCalcBuilding: 'Gebäude',
        upgradeCalcLevel: 'Level',
        upgradeCalcTib: 'Tib',
        upgradeCalcPower: 'Strom',
        upgradeCalcTime: 'Zeit',
        upgradeCalcReady: 'Bereit',
        upgradeCalcHours: '{h}h {m}m',
        upgradeCalcStatusButton: 'Button in der Basis-Ansicht',
        upgradeCalcStatusOpen: 'Button in der Basis-Ansicht, Panel offen',

        targetWatcherNoServer: 'TargetWatcher aktiv, aber kein Server eingerichtet. Setze zuerst api.url und api.key.',
        targetWatcherWarning: '⚠️ {player} schaut sich auch {target} an{since}',
        targetWatcherWarningMulti: '⚠️ {players} schauen sich auch {target} an',
        targetWatcherSinceNow: ' (gerade eben)',
        targetWatcherSince: ' (seit {min} Min.)',
        targetWatcherStatusNoServer: 'kein Server eingerichtet (api.url / api.key)',
        targetWatcherStatusWatching: 'schaut {target} ({x}:{y}) an, {count} Meldung(en) gesendet',
        targetWatcherStatusIdle: 'kein Ziel im Blick, {count} Meldung(en) gesendet',
    },

    nl: {
        loaded: 'v{version} geladen — {active}/{total} plugins actief',
        patchFailed: '⚠ Patch mislukt: {names} — sommige functies werken mogelijk niet. Kijk of er een script-update is.',
        pluginStartFailed: '⚠ {name} kon niet starten: {error}',
        unknownPlugin: 'Onbekende plugin. Beschikbaar: {names}',
        pluginEnabledMsg: '{name} aangezet',
        pluginDisabledMsg: '{name} uitgezet',
        pluginUsage: 'Gebruik: /st plugin enable|disable <naam>',
        statusHeader: 'Shockr Tools v{version} — status',
        pluginEnabled: 'aan',
        pluginDisabled: 'uit',
        versionLine: 'Shockr TA Tools v{version}',

        noConfig: 'Geen instellingen gezet',
        configUsage: 'Gebruik: /st config set|get|list <key> [waarde]',
        commandError: 'Fout: {error}',
        unknownCommand: 'Onbekend commando: {cmd}. Typ /st help',

        helpHeader: 'Shockr Tools v{version} — Commando\'s',
        helpPlugins: 'Plugins',
        helpEnable: 'Plugin aanzetten',
        helpDisable: 'Plugin uitzetten',
        helpAvailablePlugins: 'Beschikbare plugins:',
        helpTools: 'Tools',
        helpCmdPlunder: 'Plunder-paneel aan/uit',
        helpCmdScan: 'FG-bases in de buurt nu scannen',
        helpCmdScanAlliance: 'Alliance-bases nu scannen',
        helpSettings: 'Instellingen',
        helpConfigSet: 'Instelling wijzigen',
        helpConfigGet: 'Instelling tonen',
        helpConfigList: 'Alle instellingen tonen',
        helpStatus: 'Plugin-status tonen',
        helpVersion: 'Script-versie tonen',
        helpUsefulSettings: 'Handige instellingen:',
        helpSetLanguage: 'en / de / nl (standaard: en)',
        helpSetApiUrl: 'Server-URL voor scanners/watcher',
        helpSetApiKey: 'Alliance-API-key',
        helpSetButtonLeft: 'UC-knop X-positie (px)',
        helpSetButtonTop: 'UC-knop Y-positie (px)',
        helpHelp: 'Dit bericht',
        helpCloseHint: 'Sluiten met Escape, ✕ of nogmaals /st help. Help liever in de chat: /st config set help.popup false',

        descCampTracker: 'FG-base-markeringen op de wereldkaart',
        descKillInfo: 'Plunder-paneel voor de geselecteerde FG-base',
        descPlayerStatus: 'Alliance-basekleuren op online-status',
        descLayoutScanner: 'FG-base-layouts scannen',
        descAllianceScanner: 'Alliance-base-layouts scannen',
        descRepairGuard: 'Repair All-knoppen blokkeren',
        descUpgradeCalc: 'Paneel met upgrade-kosten & -tijd van gebouwen',
        descTargetWatcher: 'Bekeken targets melden aan de alliance-server',

        close: 'Sluiten',
        apiKeyRejected: '⚠ API-key geweigerd — controleer /st config set api.key',
        notAMember: '⚠️ Server: niet herkend — scan eerst een base om je te registreren.',
        scansFailed: '⚠ {count} scan(s) konden niet verstuurd worden',

        campSpawned: '{time}: Nieuw L{level} {type} verschenen op {coord}',
        campTypeCamp: 'Camp',
        campTypeOutpost: 'Outpost',
        markerTitle: 'Object #{id}',

        plunderSelectFirst: 'Selecteer eerst een Forgotten-base',
        plunderChat: 'Buit: {name} Lvl {level} — Tib {tib}, Crystal {cry}',
        plunderTitle: 'Buit',
        plunderUnit: 'Unit',
        plunderLevel: 'Lv',
        plunderTib: 'Tib',
        plunderCrystal: 'Crystal',
        plunderTotal: 'Totaal',

        scanNotConfigured: 'Scanner niet ingesteld. Zet eerst api.url en api.key.',
        scanInProgress: 'Scan loopt al...',
        scanManualStarted: 'Handmatige scan gestart...',
        scanNoServer: 'LayoutScanner aan, maar geen server ingesteld. Zet eerst api.url en api.key.',
        scanConsent: '⚠ LayoutScanner stuurt base-layouts naar een externe server ({url}). Dit omvat posities, units en gebouwen van FG-camps/-outposts/-bases bij jou in de buurt. Uitzetten met /st plugin disable LayoutScanner',
        scanComplete: 'Scan klaar: {scanned} base(s) verstuurd, {skipped} overgeslagen ({duration}s)',
        scanFailed: '⚠ Scan mislukt: {error}',

        allianceScanNotConfigured: 'Alliance-scan niet ingesteld. Zet eerst api.url en api.key.',
        allianceScanInProgress: 'Alliance-scan loopt al...',
        allianceScanLocked: '{holder} is aan het scannen — probeer het daarna opnieuw.',
        allianceScanStarted: 'Alliance-scan gestart...',
        allianceScanComplete: 'Alliance-scan klaar: {scanned} base(s) verstuurd, {skipped} overgeslagen ({duration}s)',
        allianceScanFailed: '⚠ Alliance-scan mislukt: {error}',

        repairGuardEnabled: 'Repair Guard actief — Repair All geblokkeerd',
        repairGuardBlocked: 'Repair Guard: Repair All geblokkeerd — repareer per unit of /st plugin disable repair-guard',
        repairGuardStatusOff: 'Repair All toegestaan',
        repairGuardStatusOn: 'Repair All geblokkeerd ({count} patches)',

        upgradeCalcTitle: 'Upgrades',
        upgradeCalcError: 'Upgrade Calculator: fout — {error}',
        upgradeCalcPerHour: '/u',
        upgradeCalcAllMax: 'Alle gebouwen op max-level',
        upgradeCalcBuilding: 'Gebouw',
        upgradeCalcLevel: 'Level',
        upgradeCalcTib: 'Tib',
        upgradeCalcPower: 'Power',
        upgradeCalcTime: 'Tijd',
        upgradeCalcReady: 'Gereed',
        upgradeCalcHours: '{h}u {m}m',
        upgradeCalcStatusButton: 'knop in base-view',
        upgradeCalcStatusOpen: 'knop in base-view, paneel open',

        targetWatcherNoServer: 'TargetWatcher aan, maar geen server ingesteld. Zet eerst api.url en api.key.',
        targetWatcherWarning: '⚠️ {player} kijkt ook naar {target}{since}',
        targetWatcherWarningMulti: '⚠️ {players} kijken ook naar {target}',
        targetWatcherSinceNow: ' (net)',
        targetWatcherSince: ' (sinds {min} min)',
        targetWatcherStatusNoServer: 'geen server ingesteld (api.url / api.key)',
        targetWatcherStatusWatching: 'kijkt naar {target} ({x}:{y}), {count} melding(en) verstuurd',
        targetWatcherStatusIdle: 'geen target in beeld, {count} melding(en) verstuurd',
    },
};

let _config = null;

/** Hook up the config so t() follows `/st config set language`. */
export function initI18n(config) {
    _config = config;
}

/** Active language code; unknown values fall back to English. */
export function getLanguage() {
    const lang = String(_config ? _config.get('language', DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE).toLowerCase();
    return LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * Translated string for `key` with {placeholder} substitution.
 * @param {string} key
 * @param {object} [vars]
 */
export function t(key, vars) {
    const table = STRINGS[getLanguage()];
    let str = table[key] !== undefined ? table[key] : STRINGS[DEFAULT_LANGUAGE][key];
    if (str === undefined) return key;
    if (vars) {
        str = str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
    }
    return str;
}

/** Escape text for the chat/panel HTML. */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
