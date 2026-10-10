// ==UserScript==
// @name            Shockr - Tiberium Alliances Tools
// @author          Ghozt [SoO] (original: Shockr, fixed by NetquiK [SoO])
// @description     Camp tracker, kill info, player status, alliance recon, upgrade calculator, target watcher & attack tracker for C&C Tiberium Alliances
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @grant           none
// @version         5.10.0
// @homepage        https://github.com/Ghoztmaster/shockr-ta-tools
// ==/UserScript==

var ShockrTools = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/main.js
  var main_exports = {};
  __export(main_exports, {
    chatMessage: () => chatMessage
  });

  // lib/game-ready.js
  async function waitForGame({ maxAttempts = 200, intervalMs = 100 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      if (isGameReady()) return true;
      await sleep(intervalMs);
    }
    return false;
  }
  function isGameReady() {
    try {
      if (typeof ClientLib === "undefined") return false;
      if (typeof qx === "undefined") return false;
      const app = qx.core.Init.getApplication();
      if (!app) return false;
      if (!app.getMenuBar()) return false;
      const md = ClientLib.Data.MainData.GetInstance();
      if (!md) return false;
      const player = md.get_Player();
      if (!player || !player.name) return false;
      return true;
    } catch {
      return false;
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // lib/clientlib-patch.js
  function findInFunction(proto, funcName, patterns, matchGroup = 1) {
    const func = proto[funcName];
    if (typeof func !== "function") return null;
    const src = func.toString();
    for (const re of patterns) {
      const m = src.match(re);
      if (m && m[matchGroup]) return m[matchGroup];
    }
    return null;
  }
  function findFunctionByContent(proto, searchFor) {
    for (const name of Object.keys(proto)) {
      if (typeof proto[name] !== "function") continue;
      const src = proto[name].toString();
      if (src.includes(searchFor)) return { name, src };
    }
    return null;
  }
  function defineGetter(proto, publicName, obfuscatedName) {
    if (typeof proto[publicName] !== "undefined") return;
    Object.defineProperty(proto, publicName, {
      configurable: true,
      get() {
        return this[obfuscatedName];
      }
    });
  }
  function applyPatches(patches) {
    return patches.map((patch) => {
      const result = { name: patch.name, ok: true, failed: [], matched: {} };
      let proto;
      try {
        proto = patch.getProto();
      } catch (err) {
        return { name: patch.name, ok: false, error: `prototype not found: ${err.message}` };
      }
      for (const prop of patch.properties) {
        if (prop.resolver) {
          try {
            const resolved = prop.resolver(proto);
            if (resolved !== false) {
              result.matched[prop.publicName] = resolved || "(custom)";
            } else {
              result.ok = false;
              result.failed.push(prop.publicName);
            }
          } catch {
            result.ok = false;
            result.failed.push(prop.publicName);
          }
        } else {
          const obfName = findInFunction(
            proto,
            prop.funcName || "$ctor",
            prop.patterns,
            prop.matchGroup || 1
          );
          if (obfName) {
            defineGetter(proto, prop.publicName, obfName);
            result.matched[prop.publicName] = obfName;
          } else {
            result.ok = false;
            result.failed.push(prop.publicName);
          }
        }
      }
      return result;
    });
  }
  var PATCHES = [
    {
      name: "WorldObjectNPCCamp",
      getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCCamp.prototype,
      properties: [
        {
          publicName: "$CampType",
          funcName: "$ctor",
          patterns: [
            // 2026-09: this.TBDAVQ=e>>22&$I.YKSGFB.Event
            /this\.([A-Z]{6})=e>>22&/,
            // older: this.XXXX=(*e*>>(22|0x16))
            /this\.([A-Z]{6})=\(*[a-z]\>?>>(22|0x16)\)?/
          ]
        },
        {
          publicName: "$Level",
          funcName: "$ctor",
          patterns: [
            // 2026-09: this.PSHQNJ=Math.floor(Math.floor(this.NXRIFD+.5))
            /this\.([A-Z]{6})=Math\.floor\(Math\.floor\(/,
            // older: this.XXXX=(((e>>4...
            /this\.([A-Z]{6})=\(\(?\(?[a-z]>>>?4/
          ]
        },
        {
          publicName: "$Id",
          funcName: "$ctor",
          patterns: [
            // 2026-09: first unconditional JTCQOG after conditionals
            // o&&(...),this.YQTCJB=(u.$r=
            /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
            // older: &.*=-1,}?this.XXXX=(
            /\&.*=-1[,;]\}?this\.([A-Z]{6})=\(/
          ]
        }
      ]
    },
    {
      name: "WorldObjectNPCBase",
      getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCBase.prototype,
      properties: [
        {
          publicName: "$Level",
          funcName: "$ctor",
          patterns: [
            // 2026-09: this.YPKZKK=Math.floor(Math.floor(this.HUTUEI+.5))
            /this\.([A-Z]{6})=Math\.floor\(Math\.floor\(/,
            /this\.([A-Z]{6})=\(\(?\(?[a-z]>>>?4/
          ]
        },
        {
          publicName: "$Id",
          funcName: "$ctor",
          patterns: [
            // 2026-09: first unconditional JTCQOG — this.NZFAHM=(u.$r=
            /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
            /.*[a-z][;,]this\.([A-Z]{6})=\(/
          ]
        }
      ]
    },
    {
      name: "WorldObjectCity",
      getProto: () => ClientLib.Data.WorldSector.WorldObjectCity.prototype,
      properties: [
        {
          publicName: "$PlayerId",
          funcName: "$ctor",
          patterns: [
            // 2026-09: this.PMHSXF=e>>22&1023
            /this\.([A-Z]{6})=e>>22&(?:1023|0x3ff)/,
            // older: &(0x3ff|1023))?;this.XXXX
            /&(?:0x3ff|1023)\)?[;,]this\.([A-Z]{6})/
          ]
        },
        {
          publicName: "$AllianceId",
          funcName: "$ctor",
          patterns: [
            // 2026-09: this.YMHXCE=t.KZYIAU(this.PMHSXF)
            // AllianceId is always a method call on the result of PlayerId
            /this\.([A-Z]{6})=t\.[A-Z]{6}\(this\.[A-Z]{6}\)/,
            /.*[a-z]\+=[a-z][;,,]?this\.([A-Z]{6})=\(/
          ]
        },
        {
          publicName: "$Id",
          funcName: "$ctor",
          patterns: [
            // 2026-09: first unconditional JTCQOG
            /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
            /.*[a-z]\+=[a-z][;,]this\.([A-Z]{6})=\(.*[a-z]\+=[a-z].*[a-z]\+=/
          ]
        }
      ]
    },
    {
      name: "CityUnits",
      getProto: () => ClientLib.Data.CityUnits.prototype,
      properties: [
        {
          publicName: "$OffenseUnits",
          funcName: "HasUnitMdbId",
          patterns: [
            // 2026-09: for(t in{d:this.TBXDNO}...for(i in{d:this.IPEJRQ}
            /\{d:this\.([A-Z]{6})\}\.d\.d\).*\{d:this\.([A-Z]{6})\}/,
            // older: for(.+a:this.XXXX...a:this.YYYY
            /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/
          ],
          matchGroup: 1
          // first collection = offense
        },
        {
          publicName: "$DefenseUnits",
          funcName: "HasUnitMdbId",
          patterns: [
            // same regex, second capture group
            /\{d:this\.([A-Z]{6})\}\.d\.d\).*\{d:this\.([A-Z]{6})\}/,
            /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/
          ],
          matchGroup: 2
          // second collection = defense
        }
      ]
    },
    {
      name: "CommunicationManager",
      getProto: () => ClientLib.Net.CommunicationManager.prototype,
      properties: [
        {
          publicName: "$Poll",
          resolver(proto) {
            const fn = findFunctionByContent(proto, '"Poll"');
            if (!fn) return null;
            if (typeof proto["$Poll"] === "undefined") {
              proto["$Poll"] = proto[fn.name];
            }
            return null;
          }
        }
      ]
    }
  ];

  // lib/config.js
  var Config = class {
    /**
     * @param {string} storageKey — localStorage key for all config
     */
    constructor(storageKey = "st-config") {
      this.storageKey = storageKey;
      this.data = {};
      this.load();
    }
    load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
    }
    save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      } catch (e) {
        console.warn("[ST] Config save failed:", e);
      }
    }
    /**
     * Get a config value.
     * @param {string} key — dot-separated key, e.g. 'CampTracker.size'
     * @param {*} defaultValue — returned if key is not set
     */
    get(key, defaultValue = void 0) {
      const val = this.data[key.toLowerCase()];
      return val !== void 0 ? val : defaultValue;
    }
    /**
     * Set a config value and persist.
     * @param {string} key
     * @param {*} value — pass undefined to delete
     */
    set(key, value) {
      const k = key.toLowerCase();
      if (value === void 0) {
        delete this.data[k];
      } else {
        this.data[k] = value;
      }
      this.save();
    }
  };

  // lib/i18n.js
  var LANGUAGES = ["en", "de", "nl"];
  var DEFAULT_LANGUAGE = "en";
  var STRINGS = {
    en: {
      // ── Core ──
      loaded: "v{version} loaded \u2014 {active}/{total} plugins active",
      patchFailed: "\u26A0 Patch failed: {names} \u2014 some features may not work. Check for a script update.",
      pluginStartFailed: "\u26A0 {name} failed to start: {error}",
      unknownPlugin: "Unknown plugin. Available: {names}",
      pluginEnabledMsg: "{name} enabled",
      pluginDisabledMsg: "{name} disabled",
      pluginUsage: "Usage: /st plugin enable|disable <name>",
      statusHeader: "Shockr Tools v{version} \u2014 status",
      pluginEnabled: "on",
      pluginDisabled: "off",
      versionLine: "Shockr TA Tools v{version}",
      // ── CLI ──
      noConfig: "No config set",
      configUsage: "Usage: /st config set|get|list <key> [value]",
      commandError: "Error: {error}",
      unknownCommand: "Unknown command: {cmd}. Type /st help",
      // ── Help ──
      helpHeader: "Shockr Tools v{version} \u2014 Commands",
      helpPlugins: "Plugins",
      helpEnable: "Enable a plugin",
      helpDisable: "Disable a plugin",
      helpAvailablePlugins: "Available plugins:",
      helpTools: "Tools",
      helpCmdPlunder: "Toggle plunder panel",
      helpCmdScan: "Scan nearby FG bases now",
      helpCmdScanAlliance: "Scan alliance bases now",
      helpSettings: "Settings",
      helpConfigSet: "Change a setting",
      helpConfigGet: "Show a setting",
      helpConfigList: "Show all settings",
      helpRegister: "Register with the alliance server (personal key)",
      helpStatus: "Show plugin & registration status",
      helpVersion: "Show script version",
      helpUsefulSettings: "Useful settings:",
      helpSetLanguage: "en / de / nl (default: en)",
      helpSetApiUrl: "Server URL for scanners/watcher",
      helpSetApiKey: "Shared alliance key (transition \u2014 use /st register)",
      helpSetButtonLeft: "UC button X position (px)",
      helpSetButtonTop: "UC button Y position (px)",
      helpHelp: "This message",
      helpCloseHint: "Press Escape, click \u2715 or type /st help again to close. Show help in the chat instead: /st config set help.popup false",
      // ── Plugin descriptions ──
      descCampTracker: "FG base markers on world map",
      descKillInfo: "Plunder panel for the selected FG base",
      descPlayerStatus: "Alliance base colors by online status",
      descLayoutScanner: "Scan FG base layouts",
      descAllianceScanner: "Scan alliance base layouts",
      descRepairGuard: "Block Repair All buttons",
      descUpgradeCalc: "Building upgrade cost & time panel",
      descTargetWatcher: "Report viewed targets to alliance server",
      descAttackTracker: "Log your won attacks on Forgotten targets to the alliance server",
      // ── Shared ──
      close: "Close",
      apiKeyRejected: "\u26A0 API key rejected \u2014 check /st config set api.key",
      notAMember: "\u26A0\uFE0F Server: not recognized \u2014 scan a base first to register.",
      scansFailed: "\u26A0 {count} scan(s) failed to send",
      configSecretSet: "set",
      configSecretNotSet: "not set",
      // ── Registration (/st register) ──
      notRegistered: "\u26A0\uFE0F Not registered \u2014 type /st register",
      playerKeyRejected: "\u26A0\uFE0F Personal key rejected \u2014 type /st register to get a new one",
      registerTitle: "Register with the alliance server",
      registerIntro: "Enter the enrollment code from the alliance chat. Your personal key is stored automatically.",
      registerCode: "Enrollment code",
      registerButton: "Register",
      registerBusy: "Registering...",
      registerSuccess: "\u2705 Registered! Your personal key is active.",
      registerKeyNotice: "This is your personal API key. Copy it now \u2014 you can see it again later with /st config get api.playerkey. Use it to log in to the Shockr Alliance website.",
      copy: "Copy",
      copied: "\u2705 Copied",
      copyFailed: "Copy failed \u2014 select the key and press Ctrl+C",
      registerSuccessChat: "\u2705 Registered successfully",
      registerInvalidCode: "\u274C Invalid enrollment code",
      registerNotAuthorized: "\u274C Alliance not authorized",
      registerRateLimited: "\u274C Too many attempts \u2014 try again in an hour",
      registerFailed: "\u274C Registration failed: {error}",
      registerNoServer: "\u274C No server configured \u2014 set api.url first",
      registerNoGameData: "\u274C Game data not ready \u2014 try again in a moment",
      registerNoAlliance: "\u274C You are not in an alliance",
      registerStatusOn: "Registration: \u2705 registered \u2014 personal key active",
      registerStatusShared: "Registration: \u26A0\uFE0F not registered \u2014 using the shared alliance key (type /st register)",
      registerStatusOff: "Registration: \u26A0\uFE0F not registered \u2014 type /st register",
      // ── CampTracker ──
      campSpawned: "{time}: New L{level} {type} spawned at {coord}",
      campTypeCamp: "Camp",
      campTypeOutpost: "Outpost",
      markerTitle: "Object #{id}",
      // ── KillInfo ──
      plunderSelectFirst: "Select a Forgotten base first",
      plunderChat: "Plunder: {name} Lvl {level} \u2014 Tib {tib}, Crystal {cry}",
      plunderTitle: "Plunder",
      plunderUnit: "Unit",
      plunderLevel: "Lv",
      plunderTib: "Tib",
      plunderCrystal: "Crystal",
      plunderTotal: "Total",
      // ── LayoutScanner ──
      scanNotConfigured: "Scanner not configured. Set api.url first, then /st register.",
      scanInProgress: "Scan already in progress...",
      scanManualStarted: "Manual scan started...",
      scanNoServer: "LayoutScanner enabled but no server configured. Set api.url first, then /st register.",
      scanConsent: "\u26A0 LayoutScanner sends base layouts to an external server ({url}). This includes base positions, units, and buildings of FG camps/outposts/bases near you. Disable with /st plugin disable LayoutScanner",
      scanComplete: "Scan complete: {scanned} base(s) sent, {skipped} skipped ({duration}s)",
      scanFailed: "\u26A0 Scan failed: {error}",
      // ── AllianceScanner ──
      allianceScanNotConfigured: "Alliance scan not configured. Set api.url first, then /st register.",
      allianceScanInProgress: "Alliance scan already in progress...",
      allianceScanLocked: "{holder} is scanning \u2014 try again when it is done.",
      allianceScanStarted: "Alliance scan started...",
      allianceScanComplete: "Alliance scan complete: {scanned} base(s) sent, {skipped} skipped ({duration}s)",
      allianceScanFailed: "\u26A0 Alliance scan failed: {error}",
      // ── RepairGuard ──
      repairGuardEnabled: "Repair Guard active \u2014 Repair All blocked",
      repairGuardBlocked: "Repair Guard: Repair All blocked \u2014 repair per unit or /st plugin disable repair-guard",
      repairGuardStatusOff: "Repair All allowed",
      repairGuardStatusOn: "Repair All blocked ({count} patches)",
      // ── UpgradeCalc ──
      upgradeCalcTitle: "Upgrades",
      upgradeCalcError: "Upgrade Calculator: error \u2014 {error}",
      upgradeCalcPerHour: "/h",
      upgradeCalcAllMax: "All buildings at max level",
      upgradeCalcBuilding: "Building",
      upgradeCalcLevel: "Level",
      upgradeCalcTib: "Tib",
      upgradeCalcPower: "Power",
      upgradeCalcTime: "Time",
      upgradeCalcReady: "Ready",
      upgradeCalcHours: "{h}h {m}m",
      upgradeCalcStatusButton: "button in base view",
      upgradeCalcStatusOpen: "button in base view, panel open",
      // ── TargetWatcher ──
      targetWatcherNoServer: "TargetWatcher enabled but no server configured. Set api.url first, then /st register.",
      targetWatcherWarning: "\u26A0\uFE0F {player} is also viewing {target}{since}",
      targetWatcherWarningMulti: "\u26A0\uFE0F {players} are also viewing {target}",
      targetWatcherSinceNow: " (just now)",
      targetWatcherSince: " (since {min} min)",
      targetWatcherStatusNoServer: "no server configured (api.url / /st register)",
      targetWatcherStatusWatching: "viewing {target} ({x}:{y}), {count} report(s) sent",
      targetWatcherStatusIdle: "no target in view, {count} report(s) sent",
      // ── AttackTracker ──
      attackTrackerStatus: "{count} attack(s) logged this session, {queued} waiting to be sent",
      attackTrackerStatusNoServer: "no server configured (api.url / /st register)"
    },
    de: {
      loaded: "v{version} geladen \u2014 {active}/{total} Plugins aktiv",
      patchFailed: "\u26A0 Patch fehlgeschlagen: {names} \u2014 einige Funktionen gehen evtl. nicht. Pr\xFCfe auf ein Script-Update.",
      pluginStartFailed: "\u26A0 {name} konnte nicht starten: {error}",
      unknownPlugin: "Unbekanntes Plugin. Verf\xFCgbar: {names}",
      pluginEnabledMsg: "{name} aktiviert",
      pluginDisabledMsg: "{name} deaktiviert",
      pluginUsage: "Verwendung: /st plugin enable|disable <name>",
      statusHeader: "Shockr Tools v{version} \u2014 Status",
      pluginEnabled: "an",
      pluginDisabled: "aus",
      versionLine: "Shockr TA Tools v{version}",
      noConfig: "Keine Einstellungen gesetzt",
      configUsage: "Verwendung: /st config set|get|list <key> [value]",
      commandError: "Fehler: {error}",
      unknownCommand: "Unbekannter Befehl: {cmd}. Tippe /st help",
      helpHeader: "Shockr Tools v{version} \u2014 Befehle",
      helpPlugins: "Plugins",
      helpEnable: "Plugin aktivieren",
      helpDisable: "Plugin deaktivieren",
      helpAvailablePlugins: "Verf\xFCgbare Plugins:",
      helpTools: "Werkzeuge",
      helpCmdPlunder: "Pl\xFCnder-Panel ein/aus",
      helpCmdScan: "FG-Basen in der N\xE4he jetzt scannen",
      helpCmdScanAlliance: "Allianz-Basen jetzt scannen",
      helpSettings: "Einstellungen",
      helpConfigSet: "Einstellung \xE4ndern",
      helpConfigGet: "Einstellung anzeigen",
      helpConfigList: "Alle Einstellungen anzeigen",
      helpRegister: "Beim Allianz-Server registrieren (pers\xF6nlicher Key)",
      helpStatus: "Plugin- & Registrierungsstatus anzeigen",
      helpVersion: "Script-Version anzeigen",
      helpUsefulSettings: "N\xFCtzliche Einstellungen:",
      helpSetLanguage: "en / de / nl (Standard: en)",
      helpSetApiUrl: "Server-URL f\xFCr Scanner/Watcher",
      helpSetApiKey: "Gemeinsamer Allianz-Key (\xDCbergang \u2014 nutze /st register)",
      helpSetButtonLeft: "UC-Button X-Position (px)",
      helpSetButtonTop: "UC-Button Y-Position (px)",
      helpHelp: "Diese Hilfe",
      helpCloseHint: "Schlie\xDFen mit Escape, \u2715 oder erneut /st help. Hilfe stattdessen im Chat: /st config set help.popup false",
      descCampTracker: "FG-Basis-Markierungen auf der Weltkarte",
      descKillInfo: "Pl\xFCnder-Panel f\xFCr die gew\xE4hlte FG-Basis",
      descPlayerStatus: "Allianz-Basisfarben nach Online-Status",
      descLayoutScanner: "FG-Basis-Layouts scannen",
      descAllianceScanner: "Allianz-Basis-Layouts scannen",
      descRepairGuard: "Repair-All-Buttons blockieren",
      descUpgradeCalc: "Panel mit Upgrade-Kosten & -Dauer der Geb\xE4ude",
      descTargetWatcher: "Angesehene Ziele an den Allianz-Server melden",
      descAttackTracker: "Gewonnene Angriffe auf Forgotten-Ziele an den Allianz-Server melden",
      close: "Schlie\xDFen",
      apiKeyRejected: "\u26A0 API-Key abgelehnt \u2014 pr\xFCfe /st config set api.key",
      notAMember: "\u26A0\uFE0F Server: nicht erkannt \u2014 scanne zuerst eine Basis, um dich zu registrieren.",
      scansFailed: "\u26A0 {count} Scan(s) konnten nicht gesendet werden",
      configSecretSet: "gesetzt",
      configSecretNotSet: "nicht gesetzt",
      notRegistered: "\u26A0\uFE0F Nicht registriert \u2014 tippe /st register",
      playerKeyRejected: "\u26A0\uFE0F Pers\xF6nlicher Key abgelehnt \u2014 tippe /st register f\xFCr einen neuen",
      registerTitle: "Beim Allianz-Server registrieren",
      registerIntro: "Gib den Registrierungscode aus dem Allianz-Chat ein. Dein pers\xF6nlicher Key wird automatisch gespeichert.",
      registerCode: "Registrierungscode",
      registerButton: "Registrieren",
      registerBusy: "Registriere...",
      registerSuccess: "\u2705 Registriert! Dein pers\xF6nlicher Key ist aktiv.",
      registerKeyNotice: "Das ist dein pers\xF6nlicher API-Key. Kopiere ihn jetzt \u2014 du kannst ihn sp\xE4ter erneut sehen mit /st config get api.playerkey. Verwende ihn, um dich auf der Shockr Alliance Website anzumelden.",
      copy: "Kopieren",
      copied: "\u2705 Kopiert",
      copyFailed: "Kopieren fehlgeschlagen \u2014 markiere den Key und dr\xFCcke Strg+C",
      registerSuccessChat: "\u2705 Erfolgreich registriert",
      registerInvalidCode: "\u274C Ung\xFCltiger Registrierungscode",
      registerNotAuthorized: "\u274C Allianz nicht berechtigt",
      registerRateLimited: "\u274C Zu viele Versuche \u2014 versuche es in einer Stunde erneut",
      registerFailed: "\u274C Registrierung fehlgeschlagen: {error}",
      registerNoServer: "\u274C Kein Server eingerichtet \u2014 setze zuerst api.url",
      registerNoGameData: "\u274C Spieldaten noch nicht geladen \u2014 versuche es gleich erneut",
      registerNoAlliance: "\u274C Du bist in keiner Allianz",
      registerStatusOn: "Registrierung: \u2705 registriert \u2014 pers\xF6nlicher Key aktiv",
      registerStatusShared: "Registrierung: \u26A0\uFE0F nicht registriert \u2014 gemeinsamer Allianz-Key in Gebrauch (tippe /st register)",
      registerStatusOff: "Registrierung: \u26A0\uFE0F nicht registriert \u2014 tippe /st register",
      campSpawned: "{time}: Neues L{level} {type} erschienen bei {coord}",
      campTypeCamp: "Camp",
      campTypeOutpost: "Outpost",
      markerTitle: "Objekt #{id}",
      plunderSelectFirst: "W\xE4hle zuerst eine Forgotten-Basis",
      plunderChat: "Beute: {name} Lvl {level} \u2014 Tib {tib}, Kristall {cry}",
      plunderTitle: "Beute",
      plunderUnit: "Einheit",
      plunderLevel: "Lv",
      plunderTib: "Tib",
      plunderCrystal: "Kristall",
      plunderTotal: "Gesamt",
      scanNotConfigured: "Scanner nicht eingerichtet. Setze zuerst api.url, dann /st register.",
      scanInProgress: "Scan l\xE4uft bereits...",
      scanManualStarted: "Manueller Scan gestartet...",
      scanNoServer: "LayoutScanner aktiv, aber kein Server eingerichtet. Setze zuerst api.url, dann /st register.",
      scanConsent: "\u26A0 LayoutScanner sendet Basis-Layouts an einen externen Server ({url}). Das umfasst Positionen, Einheiten und Geb\xE4ude von FG-Camps/-Outposts/-Basen in deiner N\xE4he. Deaktivieren mit /st plugin disable LayoutScanner",
      scanComplete: "Scan fertig: {scanned} Basis/Basen gesendet, {skipped} \xFCbersprungen ({duration}s)",
      scanFailed: "\u26A0 Scan fehlgeschlagen: {error}",
      allianceScanNotConfigured: "Allianz-Scan nicht eingerichtet. Setze zuerst api.url, dann /st register.",
      allianceScanInProgress: "Allianz-Scan l\xE4uft bereits...",
      allianceScanLocked: "{holder} scannt gerade \u2014 versuche es danach erneut.",
      allianceScanStarted: "Allianz-Scan gestartet...",
      allianceScanComplete: "Allianz-Scan fertig: {scanned} Basis/Basen gesendet, {skipped} \xFCbersprungen ({duration}s)",
      allianceScanFailed: "\u26A0 Allianz-Scan fehlgeschlagen: {error}",
      repairGuardEnabled: "Repair Guard aktiv \u2014 Repair All blockiert",
      repairGuardBlocked: "Repair Guard: Repair All blockiert \u2014 einzeln reparieren oder /st plugin disable repair-guard",
      repairGuardStatusOff: "Repair All erlaubt",
      repairGuardStatusOn: "Repair All blockiert ({count} Patches)",
      upgradeCalcTitle: "Upgrades",
      upgradeCalcError: "Upgrade Calculator: Fehler \u2014 {error}",
      upgradeCalcPerHour: "/h",
      upgradeCalcAllMax: "Alle Geb\xE4ude auf Max-Level",
      upgradeCalcBuilding: "Geb\xE4ude",
      upgradeCalcLevel: "Level",
      upgradeCalcTib: "Tib",
      upgradeCalcPower: "Strom",
      upgradeCalcTime: "Zeit",
      upgradeCalcReady: "Bereit",
      upgradeCalcHours: "{h}h {m}m",
      upgradeCalcStatusButton: "Button in der Basis-Ansicht",
      upgradeCalcStatusOpen: "Button in der Basis-Ansicht, Panel offen",
      targetWatcherNoServer: "TargetWatcher aktiv, aber kein Server eingerichtet. Setze zuerst api.url, dann /st register.",
      targetWatcherWarning: "\u26A0\uFE0F {player} schaut sich auch {target} an{since}",
      targetWatcherWarningMulti: "\u26A0\uFE0F {players} schauen sich auch {target} an",
      targetWatcherSinceNow: " (gerade eben)",
      targetWatcherSince: " (seit {min} Min.)",
      targetWatcherStatusNoServer: "kein Server eingerichtet (api.url / /st register)",
      targetWatcherStatusWatching: "schaut {target} ({x}:{y}) an, {count} Meldung(en) gesendet",
      targetWatcherStatusIdle: "kein Ziel im Blick, {count} Meldung(en) gesendet",
      attackTrackerStatus: "{count} Angriff(e) in dieser Sitzung gemeldet, {queued} warten auf Versand",
      attackTrackerStatusNoServer: "kein Server eingerichtet (api.url / /st register)"
    },
    nl: {
      loaded: "v{version} geladen \u2014 {active}/{total} plugins actief",
      patchFailed: "\u26A0 Patch mislukt: {names} \u2014 sommige functies werken mogelijk niet. Kijk of er een script-update is.",
      pluginStartFailed: "\u26A0 {name} kon niet starten: {error}",
      unknownPlugin: "Onbekende plugin. Beschikbaar: {names}",
      pluginEnabledMsg: "{name} aangezet",
      pluginDisabledMsg: "{name} uitgezet",
      pluginUsage: "Gebruik: /st plugin enable|disable <naam>",
      statusHeader: "Shockr Tools v{version} \u2014 status",
      pluginEnabled: "aan",
      pluginDisabled: "uit",
      versionLine: "Shockr TA Tools v{version}",
      noConfig: "Geen instellingen gezet",
      configUsage: "Gebruik: /st config set|get|list <key> [waarde]",
      commandError: "Fout: {error}",
      unknownCommand: "Onbekend commando: {cmd}. Typ /st help",
      helpHeader: "Shockr Tools v{version} \u2014 Commando's",
      helpPlugins: "Plugins",
      helpEnable: "Plugin aanzetten",
      helpDisable: "Plugin uitzetten",
      helpAvailablePlugins: "Beschikbare plugins:",
      helpTools: "Tools",
      helpCmdPlunder: "Plunder-paneel aan/uit",
      helpCmdScan: "FG-bases in de buurt nu scannen",
      helpCmdScanAlliance: "Alliance-bases nu scannen",
      helpSettings: "Instellingen",
      helpConfigSet: "Instelling wijzigen",
      helpConfigGet: "Instelling tonen",
      helpConfigList: "Alle instellingen tonen",
      helpRegister: "Registreren bij de alliance-server (persoonlijke key)",
      helpStatus: "Plugin- & registratiestatus tonen",
      helpVersion: "Script-versie tonen",
      helpUsefulSettings: "Handige instellingen:",
      helpSetLanguage: "en / de / nl (standaard: en)",
      helpSetApiUrl: "Server-URL voor scanners/watcher",
      helpSetApiKey: "Gedeelde alliance-key (overgang \u2014 gebruik /st register)",
      helpSetButtonLeft: "UC-knop X-positie (px)",
      helpSetButtonTop: "UC-knop Y-positie (px)",
      helpHelp: "Dit bericht",
      helpCloseHint: "Sluiten met Escape, \u2715 of nogmaals /st help. Help liever in de chat: /st config set help.popup false",
      descCampTracker: "FG-base-markeringen op de wereldkaart",
      descKillInfo: "Plunder-paneel voor de geselecteerde FG-base",
      descPlayerStatus: "Alliance-basekleuren op online-status",
      descLayoutScanner: "FG-base-layouts scannen",
      descAllianceScanner: "Alliance-base-layouts scannen",
      descRepairGuard: "Repair All-knoppen blokkeren",
      descUpgradeCalc: "Paneel met upgrade-kosten & -tijd van gebouwen",
      descTargetWatcher: "Bekeken targets melden aan de alliance-server",
      descAttackTracker: "Gewonnen aanvallen op Forgotten-targets melden aan de alliance-server",
      close: "Sluiten",
      apiKeyRejected: "\u26A0 API-key geweigerd \u2014 controleer /st config set api.key",
      notAMember: "\u26A0\uFE0F Server: niet herkend \u2014 scan eerst een base om je te registreren.",
      scansFailed: "\u26A0 {count} scan(s) konden niet verstuurd worden",
      configSecretSet: "ingesteld",
      configSecretNotSet: "niet ingesteld",
      notRegistered: "\u26A0\uFE0F Niet geregistreerd \u2014 typ /st register",
      playerKeyRejected: "\u26A0\uFE0F Persoonlijke key geweigerd \u2014 typ /st register voor een nieuwe",
      registerTitle: "Registreren bij de alliance-server",
      registerIntro: "Vul de enrollment-code uit de alliance-chat in. Je persoonlijke key wordt automatisch opgeslagen.",
      registerCode: "Enrollment-code",
      registerButton: "Registreren",
      registerBusy: "Bezig met registreren...",
      registerSuccess: "\u2705 Geregistreerd! Je persoonlijke key is actief.",
      registerKeyNotice: "Dit is je persoonlijke API key. Kopieer hem nu \u2014 je kunt hem later opnieuw zien met /st config get api.playerkey. Gebruik hem om in te loggen op de Shockr Alliance website.",
      copy: "Kopi\xEBren",
      copied: "\u2705 Gekopieerd",
      copyFailed: "Kopi\xEBren mislukt \u2014 selecteer de key en druk Ctrl+C",
      registerSuccessChat: "\u2705 Succesvol geregistreerd",
      registerInvalidCode: "\u274C Ongeldige enrollment-code",
      registerNotAuthorized: "\u274C Alliance niet geautoriseerd",
      registerRateLimited: "\u274C Te veel pogingen \u2014 probeer het over een uur opnieuw",
      registerFailed: "\u274C Registratie mislukt: {error}",
      registerNoServer: "\u274C Geen server ingesteld \u2014 zet eerst api.url",
      registerNoGameData: "\u274C Spelgegevens nog niet geladen \u2014 probeer het zo opnieuw",
      registerNoAlliance: "\u274C Je zit niet in een alliance",
      registerStatusOn: "Registratie: \u2705 geregistreerd \u2014 persoonlijke key actief",
      registerStatusShared: "Registratie: \u26A0\uFE0F niet geregistreerd \u2014 gedeelde alliance-key in gebruik (typ /st register)",
      registerStatusOff: "Registratie: \u26A0\uFE0F niet geregistreerd \u2014 typ /st register",
      campSpawned: "{time}: Nieuw L{level} {type} verschenen op {coord}",
      campTypeCamp: "Camp",
      campTypeOutpost: "Outpost",
      markerTitle: "Object #{id}",
      plunderSelectFirst: "Selecteer eerst een Forgotten-base",
      plunderChat: "Buit: {name} Lvl {level} \u2014 Tib {tib}, Crystal {cry}",
      plunderTitle: "Buit",
      plunderUnit: "Unit",
      plunderLevel: "Lv",
      plunderTib: "Tib",
      plunderCrystal: "Crystal",
      plunderTotal: "Totaal",
      scanNotConfigured: "Scanner niet ingesteld. Zet eerst api.url en doe dan /st register.",
      scanInProgress: "Scan loopt al...",
      scanManualStarted: "Handmatige scan gestart...",
      scanNoServer: "LayoutScanner aan, maar geen server ingesteld. Zet eerst api.url en doe dan /st register.",
      scanConsent: "\u26A0 LayoutScanner stuurt base-layouts naar een externe server ({url}). Dit omvat posities, units en gebouwen van FG-camps/-outposts/-bases bij jou in de buurt. Uitzetten met /st plugin disable LayoutScanner",
      scanComplete: "Scan klaar: {scanned} base(s) verstuurd, {skipped} overgeslagen ({duration}s)",
      scanFailed: "\u26A0 Scan mislukt: {error}",
      allianceScanNotConfigured: "Alliance-scan niet ingesteld. Zet eerst api.url en doe dan /st register.",
      allianceScanInProgress: "Alliance-scan loopt al...",
      allianceScanLocked: "{holder} is aan het scannen \u2014 probeer het daarna opnieuw.",
      allianceScanStarted: "Alliance-scan gestart...",
      allianceScanComplete: "Alliance-scan klaar: {scanned} base(s) verstuurd, {skipped} overgeslagen ({duration}s)",
      allianceScanFailed: "\u26A0 Alliance-scan mislukt: {error}",
      repairGuardEnabled: "Repair Guard actief \u2014 Repair All geblokkeerd",
      repairGuardBlocked: "Repair Guard: Repair All geblokkeerd \u2014 repareer per unit of /st plugin disable repair-guard",
      repairGuardStatusOff: "Repair All toegestaan",
      repairGuardStatusOn: "Repair All geblokkeerd ({count} patches)",
      upgradeCalcTitle: "Upgrades",
      upgradeCalcError: "Upgrade Calculator: fout \u2014 {error}",
      upgradeCalcPerHour: "/u",
      upgradeCalcAllMax: "Alle gebouwen op max-level",
      upgradeCalcBuilding: "Gebouw",
      upgradeCalcLevel: "Level",
      upgradeCalcTib: "Tib",
      upgradeCalcPower: "Power",
      upgradeCalcTime: "Tijd",
      upgradeCalcReady: "Gereed",
      upgradeCalcHours: "{h}u {m}m",
      upgradeCalcStatusButton: "knop in base-view",
      upgradeCalcStatusOpen: "knop in base-view, paneel open",
      targetWatcherNoServer: "TargetWatcher aan, maar geen server ingesteld. Zet eerst api.url en doe dan /st register.",
      targetWatcherWarning: "\u26A0\uFE0F {player} kijkt ook naar {target}{since}",
      targetWatcherWarningMulti: "\u26A0\uFE0F {players} kijken ook naar {target}",
      targetWatcherSinceNow: " (net)",
      targetWatcherSince: " (sinds {min} min)",
      targetWatcherStatusNoServer: "geen server ingesteld (api.url / /st register)",
      targetWatcherStatusWatching: "kijkt naar {target} ({x}:{y}), {count} melding(en) verstuurd",
      targetWatcherStatusIdle: "geen target in beeld, {count} melding(en) verstuurd",
      attackTrackerStatus: "{count} aanval(len) gemeld deze sessie, {queued} wachten op verzenden",
      attackTrackerStatusNoServer: "geen server ingesteld (api.url / /st register)"
    }
  };
  var _config = null;
  function initI18n(config) {
    _config = config;
  }
  function getLanguage() {
    const lang = String(_config ? _config.get("language", DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE).toLowerCase();
    return LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  }
  function t(key, vars) {
    const table = STRINGS[getLanguage()];
    let str = table[key] !== void 0 ? table[key] : STRINGS[DEFAULT_LANGUAGE][key];
    if (str === void 0) return key;
    if (vars) {
      str = str.replace(/\{(\w+)\}/g, (m, name) => vars[name] !== void 0 ? String(vars[name]) : m);
    }
    return str;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // lib/cli.js
  var SECRET_KEYS = ["api.playerkey"];
  var Cli = class {
    constructor(config) {
      this.config = config;
      this.commands = {};
      this.PREFIX = "/st";
      this._handleKeyDown = this._handleKeyDown.bind(this);
    }
    /** Register a command handler. */
    register(name, handler) {
      this.commands[name.toLowerCase()] = handler;
    }
    /** Start listening for chat input. */
    start() {
      const el = this._getInputElement();
      if (el) {
        el.addEventListener("keydown", this._handleKeyDown);
      }
      this.register("config", (args) => {
        const [action, ...rest] = args;
        if (action === "set" && rest.length >= 2) {
          const key = rest[0];
          const value = this._parseValue(rest.slice(1).join(" "));
          this.config.set(key, value);
          chatMessage(`[ST] ${key} = ${this._display(key, value)}`);
        } else if (action === "get" && rest.length >= 1) {
          const val = this.config.get(rest[0]);
          const shown = SECRET_KEYS.includes(rest[0].toLowerCase()) && val ? escapeHtml(String(val)) : this._display(rest[0], val);
          chatMessage(`[ST] ${escapeHtml(rest[0])} = ${shown}`);
        } else if (action === "list") {
          const keys = Object.keys(this.config.data).sort();
          if (keys.length === 0) {
            chatMessage(`[ST] ${t("noConfig")}`);
          } else {
            for (const k of keys) {
              chatMessage(`[ST] ${k} = ${this._display(k, this.config.data[k])}`);
            }
          }
        } else {
          chatMessage(`[ST] ${escapeHtml(t("configUsage"))}`);
        }
      });
    }
    /** Stop listening. */
    stop() {
      const el = this._getInputElement();
      if (el) {
        el.removeEventListener("keydown", this._handleKeyDown);
      }
    }
    _handleKeyDown(e) {
      if (e.key !== "Enter") return;
      const el = this._getInputElement();
      if (!el || !el.value.startsWith(this.PREFIX)) return;
      const parts = el.value.trim().split(/\s+/);
      const cmd = (parts[1] || "").toLowerCase();
      const args = parts.slice(2);
      const handler = this.commands[cmd];
      if (handler) {
        try {
          handler(args);
        } catch (err) {
          chatMessage(`[ST] ${t("commandError", { error: err.message })}`);
        }
      } else {
        chatMessage(`[ST] ${escapeHtml(t("unknownCommand", { cmd }))}`);
      }
      el.value = "";
      el.focus();
      setTimeout(() => el.focus(), 5);
      e.preventDefault();
      return false;
    }
    _getInputElement() {
      try {
        return qx.core.Init.getApplication().getChat().getChatWidget().getEditable().getContentElement().getDomElement();
      } catch {
        return null;
      }
    }
    /** Config value for the chat — secrets only as "set" / "not set". */
    _display(key, value) {
      if (SECRET_KEYS.includes(key.toLowerCase())) {
        return t(value ? "configSecretSet" : "configSecretNotSet");
      }
      return JSON.stringify(value);
    }
    /** Parse string → number/boolean/string */
    _parseValue(str) {
      if (str === "true") return true;
      if (str === "false") return false;
      const num = parseFloat(str);
      if (!isNaN(num) && String(num) === str) return num;
      return str;
    }
  };

  // lib/idle-detect.js
  var IDLE_TIMEOUT_MS = 20 * 60 * 1e3;
  var ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
  var IdleDetect = class {
    constructor() {
      this.lastActivity = Date.now();
      this.idle = false;
      this._interval = null;
      this._onActivity = this._onActivity.bind(this);
      this.listeners = { idle: [], active: [] };
    }
    start() {
      for (const evt of ACTIVITY_EVENTS) {
        document.addEventListener(evt, this._onActivity, true);
      }
      this._interval = setInterval(() => this._check(), 1e3);
    }
    stop() {
      for (const evt of ACTIVITY_EVENTS) {
        document.removeEventListener(evt, this._onActivity, true);
      }
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    }
    /** Register a callback for 'idle' or 'active' events. */
    on(event, fn) {
      if (this.listeners[event]) this.listeners[event].push(fn);
    }
    get isIdle() {
      return this.idle;
    }
    _onActivity() {
      this.lastActivity = Date.now();
      if (this.idle) {
        this.idle = false;
        this.listeners.active.forEach((fn) => fn());
      }
    }
    _check() {
      if (this.idle) return;
      if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) {
        this.idle = true;
        this.listeners.idle.forEach((fn) => fn());
      }
    }
  };

  // lib/online-state.js
  var POLL_MS = 1e4;
  var ONLINE = 1;
  var STATE_NAMES = { 0: "offline", 1: "online", 2: "away", 3: "hidden" };
  function readOwnOnlineState() {
    let md;
    try {
      md = ClientLib.Data.MainData.GetInstance();
    } catch {
      return null;
    }
    try {
      const alliance = md.get_Alliance();
      if (alliance && alliance.get_Id() > 0) {
        const member = alliance.get_MemberData().d[md.get_Player().id];
        if (member && typeof member.OnlineState === "number") return member.OnlineState;
      }
    } catch {
    }
    try {
      const player = md.get_Player();
      if (typeof player.get_OnlineState === "function") {
        const s = player.get_OnlineState();
        if (typeof s === "number") return s;
      }
    } catch {
    }
    return null;
  }
  var OnlineStateWatch = class {
    constructor(read = readOwnOnlineState) {
      this._read = read;
      this.state = null;
      this.paused = false;
      this._interval = null;
      this._warned = false;
      this.listeners = { pause: [], resume: [] };
    }
    start() {
      this.check();
      this._interval = setInterval(() => this.check(), POLL_MS);
    }
    stop() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    }
    /** Register a callback for 'pause' or 'resume'. */
    on(event, fn) {
      if (this.listeners[event]) this.listeners[event].push(fn);
    }
    /** True while the player is Online — scanners start no new scan. */
    get isPaused() {
      return this.paused;
    }
    check() {
      const state = this._read();
      if (state === null) {
        if (!this._warned) {
          console.warn("[ST] Scanner: online-status niet leesbaar \u2014 scanners niet gepauzeerd");
          this._warned = true;
        }
        this.state = null;
        this._set(false, null);
        return;
      }
      this.state = state;
      this._set(state === ONLINE, state);
    }
    _set(paused, state) {
      if (paused === this.paused) return;
      this.paused = paused;
      if (paused) {
        console.log("[ST] Scanner: gepauzeerd (speler online)");
        this.listeners.pause.forEach((fn) => fn());
      } else {
        const why = state === null ? "status onbekend" : `speler ${STATE_NAMES[state] || state}`;
        console.log(`[ST] Scanner: hervat (${why})`);
        this.listeners.resume.forEach((fn) => fn());
      }
    }
  };

  // lib/api-client.js
  var MAX_BATCH = 25;
  var FLUSH_INTERVAL_MS = 3e4;
  var MAX_RETRIES = 3;
  var SCAN_MIN_INTERVAL_MS = 2e3;
  var RATE_LIMIT_BACKOFF_MS = 5e3;
  var REJECT_NOTIFY_INTERVAL_MS = 6e4;
  var REJECT_MESSAGES = [
    ["Not a recognized alliance member", "notAMember"],
    ["Not registered", "notRegistered"],
    ["Invalid player key", "playerKeyRejected"]
  ];
  var ENROLL_ERRORS = {
    "Invalid enrollment code": "registerInvalidCode",
    "Alliance not authorized": "registerNotAuthorized"
  };
  var ApiClient = class {
    constructor(config) {
      this.config = config;
      this.queue = [];
      this._flushTimer = null;
      this._lastRejectNotify = 0;
      this._nextScanAt = 0;
      this._flushing = null;
    }
    /** Check if the API is configured (URL + personal or shared key set). */
    get isConfigured() {
      return !!(this._url && (this._playerKey || this._key));
    }
    /** 'player' (personal key active), 'shared' (only the alliance key) or 'none'. */
    get registration() {
      if (this._playerKey) return "player";
      return this._key ? "shared" : "none";
    }
    get _url() {
      return this.config.get("api.url", "");
    }
    get _key() {
      return this.config.get("api.key", "");
    }
    /**
     * Personal key — only when it was issued to the logged-in player (several
     * accounts/worlds can share this browser's localStorage).
     */
    get _playerKey() {
      const key = this.config.get("api.playerKey", "");
      if (!key) return "";
      const owner = this.config.get("api.playerKeyId", 0);
      return owner && owner === readPlayer()?.id ? key : "";
    }
    /**
     * POST /api/enroll with the enrollment code and the player's identity; on
     * success the personal key is stored in api.playerKey and returned once as
     * playerKey, so the register popup can show it (website login).
     * @param {string} code
     * @returns {Promise<{ok: boolean, message: string, vars?: object, playerKey?: string}>} message = i18n key
     */
    async enroll(code) {
      if (!this._url) return { ok: false, message: "registerNoServer" };
      const player = readPlayer();
      if (!player || !player.id || !player.name || !player.worldId) {
        return { ok: false, message: "registerNoGameData" };
      }
      if (!player.allianceId) return { ok: false, message: "registerNoAlliance" };
      try {
        const resp = await fetch(this._url.replace(/\/$/, "") + "/api/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: player.id,
            playerName: player.name,
            allianceId: player.allianceId,
            worldId: player.worldId,
            enrollmentCode: code
          })
        });
        let data = {};
        try {
          data = await resp.json();
        } catch {
        }
        if (resp.ok && data.playerKey) {
          this.config.set("api.playerKey", String(data.playerKey));
          this.config.set("api.playerKeyId", player.id);
          return { ok: true, message: "registerSuccess", playerKey: String(data.playerKey) };
        }
        if (resp.status === 403 && ENROLL_ERRORS[data.detail]) {
          return { ok: false, message: ENROLL_ERRORS[data.detail] };
        }
        if (resp.status === 429) return { ok: false, message: "registerRateLimited" };
        return { ok: false, message: "registerFailed", vars: { error: `HTTP ${resp.status}` } };
      } catch (e) {
        console.warn("[ST] API: enroll network error", e.message);
        return { ok: false, message: "registerFailed", vars: { error: e.message } };
      }
    }
    /** Queue a scan payload for sending. */
    send(payload) {
      if (!this.isConfigured) return;
      this.queue.push(payload);
      if (this.queue.length >= MAX_BATCH) {
        this.flush();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
      }
    }
    /**
     * Flush all queued scans to the server. Only one flush runs at a time: a
     * call during a running flush waits for it and then sends what is left.
     */
    async flush() {
      while (this._flushing) await this._flushing;
      this._flushing = this._flush();
      try {
        await this._flushing;
      } finally {
        this._flushing = null;
      }
    }
    async _flush() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      if (this.queue.length === 0 || !this.isConfigured) return;
      const batch = this.queue.splice(0, MAX_BATCH);
      let success = 0;
      let failed = 0;
      for (let i = 0; i < batch.length; i++) {
        const result = await this._sendOne(batch[i]);
        if (result === true) {
          success++;
        } else if (result === "rateLimited") {
          const rest = batch.slice(i);
          this.queue.unshift(...rest);
          console.warn(`[ST] API: rate limited \u2014 ${rest.length} scan(s) kept for the next flush`);
          if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
          }
          break;
        } else {
          failed++;
        }
      }
      if (success > 0) {
        console.log(`[ST] API: ${success} scan(s) sent`);
      }
      if (failed > 0) {
        chatMessage(`[ST] ${t("scansFailed", { count: failed })}`);
      }
    }
    /** Wait until the scan slot is free (>= SCAN_MIN_INTERVAL_MS since the previous request). */
    async _paceScan() {
      const wait = this._nextScanAt - Date.now();
      if (wait > 0) await sleep2(wait);
      this._nextScanAt = Date.now() + SCAN_MIN_INTERVAL_MS;
    }
    /**
     * Send a single scan with retry.
     * @returns {Promise<true|false|'rateLimited'>} 'rateLimited' = still 429 after all backoffs
     */
    async _sendOne(payload, attempt = 0) {
      const url = this._url.replace(/\/$/, "") + "/api/scan";
      try {
        await this._paceScan();
        const resp = await fetch(url, {
          method: "POST",
          headers: this._headers(true),
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          const data = await resp.json();
          return true;
        }
        if (resp.status === 403) {
          await this._notifyRejected(resp);
          return false;
        }
        if (resp.status === 429) {
          if (attempt < MAX_RETRIES) {
            const backoff = RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
            console.warn(`[ST] API: 429 rate limited \u2014 retry in ${backoff / 1e3}s`);
            await sleep2(backoff);
            return this._sendOne(payload, attempt + 1);
          }
          return "rateLimited";
        }
        console.warn(`[ST] API: ${resp.status} ${resp.statusText}`);
        return false;
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await sleep2(1e3 * Math.pow(2, attempt));
          return this._sendOne(payload, attempt + 1);
        }
        console.warn("[ST] API: network error", e.message);
        return false;
      }
    }
    /**
     * One-off JSON request without queue/batching/retry (e.g. target-watch).
     * @param {string} method — 'GET' | 'POST'
     * @param {string} path — e.g. '/api/target-watch'
     * @param {object} [body] — sent as JSON when given
     * @returns {Promise<object|null>} parsed response ({} if empty), or null on failure
     */
    async request(method, path, body) {
      if (!this.isConfigured) return null;
      const url = this._url.replace(/\/$/, "") + path;
      const headers = this._headers(body !== void 0);
      try {
        const resp = await fetch(url, {
          method,
          headers,
          body: body !== void 0 ? JSON.stringify(body) : void 0
        });
        if (resp.status === 403) {
          await this._notifyRejected(resp);
          return null;
        }
        if (!resp.ok) {
          let detail = "";
          if (resp.status === 422) {
            try {
              detail = " " + JSON.stringify((await resp.json()).detail);
            } catch {
            }
          }
          console.warn(`[ST] API: ${method} ${path} \u2192 ${resp.status} ${resp.statusText}${detail}`);
          return null;
        }
        return await resp.json().catch(() => ({}));
      } catch (e) {
        console.warn(`[ST] API: ${method} ${path} network error`, e.message);
        return null;
      }
    }
    /** Auth + player identity headers (the name is URI-encoded: headers must be Latin-1). */
    _headers(json) {
      const playerKey = this._playerKey;
      const headers = playerKey ? { "X-Player-Key": playerKey } : { "X-Alliance-Key": this._key };
      Object.assign(headers, getPlayerIdentity());
      if (json) headers["Content-Type"] = "application/json";
      return headers;
    }
    /** Chat message for a 403: not a member / not registered / wrong key (at most once per minute). */
    async _notifyRejected(resp) {
      let detail = "";
      try {
        detail = String((await resp.json()).detail || "");
      } catch {
      }
      const now = Date.now();
      if (now - this._lastRejectNotify < REJECT_NOTIFY_INTERVAL_MS) return;
      this._lastRejectNotify = now;
      const match = REJECT_MESSAGES.find(([prefix]) => detail.startsWith(prefix));
      chatMessage(`[ST] ${t(match ? match[1] : "apiKeyRejected")}`);
    }
    /** Stop the flush timer. */
    stop() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      this.flush();
    }
  };
  function readPlayer() {
    try {
      const md = ClientLib.Data.MainData.GetInstance();
      const player = md.get_Player();
      const id = typeof player.get_Id === "function" ? player.get_Id() : player.id;
      const name = typeof player.get_Name === "function" ? player.get_Name() : player.name;
      let allianceId = typeof player.get_AllianceId === "function" ? player.get_AllianceId() : 0;
      if (!allianceId) {
        const alliance = md.get_Alliance();
        allianceId = alliance ? alliance.get_Id() : 0;
      }
      let worldId = 0;
      try {
        worldId = md.get_Server().get_WorldId();
      } catch {
      }
      if (!worldId) {
        const m = location.pathname.match(/\/(\d+)\/index\.aspx/i);
        worldId = m ? Number(m[1]) : 0;
      }
      return { id: id || 0, name: name || "", allianceId: allianceId || 0, worldId };
    } catch {
      return null;
    }
  }
  function getPlayerIdentity() {
    const out = {};
    const player = readPlayer();
    if (!player) return out;
    if (player.id) out["X-Player-Id"] = String(player.id);
    if (player.name) out["X-Player-Name"] = encodeURIComponent(player.name);
    out["X-Alliance-Id"] = String(player.allianceId);
    return out;
  }
  function sleep2(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // lib/bugfix.js
  function fixUnload() {
    try {
      const mgr = qx.event.Registration.getManager(window);
      if (mgr) {
        const handlers = mgr.getHandlers("unload", window);
        if (handlers && handlers.length > 0) {
          for (const handler of handlers) {
            try {
              qx.event.Registration.removeListenerById(window, handler);
            } catch {
            }
          }
          console.log(`[ST] BugFix: removed ${handlers.length} qooxdoo unload handler(s)`);
          return;
        }
      }
    } catch {
    }
    console.log("[ST] BugFix: no qooxdoo unload handler found (may already be patched)");
  }

  // lib/help.js
  var RULE = "\u2550".repeat(44);
  var COL = 30;
  var TOOL_COMMANDS = [
    { cmd: "plunder", usage: "/st plunder", key: "helpCmdPlunder" },
    { cmd: "scan", usage: "/st scan", key: "helpCmdScan" },
    { cmd: "scanalliance", usage: "/st scanalliance", key: "helpCmdScanAlliance" }
  ];
  var USEFUL_SETTINGS = [
    ["language", "helpSetLanguage"],
    ["api.url", "helpSetApiUrl"],
    ["api.key", "helpSetApiKey"],
    ["UpgradeCalc.buttonLeft", "helpSetButtonLeft"],
    ["UpgradeCalc.buttonTop", "helpSetButtonTop"]
  ];
  function getHelpModel(version, plugins, commands) {
    const sections = [{
      title: t("helpPlugins"),
      rows: [
        ["/st plugin enable <name>", t("helpEnable")],
        ["/st plugin disable <name>", t("helpDisable")]
      ],
      sub: {
        kind: "plugins",
        title: t("helpAvailablePlugins"),
        rows: plugins.map((p) => [kebab(p.name), p.description || ""])
      }
    }];
    const tools = TOOL_COMMANDS.filter((c) => commands[c.cmd]);
    if (tools.length) {
      sections.push({ title: t("helpTools"), rows: tools.map((c) => [c.usage, t(c.key)]) });
    }
    sections.push({
      title: t("helpSettings"),
      rows: [
        ["/st config set <key> <val>", t("helpConfigSet")],
        ["/st config get <key>", t("helpConfigGet")],
        ["/st config list", t("helpConfigList")],
        ["/st register", t("helpRegister")],
        ["/st status", t("helpStatus")],
        ["/st version", t("helpVersion")]
      ],
      sub: {
        kind: "settings",
        title: t("helpUsefulSettings"),
        rows: USEFUL_SETTINGS.map(([key, desc]) => [key, t(desc)])
      }
    });
    return {
      header: t("helpHeader", { version }),
      sections,
      footer: ["/st help", t("helpHelp")]
    };
  }
  function buildHelp(version, plugins, commands) {
    const model = getHelpModel(version, plugins, commands);
    const row = ([left, right], indent = 2) => " ".repeat(indent) + left.padEnd(COL - indent) + " " + right;
    const lines = [RULE, `  ${model.header}`, RULE];
    for (const section of model.sections) {
      lines.push("", `  ${section.title}`, `  ${"\u2500".repeat(section.title.length)}`);
      lines.push(...section.rows.map((r) => row(r)));
      if (section.sub) {
        lines.push("", `  ${section.sub.title}`);
        if (section.sub.kind === "plugins") {
          const nameWidth = Math.max(...section.sub.rows.map(([name]) => name.length)) + 1;
          lines.push(...section.sub.rows.map(([name, desc]) => `    ${name.padEnd(nameWidth)}\u2014 ${desc}`));
        } else {
          lines.push(...section.sub.rows.map((r) => row(r, 4)));
        }
      }
    }
    lines.push("", row(model.footer), RULE);
    const body = lines.map(escapeHtml).join("<br>");
    return `<span style="font-family:Consolas,'Courier New',monospace;white-space:pre;">${body}</span>`;
  }
  function buildHelpPanel(version, plugins, commands) {
    const model = getHelpModel(version, plugins, commands);
    const mono = "font-family:Consolas,'Courier New',monospace;";
    const cmdCell = `padding:2px 12px 2px 0;${mono}font-size:12px;color:#81d4fa;white-space:nowrap;vertical-align:top;`;
    const descCell = "padding:2px 0;color:#999;vertical-align:top;";
    const table = (rows, sub = false) => `<table class="${sub ? "st-sub" : ""}" style="border-collapse:collapse;">` + rows.map(([cmd, desc]) => `<tr><td class="st-cmd" style="${cmdCell}">${escapeHtml(cmd)}</td><td style="${descCell}">${escapeHtml(desc)}</td></tr>`).join("") + "</table>";
    const heading = (text) => `<div style="margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #444;color:#fff;font-weight:bold;">${escapeHtml(text)}</div>`;
    let html = `<div style="font-size:14px;font-weight:bold;color:#fff;">${escapeHtml(model.header)}</div>`;
    for (const section of model.sections) {
      html += heading(section.title) + table(section.rows);
      if (section.sub) {
        html += `<div style="margin:8px 0 2px;color:#bbb;">${escapeHtml(section.sub.title)}</div>` + table(section.sub.rows, true);
      }
    }
    html += `<div style="margin-top:12px;padding-top:6px;border-top:1px solid #444;">${table([model.footer])}</div>`;
    html += `<div style="margin-top:6px;color:#777;font-size:11px;">${escapeHtml(t("helpCloseHint"))}</div>`;
    return html;
  }
  function kebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  }

  // lib/help-panel.js
  var PANEL_ID = "st-help-panel";
  var PANEL_CSS = `
#${PANEL_ID} td.st-cmd { width: 230px; }
#${PANEL_ID} table.st-sub { margin-left: 10px; }
#${PANEL_ID} table.st-sub td.st-cmd { width: 220px; }
@media (max-width: 600px) {
    #${PANEL_ID} tr, #${PANEL_ID} td { display: block; }
    #${PANEL_ID} td.st-cmd, #${PANEL_ID} table.st-sub td.st-cmd { width: auto; padding-top: 4px; }
    #${PANEL_ID} td.st-cmd + td { padding-left: 12px; }
}
`;
  var HelpPanel = class {
    constructor() {
      this._panel = null;
      this._content = null;
      this._onKeyDown = (e) => {
        if (e.key === "Escape") this.hide();
      };
    }
    isOpen() {
      return !!this._panel && this._panel.style.display !== "none";
    }
    /** Close if open, otherwise show `html`. */
    toggle(html) {
      if (this.isOpen()) {
        this.hide();
        return;
      }
      this._ensurePanel();
      this._content.innerHTML = html;
      this._close.title = t("close");
      this._panel.style.display = "block";
      this._panel.scrollTop = 0;
      document.addEventListener("keydown", this._onKeyDown);
    }
    hide() {
      document.removeEventListener("keydown", this._onKeyDown);
      if (this._panel) this._panel.style.display = "none";
    }
    _ensurePanel() {
      if (this._panel && document.body.contains(this._panel)) return this._panel;
      const panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.cssText = `
            display: none;
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            width: 580px;
            max-width: calc(100vw - 16px);
            max-height: 80vh;
            overflow: auto;
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px 14px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
      const close = document.createElement("div");
      close.textContent = "\u2715";
      close.style.cssText = "position:sticky;top:0;float:right;cursor:pointer;color:#999;font-size:14px;line-height:1;padding:2px 0 4px 8px;";
      close.addEventListener("click", () => this.hide());
      close.addEventListener("mouseenter", () => {
        close.style.color = "#fff";
      });
      close.addEventListener("mouseleave", () => {
        close.style.color = "#999";
      });
      const content = document.createElement("div");
      const style = document.createElement("style");
      style.textContent = PANEL_CSS;
      panel.appendChild(style);
      panel.appendChild(close);
      panel.appendChild(content);
      document.body.appendChild(panel);
      this._panel = panel;
      this._content = content;
      this._close = close;
      return panel;
    }
  };

  // lib/register-panel.js
  var PANEL_ID2 = "st-register-panel";
  var FOCUS_DELAY_MS = 50;
  var RegisterPanel = class {
    /**
     * @param {(code: string) => Promise<{ok: boolean, message: string, vars?: object}>} onSubmit
     *        — performs the enrollment; message is an i18n key
     */
    constructor(onSubmit) {
      this.onSubmit = onSubmit;
      this._panel = null;
    }
    isOpen() {
      return !!this._panel && document.body.contains(this._panel);
    }
    /** Show a fresh form (rebuilt each time so a previous result is gone). */
    open() {
      this.hide();
      this._panel = this._build();
      document.body.appendChild(this._panel);
      setTimeout(() => this._input && this._input.focus(), FOCUS_DELAY_MS);
    }
    hide() {
      if (this._panel) this._panel.remove();
      this._panel = null;
      this._input = null;
    }
    async _submit(form, button, status) {
      const code = this._input.value.trim();
      if (!code) {
        this._input.focus();
        return;
      }
      button.disabled = true;
      this._input.disabled = true;
      this._showStatus(status, t("registerBusy"), "#ccc");
      const panel = this._panel;
      const result = await this.onSubmit(code);
      if (panel !== this._panel) return;
      if (result.ok) {
        form.style.display = "none";
        this._showStatus(status, t(result.message, result.vars), "#7c7");
        if (result.playerKey) panel.appendChild(this._buildKeyBlock(result.playerKey));
      } else {
        this._showStatus(status, t(result.message, result.vars), "#f77");
        button.disabled = false;
        this._input.disabled = false;
        this._input.select();
        this._input.focus();
      }
    }
    /** The new key: notice, read-only field + Copy, and Close. */
    _buildKeyBlock(key) {
      const block = document.createElement("div");
      block.style.marginTop = "10px";
      const notice = document.createElement("div");
      notice.textContent = t("registerKeyNotice");
      notice.style.cssText = "color:#ddd;margin-bottom:8px;line-height:1.4;";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;";
      const field = document.createElement("input");
      field.type = "text";
      field.readOnly = true;
      field.value = key;
      field.spellcheck = false;
      field.style.cssText = "flex:1;min-width:0;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:12px;";
      field.addEventListener("focus", () => field.select());
      const btnStyle = "padding:5px 12px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = t("copy");
      copy.style.cssText = btnStyle;
      const feedback = document.createElement("div");
      feedback.style.cssText = "min-height:16px;margin-top:4px;font-size:11px;";
      copy.addEventListener("click", async () => {
        const ok = await copyText(key, field);
        feedback.textContent = t(ok ? "copied" : "copyFailed");
        feedback.style.color = ok ? "#7c7" : "#f77";
        if (!ok) field.select();
      });
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = t("close");
      close.style.cssText = btnStyle + "margin-top:6px;background:#444;border-color:#666;";
      close.addEventListener("click", () => this.hide());
      row.append(field, copy);
      block.append(notice, row, feedback, close);
      setTimeout(() => {
        field.focus();
        field.select();
      }, FOCUS_DELAY_MS);
      return block;
    }
    _showStatus(el, text, color) {
      el.textContent = text;
      el.style.color = color;
      el.style.display = "block";
    }
    _build() {
      const panel = document.createElement("div");
      panel.id = PANEL_ID2;
      panel.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            width: 360px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px 14px 14px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
      for (const type of ["keydown", "keyup", "keypress"]) {
        panel.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type === "keydown" && e.key === "Escape") this.hide();
        });
      }
      const close = document.createElement("div");
      close.textContent = "\u2715";
      close.title = t("close");
      close.style.cssText = "float:right;cursor:pointer;color:#999;font-size:14px;line-height:1;padding:2px 0 4px 8px;";
      close.addEventListener("click", () => this.hide());
      close.addEventListener("mouseenter", () => {
        close.style.color = "#fff";
      });
      close.addEventListener("mouseleave", () => {
        close.style.color = "#999";
      });
      const title = document.createElement("div");
      title.innerHTML = `<b style="color:#8cf;font-size:13px">${escapeHtml(t("registerTitle"))}</b>`;
      title.style.marginBottom = "8px";
      const form = document.createElement("form");
      form.autocomplete = "off";
      const intro = document.createElement("div");
      intro.textContent = t("registerIntro");
      intro.style.cssText = "color:#aaa;margin-bottom:10px;";
      const label = document.createElement("label");
      label.textContent = t("registerCode");
      label.style.cssText = "display:block;margin-bottom:4px;";
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 100;
      input.style.cssText = "width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;font-size:12px;";
      label.htmlFor = input.id = `${PANEL_ID2}-code`;
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = t("registerButton");
      button.style.cssText = "margin-top:10px;padding:5px 16px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;";
      const status = document.createElement("div");
      status.style.cssText = "display:none;margin-top:10px;font-weight:bold;";
      form.append(intro, label, input, button);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this._submit(form, button, status);
      });
      panel.append(close, title, form, status);
      this._input = input;
      return panel;
    }
  };
  async function copyText(text, field) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }
    try {
      field.focus();
      field.select();
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }

  // lib/city-util.js
  function getMainCity() {
    let main = null;
    const allCities = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
    for (const city of Object.values(allCities.d)) {
      if (!main || main.get_LvlOffense() < city.get_LvlOffense()) {
        main = city;
      }
    }
    return main;
  }
  function getObjectsNearCity(city) {
    const cx = city.get_PosX();
    const cy = city.get_PosY();
    const maxDist = ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance();
    const world = ClientLib.Data.MainData.GetInstance().get_World();
    const output = /* @__PURE__ */ new Map();
    for (let dy = -maxDist; dy < maxDist; dy++) {
      for (let dx = -maxDist; dx < maxDist; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= maxDist) continue;
        const x = cx + dx;
        const y = cy + dy;
        const obj = world.GetObjectFromPosition(x, y);
        if (!obj) continue;
        if (typeof obj.$Id === "undefined") continue;
        const key = x * 1e5 + y;
        if (!output.has(key)) {
          output.set(key, { id: obj.$Id, object: obj, x, y, distance: dist });
        }
      }
    }
    return output;
  }
  function getAllNearbyObjects() {
    const allCities = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities();
    const combined = /* @__PURE__ */ new Map();
    for (const city of Object.values(allCities.d)) {
      const nearby = getObjectsNearCity(city);
      for (const [key, obj] of nearby) {
        if (!combined.has(key)) combined.set(key, obj);
      }
    }
    return Array.from(combined.values());
  }
  async function waitForCity(cityId, maxAttempts = 30) {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    for (let i = 0; i < maxAttempts; i++) {
      const city = cities.GetCity(cityId);
      if (city && !city.get_IsGhostMode() && city.GetBuildingsConditionInPercent() > 0) {
        return city;
      }
      await new Promise((r) => setTimeout(r, 50 + 5 * i));
      if (i > 3) {
        try {
          const comm = ClientLib.Net.CommunicationManager.GetInstance();
          if (typeof comm.$Poll === "function") comm.$Poll();
        } catch {
        }
      }
    }
    return null;
  }

  // plugins/camp-tracker.js
  var DEFAULTS = {
    size: 24,
    font: "Iosevka Term",
    fontsize: 20,
    offense: -1,
    count: 10,
    alert: true
  };
  var CampTracker = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descCampTracker");
    }
    constructor(config, cli) {
      this.name = "CampTracker";
      this.config = config;
      this.running = false;
      this.markers = /* @__PURE__ */ new Map();
      this._firstUpdate = true;
      this._updateTimer = null;
      this._lastStep = -1;
      this._events = [];
      this._onRegionChange = () => this._updatePositions();
      this._onSectorUpdate = () => this._scheduleUpdate();
      this._onCitiesChange = () => this._scheduleUpdate();
    }
    async start() {
      this.running = true;
      try {
        const rc = ClientLib.Vis.Region.RegionNPCBase.prototype;
        if (rc.get_BaseLevelFloat && !rc._st_patched_baselevel) {
          rc.get_BaseLevel = rc.get_BaseLevelFloat;
          rc._st_patched_baselevel = true;
        }
      } catch {
      }
      try {
        const rc2 = ClientLib.Vis.Region.RegionNPCCamp.prototype;
        if (rc2.get_BaseLevelFloat && !rc2._st_patched_baselevel) {
          rc2.get_BaseLevel = rc2.get_BaseLevelFloat;
          rc2._st_patched_baselevel = true;
        }
      } catch {
      }
      const visMain = ClientLib.Vis.VisMain.GetInstance();
      const region = visMain.get_Region();
      const md = ClientLib.Data.MainData.GetInstance();
      this._attachEvent(region, "PositionChange", ClientLib.Vis.PositionChange, this._onRegionChange);
      this._attachEvent(region, "ZoomFactorChange", ClientLib.Vis.ZoomFactorChange, this._onRegionChange);
      this._attachEvent(region, "SectorUpdated", ClientLib.Vis.Region.SectorUpdated, this._onSectorUpdate);
      this._attachEvent(md.get_Cities(), "Change", ClientLib.Data.CitiesChange, this._onCitiesChange);
      this._doUpdate();
      console.log("[ST] CampTracker: started");
    }
    stop() {
      this.running = false;
      for (const ev of this._events) {
        try {
          webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb);
        } catch {
        }
      }
      this._events = [];
      for (const [, marker] of this.markers) {
        marker.el.remove();
      }
      this.markers.clear();
      if (this._updateTimer) {
        cancelAnimationFrame(this._updateTimer);
        this._updateTimer = null;
      }
    }
    /** Get a config value with default fallback. */
    _cfg(key) {
      return this.config.get(`camptracker.${key}`, DEFAULTS[key]);
    }
    /** Attach a ClientLib event and track for cleanup. */
    _attachEvent(source, name, type, cb) {
      this._events.push({ source, name, type, cb });
      webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
    }
    /** Schedule an update on next animation frame (debounced). */
    _scheduleUpdate() {
      if (this._updateTimer) return;
      const serverStep = ClientLib.Data.MainData.GetInstance().get_Time().GetServerStep();
      if (serverStep === this._lastStep) return;
      this._lastStep = serverStep;
      this._updateTimer = requestAnimationFrame(() => {
        this._updateTimer = null;
        this._doUpdate();
      });
    }
    /** Main update: find camps, manage markers, alert on new spawns. */
    _doUpdate() {
      const mainCity = getMainCity();
      if (!mainCity) return;
      const offLevel = parseInt(mainCity.get_LvlOffense());
      const minLevel = offLevel + this._cfg("offense");
      const maxCount = this._cfg("count");
      const alertEnabled = this._cfg("alert");
      const nearby = getObjectsNearCity(mainCity);
      const camps = [];
      for (const entry of nearby.values()) {
        const obj = entry.object;
        if (typeof obj.$CampType === "undefined") continue;
        if (obj.$CampType === 0) continue;
        if (typeof obj.$Level !== "undefined" && obj.$Level < minLevel) continue;
        camps.push({ ...entry, campType: obj.$CampType, level: obj.$Level });
      }
      const newest = camps.sort((a, b) => b.id - a.id).slice(0, maxCount);
      const keepIds = /* @__PURE__ */ new Set();
      newest.forEach((camp, index) => {
        keepIds.add(camp.id);
        const existing = this.markers.get(camp.id);
        if (existing) {
          existing.index = index;
          existing.x = camp.x;
          existing.y = camp.y;
        } else {
          this._addMarker(camp.id, camp.x, camp.y, index);
          if (!this._firstUpdate && alertEnabled && index === 0) {
            const type = t(camp.campType === 2 ? "campTypeCamp" : "campTypeOutpost");
            const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("de-DE", { hour12: false });
            const cx = Math.round(camp.x);
            const cy = Math.round(camp.y);
            const coord = `<a style="color:${webfrontend.gui.util.BBCode.clrLink};cursor:pointer;" onClick="webfrontend.gui.UtilView.centerCoordinatesOnRegionViewWindow(${cx},${cy});">${cx}:${cy}</a>`;
            chatMessage(`[ST] ${t("campSpawned", { time, level: camp.level || "?", type, coord })}`);
          }
        }
      });
      this._firstUpdate = false;
      for (const [cityId, marker] of this.markers) {
        if (!keepIds.has(cityId)) {
          marker.el.remove();
          this.markers.delete(cityId);
        }
      }
      this._updatePositions();
    }
    /** Create a marker DOM element and track it. */
    _addMarker(cityId, x, y, index) {
      const el = document.createElement("div");
      el.title = t("markerTitle", { id: cityId });
      this._applyStyle(el);
      this.markers.set(cityId, { el, x, y, index });
      this._updateElement(el, x, y, index);
      this._addToDom(el);
    }
    /** Apply CSS styling to a marker element. */
    _applyStyle(el) {
      const size = this._cfg("size");
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        fontFamily: this._cfg("font"),
        fontWeight: "bold",
        fontSize: this._cfg("fontsize") + "px",
        zIndex: "10",
        borderRadius: "50%",
        width: size + "px",
        height: size + "px",
        padding: "2px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        border: "2px solid rgba(0,0,0,0.87)"
      });
    }
    /** Update a single marker element's position and label. */
    _updateElement(el, x, y, index) {
      const visMain = ClientLib.Vis.VisMain.GetInstance();
      const region = visMain.get_Region();
      const gw = region.get_GridWidth();
      const gh = region.get_GridHeight();
      const screenTop = visMain.ScreenPosFromWorldPosY((y + 0.1) * gh);
      const screenLeft = visMain.ScreenPosFromWorldPosX((x + 0.1) * gw);
      const viewH = region.get_ViewHeight();
      const viewW = region.get_ViewWidth();
      if (screenTop < 0 || screenLeft < 0 || screenTop > viewH || screenLeft > viewW) {
        if (el.parentElement) el.remove();
        return;
      }
      el.style.top = screenTop + "px";
      el.style.left = screenLeft + "px";
      if (el.getAttribute("st-idx") !== String(index)) {
        el.innerHTML = "#" + (index + 1);
        el.style.backgroundColor = index < 3 ? "rgba(0,240,0,0.9)" : "rgba(200,240,0,0.9)";
        el.setAttribute("st-idx", String(index));
      }
      if (!el.parentElement) this._addToDom(el);
    }
    /** Update positions of all markers (called on scroll/zoom). */
    _updatePositions() {
      for (const [, { el, x, y, index }] of this.markers) {
        this._updateElement(el, x, y, index);
      }
    }
    /** Append a marker to the game's canvas parent. */
    _addToDom(el) {
      try {
        const canvas = document.querySelector("canvas");
        if (canvas && canvas.parentElement) {
          canvas.parentElement.appendChild(el);
        }
      } catch {
      }
    }
  };

  // plugins/kill-info.js
  var PANEL_ID3 = "mehrstrom-killinfo-panel";
  var RES_TIB = 2;
  var RES_CRY = 6;
  var PLAYER_FACTIONS = [1, 2];
  var plunderCache = /* @__PURE__ */ new Map();
  var KillInfo = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descKillInfo");
    }
    constructor(config, cli) {
      this.name = "KillInfo";
      this.config = config;
      this.cli = cli;
      this.running = false;
      this._panel = null;
      this._content = null;
    }
    async start() {
      this.running = true;
      this.cli.register("plunder", () => this.toggle());
    }
    stop() {
      this.running = false;
      if (this._panel) {
        this._panel.remove();
        this._panel = null;
        this._content = null;
      }
    }
    /** `/st plunder`: close the panel if open, otherwise show it for the selected FG base. */
    toggle() {
      if (this._isOpen()) {
        this._hide();
        return;
      }
      const city = getSelectedForgottenCity();
      const units = city ? getDefenseUnits(city) : [];
      if (!city || !units.length) {
        chatMessage(`[ST] ${t("plunderSelectFirst")}`);
        return;
      }
      this._ensurePanel();
      this._content.innerHTML = renderPanel(city, units);
      this._panel.style.display = "block";
      const { tib, cry } = getTotals(city, units);
      chatMessage(`[ST] ${t("plunderChat", { name: city.get_Name(), level: Math.floor(city.get_LvlBase()), tib: fmt(tib), cry: fmt(cry) })}`);
    }
    _isOpen() {
      return !!this._panel && this._panel.style.display !== "none";
    }
    _hide() {
      if (this._panel) this._panel.style.display = "none";
    }
    _ensurePanel() {
      if (this._panel && document.body.contains(this._panel)) return this._panel;
      const panel = document.createElement("div");
      panel.id = PANEL_ID3;
      panel.style.cssText = `
            display: none;
            position: fixed;
            right: 0px;
            bottom: 40px;
            z-index: 9999;
            width: 360px;
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.88);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 8px 10px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
      const close = document.createElement("div");
      close.textContent = "\u2715";
      close.title = t("close");
      close.style.cssText = "position:absolute;top:4px;right:8px;cursor:pointer;color:#999;font-size:13px;line-height:1;";
      close.addEventListener("click", () => this._hide());
      close.addEventListener("mouseenter", () => {
        close.style.color = "#fff";
      });
      close.addEventListener("mouseleave", () => {
        close.style.color = "#999";
      });
      const content = document.createElement("div");
      content.style.paddingRight = "14px";
      panel.appendChild(close);
      panel.appendChild(content);
      document.body.appendChild(panel);
      this._panel = panel;
      this._content = content;
      return panel;
    }
  };
  function getPlunder(unitId, level, forgotten = true) {
    const cacheKey = `${unitId}:${level}:${forgotten ? 1 : 0}`;
    if (plunderCache.has(cacheKey)) return plunderCache.get(cacheKey);
    let result = null;
    const gd = typeof GAMEDATA !== "undefined" && GAMEDATA.units && GAMEDATA.units[unitId];
    if (gd && gd.r) {
      const keys = Object.keys(gd.r).filter((k) => gd.r[k] != null).map(Number).sort((a, b) => a - b);
      if (keys.length) {
        const eligible = keys.filter((k) => k <= level);
        const useLvl = eligible.length ? eligible[eligible.length - 1] : keys[keys.length - 1];
        const entry = gd.r[useLvl];
        const costs = forgotten ? entry.rer || entry.rr : entry.rr || entry.rer;
        let tib = 0, cry = 0;
        for (const c of costs || []) {
          if (c.t === RES_TIB) tib += c.c;
          else if (c.t === RES_CRY) cry += c.c;
        }
        result = { tib, cry };
      }
    }
    plunderCache.set(cacheKey, result);
    return result;
  }
  function getSelectedForgottenCity() {
    const md = ClientLib.Data.MainData.GetInstance();
    const cities = md.get_Cities();
    let city = null;
    try {
      const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
      if (sel && typeof sel.get_Id === "function") city = cities.GetCity(sel.get_Id());
    } catch {
    }
    if (!city) {
      try {
        city = cities.get_CurrentCity();
      } catch {
      }
    }
    if (!city || city.get_IsGhostMode()) return null;
    if (PLAYER_FACTIONS.includes(city.get_CityFaction())) return null;
    return city;
  }
  function getDefenseUnits(city) {
    const data = city.get_CityUnitsData();
    if (!data) return [];
    const def = data.$DefenseUnits;
    return def && def.d ? Object.values(def.d) : [];
  }
  function renderPanel(city, units) {
    const forgotten = !PLAYER_FACTIONS.includes(city.get_CityFaction());
    const rows = /* @__PURE__ */ new Map();
    let totalTib = 0, totalCry = 0;
    for (const unit of units) {
      const id = unit.get_MdbUnitId();
      const level = unit.get_CurrentLevel();
      const plunder = getPlunder(id, level, forgotten);
      if (!plunder) continue;
      const key = `${id}:${level}`;
      let row = rows.get(key);
      if (!row) {
        const gd = GAMEDATA.units[id];
        row = { name: gd ? gd.dn : `Unit ${id}`, level, count: 0, tib: 0, cry: 0 };
        rows.set(key, row);
      }
      row.count++;
      row.tib += plunder.tib;
      row.cry += plunder.cry;
      totalTib += plunder.tib;
      totalCry += plunder.cry;
    }
    const sorted = [...rows.values()].sort((a, b) => b.tib + b.cry - (a.tib + a.cry));
    const td = "padding:1px 4px;";
    const num = td + "text-align:right;";
    let html = `<div style="font-weight:bold;margin-bottom:6px;color:#fff;">\u2694 ${t("plunderTitle")} \u2014 ${escapeHtml2(city.get_Name())}</div>`;
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr style="color:#999;"><th style="${td}text-align:left;">${t("plunderUnit")}</th><th style="${num}">${t("plunderLevel")}</th><th style="${num}">#</th><th style="${num}color:#8bc34a;">${t("plunderTib")}</th><th style="${num}color:#42a5f5;">${t("plunderCrystal")}</th></tr>`;
    for (const r of sorted) {
      html += `<tr><td style="${td}">${escapeHtml2(r.name)}</td><td style="${num}">${r.level}</td><td style="${num}">${r.count}</td><td style="${num}">${fmt(r.tib)}</td><td style="${num}">${fmt(r.cry)}</td></tr>`;
    }
    html += `<tr style="border-top:1px solid #555;font-weight:bold;"><td style="${td}" colspan="3">${t("plunderTotal")}</td><td style="${num}color:#8bc34a;">${fmt(totalTib)}</td><td style="${num}color:#42a5f5;">${fmt(totalCry)}</td></tr>`;
    html += "</table>";
    return html;
  }
  function getTotals(city, units) {
    const forgotten = !PLAYER_FACTIONS.includes(city.get_CityFaction());
    let tib = 0, cry = 0;
    for (const unit of units) {
      const plunder = getPlunder(unit.get_MdbUnitId(), unit.get_CurrentLevel(), forgotten);
      if (!plunder) continue;
      tib += plunder.tib;
      cry += plunder.cry;
    }
    return { tib, cry };
  }
  function fmt(n) {
    return Math.round(n).toLocaleString("de-DE");
  }
  function escapeHtml2(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // plugins/player-status.js
  var PLAYER_COLORS = {
    0: "#5a5653",
    // Offline
    1: "#76ff03",
    // Online
    2: "#ffd600",
    // Away
    3: "#ffff00"
    // Hidden
  };
  var RELATION_COLORS = {
    1: "#76ff03",
    // Friend
    2: "#bbdefb",
    // NAP
    3: "#f44336"
    // Foe
  };
  var OWN_COLOR = "#00bcd4";
  var DEFAULT_COLOR = "#ffffff";
  function getPlayerColor(playerId, allianceId) {
    const md = ClientLib.Data.MainData.GetInstance();
    const alliance = md.get_Alliance();
    const myAllianceId = alliance.get_Id();
    if (md.get_Player().id === playerId) {
      return OWN_COLOR;
    }
    if (myAllianceId > 0 && myAllianceId === allianceId) {
      try {
        const memberData = alliance.get_MemberData().d[playerId];
        if (memberData) {
          return PLAYER_COLORS[memberData.OnlineState] || "#c8c800";
        }
      } catch {
      }
      return "#c8c800";
    }
    try {
      const relation = alliance.GetRelation(allianceId);
      if (RELATION_COLORS[relation]) {
        return RELATION_COLORS[relation];
      }
    } catch {
    }
    return DEFAULT_COLOR;
  }
  var PlayerStatus = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descPlayerStatus");
    }
    constructor() {
      this.name = "PlayerStatus";
      this.running = false;
      this._patchedNames = [];
      this._oldFunctions = {};
      this._refreshInterval = null;
      this._events = [];
    }
    async start() {
      const proto = ClientLib.Data.BaseColors.prototype;
      const obfName = this._findObfuscatedName(proto);
      if (!obfName && typeof proto.GetBaseColor !== "function") {
        console.warn("[ST] PlayerStatus: BaseColors function not found \u2014 feature disabled");
        this.running = true;
        return;
      }
      const toReplace = [];
      if (obfName && typeof proto[obfName] === "function") toReplace.push(obfName);
      if (typeof proto.GetBaseColor === "function") toReplace.push("GetBaseColor");
      for (const name of toReplace) {
        this._oldFunctions[name] = proto[name];
        proto[name] = getPlayerColor;
        this._patchedNames.push(name);
      }
      const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
      this._attachEvent(alliance, "Change", ClientLib.Data.AllianceChange, () => {
        try {
          ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
        } catch {
        }
      });
      this._refreshInterval = setInterval(() => {
        try {
          ClientLib.Data.MainData.GetInstance().get_Alliance().RefreshMemberData();
        } catch {
        }
      }, 3e4);
      try {
        ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
      } catch {
      }
      this.running = true;
      console.log(`[ST] PlayerStatus: started (patched: ${this._patchedNames.join(", ")})`);
    }
    stop() {
      const proto = ClientLib.Data.BaseColors.prototype;
      for (const name of this._patchedNames) {
        if (this._oldFunctions[name]) {
          proto[name] = this._oldFunctions[name];
        }
      }
      this._patchedNames = [];
      this._oldFunctions = {};
      for (const ev of this._events) {
        try {
          webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb);
        } catch {
        }
      }
      this._events = [];
      if (this._refreshInterval) {
        clearInterval(this._refreshInterval);
        this._refreshInterval = null;
      }
      try {
        ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
      } catch {
      }
      this.running = false;
    }
    _attachEvent(source, name, type, cb) {
      this._events.push({ source, name, type, cb });
      webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
    }
    /**
     * Find the obfuscated function name by looking at proto keys.
     * The obfuscated name (6 uppercase letters) sits right before
     * 'GetBaseColor' in the prototype key list.
     */
    _findObfuscatedName(proto) {
      const keys = Object.keys(proto);
      const idx = keys.indexOf("GetBaseColor");
      if (idx <= 0) return null;
      const candidate = keys[idx - 1];
      if (/^[A-Z]{6}$/.test(candidate) && typeof proto[candidate] === "function") {
        return candidate;
      }
      return null;
    }
  };

  // lib/packer.js
  var BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var BASE62_SEP = ".";
  var BASE = BASE62_CHARS.length;
  var DECODE_TABLE = {};
  for (let i = 0; i < BASE62_CHARS.length; i++) {
    DECODE_TABLE[BASE62_CHARS.charCodeAt(i)] = i;
  }
  var Base62 = {
    encode(num, padLength = 0) {
      if (num === 0 && padLength <= 1) return BASE62_CHARS[0];
      const output = [];
      let current = num;
      while (current > 0) {
        output.push(BASE62_CHARS[current % BASE]);
        current = Math.floor(current / BASE);
      }
      while (output.length < padLength) {
        output.push(BASE62_CHARS[0]);
      }
      return output.join("");
    },
    decode(str, offset = 0, maxBytes = 6) {
      let multiplier = 1;
      let value = 0;
      let bytes = 0;
      for (let i = 0; i < maxBytes; i++) {
        bytes++;
        const idx = offset + i;
        if (idx >= str.length) break;
        const code = str.charCodeAt(idx);
        if (code === BASE62_SEP.charCodeAt(0)) break;
        const charValue = DECODE_TABLE[code];
        if (charValue === void 0) break;
        value += multiplier * charValue;
        multiplier *= BASE;
      }
      return { value, bytes };
    },
    /** Pack an array of numbers into a separator-joined string. */
    pack(data) {
      return data.map((n) => this.encode(n)).join(BASE62_SEP);
    },
    /** Unpack a separator-joined string into an array of numbers. */
    unpack(str) {
      const output = [];
      let offset = 0;
      while (offset < str.length) {
        const { value, bytes } = this.decode(str, offset);
        output.push(value);
        offset += bytes;
      }
      return output;
    }
  };
  var LayoutPacker = {
    pack(tiles) {
      let output = 0;
      for (let x = 0; x < tiles.length; x++) {
        output |= tiles[x] << 3 * x;
      }
      return output;
    }
  };
  var BinaryPacker = class {
    constructor(format) {
      this.fields = [];
      let offset = 0;
      for (const [name, length] of Object.entries(format)) {
        const mask = (1 << length) - 1;
        this.fields.push({ name, length, offset, mask });
        offset += length;
      }
    }
    pack(values) {
      let output = 0;
      for (const field of this.fields) {
        const value = values[field.name] || 0;
        output |= (value & field.mask) << field.offset;
      }
      return output;
    }
  };
  var UnitPacker = new BinaryPacker({ xy: 8, id: 9, level: 7 });
  function packUnitXY(x, y) {
    return y * 9 + x;
  }

  // lib/scanner-util.js
  function extractScan(city) {
    try {
      const md = ClientLib.Data.MainData.GetInstance();
      const player = md.get_Player();
      const server = md.get_Server();
      return {
        city_id: city.get_Id(),
        world_id: server.get_WorldId(),
        world_name: server.get_Name() || "",
        x: city.get_PosX(),
        y: city.get_PosY(),
        name: city.get_Name(),
        owner: city.get_OwnerName() || player.name,
        owner_id: city.get_OwnerId(),
        alliance: getAllianceName(city, md),
        alliance_id: getAllianceId(city, md),
        faction: city.get_CityFaction(),
        level_base: city.get_LvlBase(),
        level_off: city.get_LvlOffense(),
        level_def: city.get_LvlDefense(),
        tiles: getLayout(city),
        buildings: getBuildings(city),
        ...getUnits(city),
        unit_names: getUnitNames(city),
        upgrades: getUpgrades(city),
        scanned_by: player.name,
        version: city.get_Version(),
        timestamp: Date.now()
      };
    } catch (e) {
      console.warn("[ST] extractScan failed:", e);
      return null;
    }
  }
  function getAllianceName(city, md) {
    if (city.get_OwnerId() === md.get_Player().id) {
      const alliance = md.get_Alliance();
      return alliance ? alliance.get_Name() : "";
    }
    return city.get_OwnerAllianceName() || "";
  }
  function getAllianceId(city, md) {
    if (city.get_OwnerId() === md.get_Player().id) {
      const alliance = md.get_Alliance();
      return alliance ? alliance.get_Id() : 0;
    }
    return city.get_OwnerAllianceId() || 0;
  }
  function getLayout(city) {
    const rows = [];
    for (let y = 0; y < 16; y++) {
      const row = [];
      for (let x = 0; x < 9; x++) {
        row.push(city.GetResourceType(x, y));
      }
      rows.push(LayoutPacker.pack(row));
    }
    return Base62.pack(rows);
  }
  function getBuildings(city) {
    try {
      const buildings = city.get_Buildings();
      if (!buildings || !buildings.d) return "";
      const packed = Object.values(buildings.d).map((unit) => packUnit(unit));
      return Base62.pack(packed);
    } catch {
      return "";
    }
  }
  function getUnits(city) {
    try {
      const units = city.get_CityUnitsData();
      if (!units) return { defense_units: "", offense_units: "" };
      const defUnits = units.$DefenseUnits;
      const offUnits = units.$OffenseUnits;
      const faction = city.get_CityFaction();
      const def = defUnits && defUnits.d ? Base62.pack(Object.values(defUnits.d).map((u) => packUnit(u))) : "";
      const off = (faction === 1 || faction === 2) && offUnits && offUnits.d ? Base62.pack(Object.values(offUnits.d).map((u) => packUnit(u))) : "";
      return { defense_units: def, offense_units: off };
    } catch {
      return { defense_units: "", offense_units: "" };
    }
  }
  function packUnit(unit) {
    const xy = packUnitXY(unit.get_CoordX(), unit.get_CoordY());
    return UnitPacker.pack({
      xy,
      id: unit.get_MdbUnitId(),
      level: unit.get_CurrentLevel()
    });
  }
  function getUnitNames(city) {
    const names = {};
    try {
      const units = city.get_CityUnitsData();
      if (!units) return names;
      for (const list of [units.$DefenseUnits, units.$OffenseUnits]) {
        if (!list || !list.d) continue;
        for (const u of Object.values(list.d)) {
          try {
            const id = u.get_MdbUnitId();
            if (names[id]) continue;
            const entry = readUnitName(u, id);
            if (entry) names[id] = entry;
          } catch {
          }
        }
      }
    } catch {
    }
    return names;
  }
  function readUnitName(unit, id) {
    const sources = [
      () => unit.get_UnitGameData_Obj(),
      () => GAMEDATA.units[id],
      () => ClientLib.Res.ResMain.GetInstance().GetUnit_Obj(id)
    ];
    for (const src of sources) {
      let info = null;
      try {
        info = src();
      } catch {
        continue;
      }
      if (!info) continue;
      const name = typeof info.n === "string" ? info.n.slice(0, 60) : "";
      const displayName = typeof info.dn === "string" ? info.dn.slice(0, 60) : "";
      if (name || displayName) return { name, displayName };
    }
    return null;
  }
  function getUpgrades(city) {
    try {
      if (city.IsOwnBase()) {
        return getPlayerResearch();
      }
      const modules = city.get_ActiveModules();
      if (!modules) return {};
      const upgrades = {};
      for (const mod of modules) {
        const unitMod = getUnitModule(mod);
        if (!unitMod) continue;
        const { id, level } = unitMod;
        if (!upgrades[id] || upgrades[id] < level) {
          upgrades[id] = level;
        }
      }
      return upgrades;
    } catch {
      return {};
    }
  }
  function getPlayerResearch() {
    try {
      const research = ClientLib.Data.MainData.GetInstance().get_Player().get_PlayerResearch();
      const output = {};
      for (const type of [1, 2]) {
        for (const re of research.GetResearchItemListByType(type).l) {
          if (re.get_CurrentLevel() === 0) continue;
          output[re.get_GameDataUnit_Obj().i] = re.get_CurrentLevel();
        }
      }
      return output;
    } catch {
      return {};
    }
  }
  var _unitModuleCache = /* @__PURE__ */ new Map();
  function getUnitModule(moduleId) {
    if (_unitModuleCache.size === 0) {
      try {
        for (const unit of Object.values(GAMEDATA.units)) {
          for (const mod of unit.m) {
            _unitModuleCache.set(mod.i, {
              id: unit.i,
              level: mod.r.length === 0 ? 1 : 2
            });
          }
        }
      } catch {
      }
    }
    return _unitModuleCache.get(moduleId) || null;
  }
  var scanLockOwner = null;
  function acquireScanLock(owner) {
    if (scanLockOwner && scanLockOwner !== owner) return false;
    scanLockOwner = owner;
    return true;
  }
  function releaseScanLock(owner) {
    if (scanLockOwner === owner) scanLockOwner = null;
  }
  function scanLockHolder() {
    return scanLockOwner;
  }

  // plugins/layout-scanner.js
  var SCAN_DELAY_MS = 2e3;
  var SCAN_INTERVAL_MS = 36e5;
  var scannedVersions = /* @__PURE__ */ new Map();
  var LayoutScanner = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descLayoutScanner");
    }
    constructor(config, cli, apiClient, idleDetect, onlineWatch) {
      this.name = "LayoutScanner";
      this.config = config;
      this.cli = cli;
      this.api = apiClient;
      this.idle = idleDetect;
      this.online = onlineWatch;
      this.running = false;
      this._scanning = false;
      this._scanInterval = null;
    }
    async start() {
      this.cli.register("scan", () => {
        if (!this.api.isConfigured) {
          chatMessage(`[ST] ${t("scanNotConfigured")}`);
          return;
        }
        if (this._scanning) {
          chatMessage(`[ST] ${t("scanInProgress")}`);
          return;
        }
        chatMessage(`[ST] ${t("scanManualStarted")}`);
        this.scanAll();
      });
      if (!this.api.isConfigured) {
        console.log("[ST] LayoutScanner: no API configured \u2014 scanner inactive");
        chatMessage(`[ST] ${t("scanNoServer")}`);
        this.running = true;
        return;
      }
      const consentShown = this.config.get("layoutscanner.consent", false);
      if (!consentShown) {
        chatMessage(`[ST] ${t("scanConsent", { url: this.api._url })}`);
        this.config.set("layoutscanner.consent", true);
      }
      this.idle.on("idle", () => this._autoScan());
      this.online.on("resume", () => this._autoScan());
      this._scanInterval = setInterval(() => this._autoScan(), SCAN_INTERVAL_MS);
      this.running = true;
      console.log("[ST] LayoutScanner: started (server: " + this.api._url + ")");
    }
    stop() {
      this.running = false;
      if (this._scanInterval) {
        clearInterval(this._scanInterval);
        this._scanInterval = null;
      }
    }
    /** Automatic trigger: only when idle and not paused by the online status. */
    _autoScan() {
      if (!this.running || !this.idle.isIdle || this.online.isPaused) return;
      this.scanAll();
    }
    /** Scan all nearby FG objects. */
    async scanAll() {
      if (this._scanning) return;
      if (!this.api.isConfigured) return;
      if (!acquireScanLock(this.name)) return;
      this._scanning = true;
      const startTime = Date.now();
      let scanned = 0;
      let skipped = 0;
      let originalCityId = null;
      try {
        const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
        originalCityId = cities.get_CurrentCityId();
      } catch {
      }
      try {
        const nearbyObjects = getAllNearbyObjects();
        for (const obj of nearbyObjects) {
          if (obj.object.Type !== 2 && obj.object.Type !== 3) continue;
          if (typeof obj.object.$CampType !== "undefined" && obj.object.$CampType === 0) continue;
          const cityId = obj.id;
          try {
            const existingCity = ClientLib.Data.MainData.GetInstance().get_Cities().GetCity(cityId);
            if (existingCity) {
              const version2 = existingCity.get_Version();
              if (scannedVersions.get(cityId) === version2) {
                skipped++;
                continue;
              }
            }
          } catch {
          }
          const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
          cities.set_CurrentCityId(cityId);
          const city = await waitForCity(cityId, 20);
          if (!city) continue;
          const version = city.get_Version();
          if (scannedVersions.get(cityId) === version) {
            skipped++;
            continue;
          }
          const payload = extractScan(city);
          if (!payload) continue;
          this.api.send(payload);
          scannedVersions.set(cityId, version);
          scanned++;
          await sleep3(SCAN_DELAY_MS);
        }
        await this.api.flush();
        const duration = ((Date.now() - startTime) / 1e3).toFixed(1);
        if (scanned > 0) {
          chatMessage(`[ST] ${t("scanComplete", { scanned, skipped, duration })}`);
        }
        console.log(`[ST] LayoutScanner: ${scanned} sent, ${skipped} skipped, ${duration}s`);
      } catch (e) {
        console.error("[ST] LayoutScanner error:", e);
        chatMessage(`[ST] ${t("scanFailed", { error: e.message })}`);
      } finally {
        if (originalCityId) {
          try {
            ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(originalCityId);
          } catch {
          }
        }
        this._scanning = false;
        releaseScanLock(this.name);
      }
    }
  };
  function sleep3(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // plugins/alliance-scanner.js
  var SCAN_DELAY_MS2 = 2e3;
  var SCAN_INTERVAL_MS2 = 36e5;
  var PLAYER_INFO_DELAY_MS = 300;
  var PLAYER_INFO_TIMEOUT_MS = 1e4;
  var LOCK_WAIT_MS = 5e3;
  var LOCK_WAIT_MAX = 120;
  var scannedVersions2 = /* @__PURE__ */ new Map();
  var AllianceScanner = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descAllianceScanner");
    }
    constructor(config, cli, apiClient, idleDetect, onlineWatch) {
      this.name = "AllianceScanner";
      this.config = config;
      this.cli = cli;
      this.api = apiClient;
      this.idle = idleDetect;
      this.online = onlineWatch;
      this.running = false;
      this._scanning = false;
      this._scanInterval = null;
    }
    async start() {
      this.cli.register("scanalliance", () => {
        if (!this.api.isConfigured) {
          chatMessage(`[ST] ${t("allianceScanNotConfigured")}`);
          return;
        }
        if (this._scanning) {
          chatMessage(`[ST] ${t("allianceScanInProgress")}`);
          return;
        }
        const holder = scanLockHolder();
        if (holder) {
          chatMessage(`[ST] ${t("allianceScanLocked", { holder })}`);
          return;
        }
        chatMessage(`[ST] ${t("allianceScanStarted")}`);
        this.scanAll({ manual: true });
      });
      if (!this.api.isConfigured) {
        console.log("[ST] AllianceScanner: no API configured \u2014 scanner inactive");
        this.running = true;
        return;
      }
      this.idle.on("idle", () => this._scanWhenFree());
      this.online.on("resume", () => this._scanWhenFree());
      this._scanInterval = setInterval(() => this._scanWhenFree(), SCAN_INTERVAL_MS2);
      this.running = true;
      console.log("[ST] AllianceScanner: started (server: " + this.api._url + ")");
    }
    stop() {
      this.running = false;
      if (this._scanInterval) {
        clearInterval(this._scanInterval);
        this._scanInterval = null;
      }
    }
    /**
     * Automatic trigger (idle / interval / online-resume): only when idle and
     * not paused by the online status; waits for another scanner (e.g.
     * LayoutScanner) to finish first.
     */
    async _scanWhenFree() {
      const allowed = () => this.running && this.idle.isIdle && !this.online.isPaused;
      if (!allowed()) return;
      for (let i = 0; i < LOCK_WAIT_MAX && scanLockHolder(); i++) {
        await sleep4(LOCK_WAIT_MS);
        if (!allowed()) return;
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
      let originalCityId = null;
      try {
        originalCityId = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCityId();
      } catch {
      }
      try {
        const cityIds = await getAllianceCityIds();
        const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
        for (const cityId of cityIds) {
          if (!manual && !this.idle.isIdle) {
            aborted = true;
            break;
          }
          try {
            const existingCity = cities.GetCity(cityId);
            if (existingCity && scannedVersions2.get(cityId) === existingCity.get_Version()) {
              skipped++;
              continue;
            }
          } catch {
          }
          cities.set_CurrentCityId(cityId);
          const city = await waitForCity(cityId, 20);
          if (!city) continue;
          const version = city.get_Version();
          if (scannedVersions2.get(cityId) === version) {
            skipped++;
            continue;
          }
          const payload = extractScan(city);
          if (!payload) continue;
          this.api.send(payload);
          scannedVersions2.set(cityId, version);
          scanned++;
          await sleep4(SCAN_DELAY_MS2);
        }
        await this.api.flush();
        const duration = ((Date.now() - startTime) / 1e3).toFixed(1);
        if (manual || scanned > 0) {
          chatMessage(`[ST] ${t("allianceScanComplete", { scanned, skipped, duration })}`);
        }
        console.log(`[ST] AllianceScanner: ${scanned} sent, ${skipped} skipped, ${duration}s${aborted ? " (aborted: player active)" : ""}`);
      } catch (e) {
        console.error("[ST] AllianceScanner error:", e);
        chatMessage(`[ST] ${t("allianceScanFailed", { error: e.message })}`);
      } finally {
        if (originalCityId) {
          try {
            ClientLib.Data.MainData.GetInstance().get_Cities().set_CurrentCityId(originalCityId);
          } catch {
          }
        }
        this._scanning = false;
        releaseScanLock(this.name);
      }
    }
  };
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
      await sleep4(PLAYER_INFO_DELAY_MS);
    }
    return ids;
  }
  function getPublicPlayerInfo(playerId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), PLAYER_INFO_TIMEOUT_MS);
      try {
        ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand(
          "GetPublicPlayerInfo",
          { id: playerId },
          webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, null, (context, data) => {
            clearTimeout(timer);
            resolve(data || null);
          }),
          null
        );
      } catch (e) {
        clearTimeout(timer);
        console.warn("[ST] AllianceScanner: GetPublicPlayerInfo failed", e);
        resolve(null);
      }
    });
  }
  function sleep4(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // plugins/repair-guard.js
  var REPAIR_ALL_FN = /^RepairAll/;
  var REPAIR_ALL_TEXT = /repair\s*all|alle[s]?\s*repar|tout\s*r[ée]parer/i;
  var NOTIFY_INTERVAL_MS = 3e3;
  var RepairGuard = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descRepairGuard");
    }
    constructor(config) {
      this.name = "RepairGuard";
      this.defaultEnabled = false;
      this.config = config;
      this.running = false;
      this._patches = [];
      this._lastNotify = 0;
    }
    async start() {
      this.running = true;
      const fnCount = this._patchRepairFunctions();
      const btnPatched = this._patchButtons();
      chatMessage(`[ST] ${t("repairGuardEnabled")}`);
      console.log(`[ST] RepairGuard: started (functions: ${fnCount}, button fallback: ${btnPatched})`);
    }
    stop() {
      for (const p of this._patches) {
        p.proto[p.key] = p.original;
      }
      this._patches = [];
      this.running = false;
      console.log("[ST] RepairGuard: stopped");
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return t("repairGuardStatusOff");
      return t("repairGuardStatusOn", { count: this._patches.length });
    }
    /** Wrap every RepairAll* method (plus its obfuscated aliases) on city prototypes. */
    _patchRepairFunctions() {
      let count = 0;
      for (const proto of this._cityPrototypes()) {
        const keys = Object.keys(proto);
        const targets = /* @__PURE__ */ new Set();
        for (const key of keys) {
          if (REPAIR_ALL_FN.test(key) && typeof proto[key] === "function") {
            targets.add(proto[key]);
          }
        }
        for (const fn of targets) {
          for (const key of keys) {
            if (proto[key] !== fn) continue;
            this._wrap(proto, key, () => () => {
              this._notifyBlocked();
              return void 0;
            });
            count++;
          }
        }
      }
      return count;
    }
    /** Wrap qooxdoo Button.execute so only "Repair All" buttons are refused. */
    _patchButtons() {
      let proto;
      try {
        proto = qx.ui.form.Button.prototype;
      } catch {
        return false;
      }
      if (typeof proto.execute !== "function") return false;
      const guard = this;
      this._wrap(proto, "execute", (original) => function(...args) {
        if (isRepairAllButton(this)) {
          guard._notifyBlocked();
          return void 0;
        }
        return original.apply(this, args);
      });
      return true;
    }
    /** Replace proto[key] with makeWrapper(original) and remember the original. */
    _wrap(proto, key, makeWrapper) {
      const original = proto[key];
      this._patches.push({ proto, key, original });
      proto[key] = makeWrapper(original);
    }
    _cityPrototypes() {
      const protos = [];
      const candidates = [
        () => ClientLib.Data.City.prototype,
        () => ClientLib.Data.CityUnits.prototype,
        () => ClientLib.Data.CityBuildings.prototype
      ];
      for (const get of candidates) {
        try {
          const p = get();
          if (p) protos.push(p);
        } catch {
        }
      }
      return protos;
    }
    _notifyBlocked() {
      const now = Date.now();
      if (now - this._lastNotify < NOTIFY_INTERVAL_MS) return;
      this._lastNotify = now;
      chatMessage(`[ST] ${t("repairGuardBlocked")}`);
    }
  };
  function isRepairAllButton(btn) {
    const texts = [];
    try {
      texts.push(String(btn.getLabel() || ""));
    } catch {
    }
    try {
      texts.push(String(btn.getToolTipText() || ""));
    } catch {
    }
    return texts.some((t2) => REPAIR_ALL_TEXT.test(t2));
  }

  // plugins/upgrade-calc.js
  var PANEL_ID4 = "st-upgradecalc-panel";
  var BUTTON_ID = "st-upgradecalc-button";
  var RES_TIB2 = 1;
  var RES_POWER = 5;
  var VIEW_CHECK_INTERVAL_MS = 1e3;
  var REFRESH_INTERVAL_MS = 3e4;
  var UpgradeCalc = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descUpgradeCalc");
    }
    constructor(config) {
      this.name = "UpgradeCalc";
      this.defaultEnabled = false;
      this.config = config;
      this.running = false;
      this._panel = null;
      this._content = null;
      this._button = null;
      this._viewTimer = null;
      this._refreshTimer = null;
      this._viewKey = null;
    }
    async start() {
      this.running = true;
      this._ensureButton();
      this._checkView();
      this._viewTimer = setInterval(() => this._checkView(), VIEW_CHECK_INTERVAL_MS);
    }
    stop() {
      this.running = false;
      this._hide();
      if (this._viewTimer) {
        clearInterval(this._viewTimer);
        this._viewTimer = null;
      }
      for (const el of [this._panel, this._button]) {
        if (el) el.remove();
      }
      this._panel = null;
      this._content = null;
      this._button = null;
      this._viewKey = null;
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return "/st plugin enable upgradecalc";
      return t(this._isOpen() ? "upgradeCalcStatusOpen" : "upgradeCalcStatusButton");
    }
    /** Button click: close the panel if open, otherwise show it for the current own city. */
    toggle() {
      if (this._isOpen()) {
        this._hide();
        return;
      }
      const city = getViewedOwnCity();
      if (!city) return;
      this._ensurePanel();
      this._render(city);
      this._panel.style.display = "block";
      this._refreshTimer = setInterval(() => {
        const current = getViewedOwnCity();
        if (current) this._render(current);
      }, REFRESH_INTERVAL_MS);
    }
    /** Show the button only on own bases; close the panel when the view/base changes. */
    _checkView() {
      const city = getViewedOwnCity();
      const key = city ? String(city.get_Id()) : null;
      if (key !== this._viewKey) {
        this._viewKey = key;
        this._hide();
      }
      if (this._button) this._button.style.display = city ? "block" : "none";
    }
    _render(city) {
      try {
        this._content.innerHTML = renderPanel2(city, getUpgradeRows(city));
      } catch (err) {
        console.error("[ST] UpgradeCalc: render failed", err);
        this._content.innerHTML = `<div style="color:#e57373;">${escapeHtml3(t("upgradeCalcError", { error: err.message }))}</div>`;
      }
    }
    _isOpen() {
      return !!this._panel && this._panel.style.display !== "none";
    }
    _hide() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._panel) this._panel.style.display = "none";
    }
    _ensureButton() {
      if (this._button && document.body.contains(this._button)) return this._button;
      const css = (v) => typeof v === "number" ? `${v}px` : v;
      const left = this.config.get("UpgradeCalc.buttonLeft", 80);
      const top = this.config.get("UpgradeCalc.buttonTop", 10);
      const btn = document.createElement("div");
      btn.id = BUTTON_ID;
      btn.textContent = "UC";
      btn.title = "Upgrade Calculator";
      btn.style.cssText = `
            display: none;
            position: fixed;
            left: ${css(left)};
            top: ${css(top)};
            z-index: 9999;
            width: 32px;
            height: 32px;
            line-height: 32px;
            text-align: center;
            background: rgba(20, 20, 20, 0.88);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            pointer-events: auto;
        `;
      btn.addEventListener("click", () => this.toggle());
      btn.addEventListener("mouseenter", () => {
        btn.style.color = "#fff";
        btn.style.borderColor = "#888";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.color = "#ddd";
        btn.style.borderColor = "#444";
      });
      document.body.appendChild(btn);
      this._button = btn;
      return btn;
    }
    _ensurePanel() {
      if (this._panel && document.body.contains(this._panel)) return this._panel;
      const panel = document.createElement("div");
      panel.id = PANEL_ID4;
      panel.style.cssText = `
            display: none;
            position: fixed;
            left: 0px;
            bottom: 40px;
            z-index: 9999;
            width: 440px;
            max-height: 60vh;
            overflow-y: auto;
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.88);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 8px 10px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
      const close = document.createElement("div");
      close.textContent = "\u2715";
      close.title = t("close");
      close.style.cssText = "position:absolute;top:4px;right:8px;cursor:pointer;color:#999;font-size:13px;line-height:1;";
      close.addEventListener("click", () => this._hide());
      close.addEventListener("mouseenter", () => {
        close.style.color = "#fff";
      });
      close.addEventListener("mouseleave", () => {
        close.style.color = "#999";
      });
      const content = document.createElement("div");
      content.style.paddingRight = "14px";
      panel.appendChild(close);
      panel.appendChild(content);
      document.body.appendChild(panel);
      this._panel = panel;
      this._content = content;
      return panel;
    }
  };
  function getViewedOwnCity() {
    try {
      const vis = ClientLib.Vis.VisMain.GetInstance();
      if (vis.get_Mode() !== ClientLib.Vis.Mode.City) return null;
      const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
      const own = cities.get_CurrentOwnCity();
      const viewed = cities.get_CurrentCity();
      if (!own || !viewed || own.get_Id() !== viewed.get_Id()) return null;
      return own;
    } catch {
      return null;
    }
  }
  function getUpgradeRows(city) {
    const stock = { tib: city.GetResourceCount(RES_TIB2), power: city.GetResourceCount(RES_POWER) };
    const rate = {
      tib: city.GetResourceGrowPerHour(RES_TIB2, true, true),
      power: city.GetResourceGrowPerHour(RES_POWER, true, true)
    };
    const rows = [];
    for (const { name, buildings } of getBuildingsByType(city)) {
      buildings.forEach((b, i) => {
        if (b.HasReachedMaxLevel()) return;
        const level = b.get_CurrentLevel();
        const cost = getUpgradeCost(b, level + 1);
        if (!cost) return;
        const hours = Math.max(
          hoursNeeded(cost.tib, stock.tib, rate.tib),
          hoursNeeded(cost.power, stock.power, rate.power)
        );
        rows.push({
          name: buildings.length > 1 ? `${name} ${i + 1}` : name,
          level,
          tib: cost.tib,
          power: cost.power,
          hours
        });
      });
    }
    rows.sort((a, b) => a.hours - b.hours || a.tib + a.power - (b.tib + b.power));
    return { rows, stock, rate };
  }
  function getBuildingsByType(city) {
    const bd = city.get_CityBuildingsData();
    const techNames = ClientLib.Base.ETechName;
    const seen = /* @__PURE__ */ new Set();
    const groups = [];
    const values = [...new Set(Object.values(techNames).filter((v) => typeof v === "number"))];
    for (const tech of values) {
      let buildings = [];
      try {
        buildings = toArray(bd.GetAllBuildingsByTechName(tech));
      } catch {
      }
      if (!buildings.length) {
        try {
          const unique = bd.GetUniqueBuildingByTechName(tech);
          if (unique) buildings = [unique];
        } catch {
        }
      }
      buildings = buildings.filter((b) => b && !seen.has(b));
      if (!buildings.length) continue;
      buildings.forEach((b) => seen.add(b));
      groups.push({ name: buildingName(buildings[0], tech), buildings });
    }
    return groups;
  }
  function getUpgradeCost(building, level) {
    const tgd = building.get_TechGameData_Obj();
    if (!tgd) return null;
    const reqs = ClientLib.Base.Util.GetTechLevelResourceRequirements_Obj(level, tgd);
    if (!reqs || !reqs.length) return null;
    let tib = 0, power = 0;
    for (const r of reqs) {
      if (r.Type === RES_TIB2) tib += r.Count;
      else if (r.Type === RES_POWER) power += r.Count;
    }
    return { tib, power };
  }
  function hoursNeeded(cost, stock, perHour) {
    const missing = cost - stock;
    if (missing <= 0) return 0;
    if (!(perHour > 0)) return Infinity;
    return missing / perHour;
  }
  function buildingName(building, tech) {
    try {
      const tgd = building.get_TechGameData_Obj();
      if (tgd && typeof tgd.dn === "string" && tgd.dn) return tgd.dn;
      if (tgd && typeof tgd.n === "string" && tgd.n && !/^\d+$/.test(tgd.n)) return tgd.n;
    } catch {
    }
    const key = Object.keys(ClientLib.Base.ETechName).find((k) => ClientLib.Base.ETechName[k] === tech);
    return key ? key.replace(/_/g, " ") : `Tech ${tech}`;
  }
  function toArray(coll) {
    if (!coll) return [];
    if (Array.isArray(coll)) return coll;
    if (Array.isArray(coll.l)) return coll.l;
    if (coll.d) return Object.values(coll.d);
    return [];
  }
  function renderPanel2(city, { rows, stock, rate }) {
    const td = "padding:1px 4px;";
    const num = td + "text-align:right;white-space:nowrap;";
    const tibColor = "color:#8bc34a;";
    const powColor = "color:#ffca28;";
    const perHour = t("upgradeCalcPerHour");
    let html = `<div style="font-weight:bold;margin-bottom:4px;color:#fff;">\u{1F527} ${t("upgradeCalcTitle")} \u2014 ${escapeHtml3(city.get_Name())}</div>`;
    html += `<div style="margin-bottom:6px;color:#aaa;"><span style="${tibColor}">${t("upgradeCalcTib")}</span> ${fmt2(stock.tib)} (+${fmt2(rate.tib)}${perHour}) \xB7 <span style="${powColor}">${t("upgradeCalcPower")}</span> ${fmt2(stock.power)} (+${fmt2(rate.power)}${perHour})</div>`;
    if (!rows.length) {
      return html + `<div style="color:#999;">${t("upgradeCalcAllMax")}</div>`;
    }
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr style="color:#999;"><th style="${td}text-align:left;">${t("upgradeCalcBuilding")}</th><th style="${num}">${t("upgradeCalcLevel")}</th><th style="${num}${tibColor}">${t("upgradeCalcTib")}</th><th style="${num}${powColor}">${t("upgradeCalcPower")}</th><th style="${num}">${t("upgradeCalcTime")}</th></tr>`;
    for (const r of rows) {
      const ready = r.hours === 0;
      html += `<tr><td style="${td}">${escapeHtml3(r.name)}</td><td style="${num}">${r.level}\u2192${r.level + 1}</td><td style="${num}">${fmt2(r.tib)}</td><td style="${num}">${fmt2(r.power)}</td><td style="${num}${ready ? "color:#8bc34a;font-weight:bold;" : ""}">${fmtHours(r.hours)}</td></tr>`;
    }
    html += "</table>";
    return html;
  }
  function fmtHours(h) {
    if (h === 0) return t("upgradeCalcReady");
    if (!isFinite(h)) return "\u221E";
    const totalMin = Math.ceil(h * 60);
    return t("upgradeCalcHours", { h: Math.floor(totalMin / 60), m: String(totalMin % 60).padStart(2, "0") });
  }
  function fmt2(n) {
    return Math.round(n).toLocaleString("de-DE");
  }
  function escapeHtml3(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // plugins/target-watcher.js
  var POLL_INTERVAL_MS = 2500;
  var POST_MIN_INTERVAL_MS = 5e3;
  var NAME_MAX_LENGTH = 50;
  var PLAYER_FACTIONS2 = [1, 2];
  var BASE_VIEW_MODES = ["City", "CombatSetup", "Battleground"];
  var TargetWatcher = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descTargetWatcher");
    }
    constructor(config, apiClient) {
      this.name = "TargetWatcher";
      this.defaultEnabled = false;
      this.config = config;
      this.api = apiClient;
      this.running = false;
      this._timer = null;
      this._currentId = null;
      this._current = null;
      this._posted = false;
      this._lastPostAt = 0;
      this._postCount = 0;
    }
    async start() {
      this.running = true;
      if (!this.api.isConfigured) {
        chatMessage(`[ST] ${t("targetWatcherNoServer")}`);
      }
      this._tick();
      this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
      console.log("[ST] TargetWatcher: started");
    }
    stop() {
      this.running = false;
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      this._currentId = null;
      this._current = null;
      this._posted = false;
      console.log("[ST] TargetWatcher: stopped");
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return "/st plugin enable target-watcher";
      if (!this.api.isConfigured) return t("targetWatcherStatusNoServer");
      const count = this._postCount;
      if (!this._current) return t("targetWatcherStatusIdle", { count });
      const { targetName: target, targetX: x, targetY: y } = this._current;
      return t("targetWatcherStatusWatching", { target, x, y, count });
    }
    _tick() {
      if (!this.running || !this.api.isConfigured) return;
      if (scanLockHolder()) return;
      const target = getViewedTarget();
      const id = target ? target.targetId : null;
      if (id !== this._currentId) {
        this._currentId = id;
        this._current = target;
        this._posted = false;
      }
      if (!target || this._posted) return;
      if (!(target.targetX >= 0 && target.targetY >= 0)) return;
      if (Date.now() - this._lastPostAt < POST_MIN_INTERVAL_MS) return;
      this._posted = true;
      this._lastPostAt = Date.now();
      this._report(target);
    }
    /** POST the watch, then show who else is watching this target. */
    async _report(target) {
      const ok = await this.api.request("POST", "/api/target-watch", target);
      if (ok) this._postCount++;
      const data = await this.api.request("GET", `/api/target-watch/${target.worldId}/${target.targetId}`);
      if (!data || this._currentId !== target.targetId) return;
      const others = toWatcherList(data).filter((w) => w && Number(w.playerId) !== target.playerId);
      if (!others.length) return;
      const name = (w) => escapeHtml4(w.playerName || "?");
      const targetName = escapeHtml4(target.targetName);
      if (others.length === 1) {
        chatMessage(`[ST] ${t("targetWatcherWarning", { player: name(others[0]), target: targetName, since: since(others[0].timestamp) })}`);
      } else {
        const names = others.map((w) => `${name(w)}${since(w.timestamp)}`).join(", ");
        chatMessage(`[ST] ${t("targetWatcherWarningMulti", { players: names, target: targetName })}`);
      }
    }
  };
  function getViewedTarget() {
    try {
      const vis = ClientLib.Vis.VisMain.GetInstance();
      const modes = BASE_VIEW_MODES.map((m) => ClientLib.Vis.Mode[m]).filter((m) => m !== void 0);
      if (!modes.includes(vis.get_Mode())) return null;
      const md = ClientLib.Data.MainData.GetInstance();
      const city = md.get_Cities().get_CurrentCity();
      if (!city || city.get_IsGhostMode()) return null;
      if (city.IsOwnBase()) return null;
      const player = md.get_Player();
      const playerId = Number(typeof player.get_Id === "function" ? player.get_Id() : player.id) || 0;
      const playerName = String((typeof player.get_Name === "function" ? player.get_Name() : player.name) || "");
      if (!playerId || !playerName) return null;
      if (city.get_OwnerId() === playerId) return null;
      const faction = city.get_CityFaction();
      const alliance = md.get_Alliance();
      const myAllianceId = alliance ? alliance.get_Id() : 0;
      if (PLAYER_FACTIONS2.includes(faction) && myAllianceId && city.get_OwnerAllianceId() === myAllianceId) {
        return null;
      }
      const x = city.get_PosX();
      const y = city.get_PosY();
      const level = Math.floor(city.get_LvlBase());
      const type = getTargetType(x, y, faction);
      const label = { camp: "Camp", outpost: "Outpost", base: "FG Base", player: "Base" }[type];
      return {
        playerId,
        playerName: clip(playerName),
        targetId: Number(city.get_Id()),
        targetName: clip(city.get_Name() || `${label} L${level}`),
        targetX: Math.round(Number(x)),
        targetY: Math.round(Number(y)),
        targetLevel: Number.isFinite(level) ? level : 0,
        targetType: type,
        worldId: Number(md.get_Server().get_WorldId()),
        timestamp: Math.floor(Date.now() / 1e3)
      };
    } catch {
      return null;
    }
  }
  function getTargetType(x, y, faction) {
    if (PLAYER_FACTIONS2.includes(faction)) return "player";
    try {
      const obj = ClientLib.Data.MainData.GetInstance().get_World().GetObjectFromPosition(x, y);
      if (obj && obj.Type === 3) return obj.$CampType === 2 ? "camp" : "outpost";
    } catch {
    }
    return "base";
  }
  function clip(s) {
    return String(s).trim().slice(0, NAME_MAX_LENGTH);
  }
  function toWatcherList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.watchers)) return data.watchers;
    return [];
  }
  function since(ts) {
    const n = Number(ts);
    if (!n) return "";
    const ms = n < 1e12 ? n * 1e3 : n;
    const min = Math.max(0, Math.round((Date.now() - ms) / 6e4));
    return min < 1 ? t("targetWatcherSinceNow") : t("targetWatcherSince", { min });
  }
  function escapeHtml4(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // plugins/attack-tracker.js
  var POLL_INTERVAL_MS2 = 2 * 60 * 1e3;
  var FIRST_POLL_DELAY_MS = 15 * 1e3;
  var HEADER_TAKE = 50;
  var REQUEST_SPACING_MS = 1e3;
  var ANSWER_TIMEOUT_MS = 15 * 1e3;
  var MAX_ATTEMPTS = 3;
  var POST_MIN_INTERVAL_MS2 = 5e3;
  var POST_BATCH = 20;
  var MAX_POST_FAILURES = 5;
  var OUTBOX_MAX = 200;
  var DONE_MAX = 100;
  var BACKFILL_DAYS = 7;
  var OUTBOX_KEY = "st-attacks-outbox";
  var DONE_KEY_PREFIX = "st-attacks-done-";
  var REPORT_TYPE_NPC_RAID = 2;
  var CAMP_TYPES = { 1: "camp", 2: "camp", 3: "outpost", 4: "base" };
  var AttackTracker = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descAttackTracker");
    }
    constructor(config, apiClient) {
      this.name = "AttackTracker";
      this.config = config;
      this.api = apiClient;
      this.running = false;
      this._pollTimer = null;
      this._firstTimer = null;
      this._flushTimer = null;
      this._listener = false;
      this._pollBusy = false;
      this._pending = [];
      this._inFlight = null;
      this._lastRequestAt = 0;
      this._nextRequestTimer = null;
      this._lastPostAt = 0;
      this._posting = false;
      this._logged = 0;
    }
    async start() {
      this.running = true;
      this._firstTimer = setTimeout(() => this.poll(), FIRST_POLL_DELAY_MS);
      this._pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS2);
    }
    stop() {
      this.running = false;
      for (const timer of [this._firstTimer, this._flushTimer, this._nextRequestTimer]) {
        if (timer) clearTimeout(timer);
      }
      if (this._pollTimer) clearInterval(this._pollTimer);
      if (this._inFlight && this._inFlight.timer) clearTimeout(this._inFlight.timer);
      this._pollTimer = this._firstTimer = this._flushTimer = this._nextRequestTimer = null;
      this._pending = [];
      this._inFlight = null;
      this._pollBusy = false;
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.api.isConfigured) return t("attackTrackerStatusNoServer");
      return t("attackTrackerStatus", { count: this._logged, queued: loadOutbox().length });
    }
    // ─── Reports ─────────────────────────────────────────────────────
    /** Read the newest report headers and queue the new won FG attacks. */
    poll() {
      if (!this.running || this._pollBusy || !this.api.isConfigured) return;
      const util = gameUtil();
      let md, net, worldId;
      try {
        md = ClientLib.Data.MainData.GetInstance();
        net = ClientLib.Net.CommunicationManager.GetInstance();
        worldId = Number(md.get_Server().get_WorldId());
      } catch {
        return;
      }
      if (!util || !worldId || !this._ensureListener(md, util)) return;
      this._pollBusy = true;
      try {
        net.SendSimpleCommand(
          "GetReportHeaderAll",
          { type: 1, skip: 0, take: HEADER_TAKE, sort: 1, ascending: false },
          util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
            this._pollBusy = false;
            this._onHeaders(worldId, Array.isArray(data) ? data : []);
          }),
          null
        );
      } catch (e) {
        this._pollBusy = false;
        console.warn("[ST] AttackTracker: GetReportHeaderAll failed", e && e.message);
      }
      this.flush();
    }
    _onHeaders(worldId, headers) {
      if (!this.running) return;
      const state = loadDone(worldId);
      const fresh = headers.filter((h) => isLoggable(h) && h.t > state.cutoff && !state.done.some(([id]) => id === h.i) && !(this._inFlight && this._inFlight.header.i === h.i) && !this._pending.some((p) => p.header.i === h.i)).reverse();
      for (const h of fresh) this._pending.push({ header: h, worldId, attempts: 0 });
      this._processNext();
    }
    _ensureListener(md, util) {
      if (this._listener) return true;
      try {
        util.attachNetEvent(
          md.get_Reports(),
          "ReportDelivered",
          ClientLib.Data.Reports.ReportDelivered,
          this,
          (rep) => this._onDelivered(rep)
        );
        this._listener = true;
        return true;
      } catch (e) {
        console.warn("[ST] AttackTracker: ReportDelivered listener not attached", e && e.message);
        return false;
      }
    }
    /** Request the next report: one at a time, REQUEST_SPACING_MS apart. */
    _processNext() {
      if (!this.running || this._inFlight || this._nextRequestTimer || !this._pending.length) return;
      const wait = REQUEST_SPACING_MS - (Date.now() - this._lastRequestAt);
      if (wait > 0) {
        this._nextRequestTimer = setTimeout(() => {
          this._nextRequestTimer = null;
          this._processNext();
        }, wait);
        return;
      }
      const item = this._pending.shift();
      item.attempts++;
      this._inFlight = item;
      this._lastRequestAt = Date.now();
      item.timer = setTimeout(() => this._onTimeout(), ANSWER_TIMEOUT_MS);
      try {
        ClientLib.Data.MainData.GetInstance().get_Reports().RequestReportData(item.header.i);
      } catch (e) {
        clearTimeout(item.timer);
        this._onTimeout();
      }
    }
    /** ReportDelivered also fires when the player opens a report — only ours counts. */
    _onDelivered(rep) {
      const item = this._inFlight;
      let id;
      try {
        id = rep.get_Id();
      } catch {
        return;
      }
      if (!item || item.header.i !== id) return;
      clearTimeout(item.timer);
      this._inFlight = null;
      this._commit(item, readLoot(rep));
      this._processNext();
    }
    _onTimeout() {
      const item = this._inFlight;
      this._inFlight = null;
      if (!item) return;
      if (item.attempts < MAX_ATTEMPTS) {
        this._pending.push(item);
      } else {
        console.warn(`[ST] AttackTracker: report ${item.header.i} not delivered after ${item.attempts} attempts \u2014 logged without loot`);
        this._commit(item, { tib: 0, cry: 0, credits: 0 });
      }
      this._processNext();
    }
    /** Outbox first, then the done list: a crash in between can only re-send (server dedups), never lose. */
    _commit(item, loot) {
      const attack = buildAttack(item.header, item.worldId, loot);
      if (!attack) return;
      const outbox = loadOutbox();
      outbox.push({ attack, failures: 0 });
      saveOutbox(outbox.slice(-OUTBOX_MAX));
      markDone(item.worldId, item.header.i, item.header.t);
      this._scheduleFlush();
    }
    // ─── POST ────────────────────────────────────────────────────────
    _scheduleFlush() {
      if (this._flushTimer) return;
      const wait = Math.max(0, POST_MIN_INTERVAL_MS2 - (Date.now() - this._lastPostAt));
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this.flush();
      }, wait);
    }
    /** Send what the outbox holds — one POST, at most one per POST_MIN_INTERVAL_MS. */
    async flush() {
      if (!this.running || this._posting || !this.api.isConfigured) return;
      if (Date.now() - this._lastPostAt < POST_MIN_INTERVAL_MS2) {
        this._scheduleFlush();
        return;
      }
      const batch = loadOutbox().slice(0, POST_BATCH);
      if (!batch.length) return;
      this._posting = true;
      this._lastPostAt = Date.now();
      let result = null;
      try {
        result = await this.api.request("POST", "/api/attack", batch.map((e) => e.attack));
      } finally {
        this._posting = false;
      }
      const sent = new Set(batch.map((e) => attackKey(e.attack)));
      let outbox = loadOutbox();
      if (result) {
        outbox = outbox.filter((e) => !sent.has(attackKey(e.attack)));
        for (const { attack: a } of batch) {
          console.log(`[ST] Attack logged: ${a.targetType} lvl ${a.targetLevel} @ ${a.targetX}:${a.targetY}`);
        }
        this._logged += batch.length;
      } else {
        outbox = outbox.map((e) => sent.has(attackKey(e.attack)) ? { ...e, failures: (e.failures || 0) + 1 } : e).filter((e) => {
          if ((e.failures || 0) < MAX_POST_FAILURES) return true;
          console.warn(`[ST] AttackTracker: dropped after ${e.failures} failed POSTs`, e.attack);
          return false;
        });
      }
      saveOutbox(outbox);
      if (result && outbox.length) this._scheduleFlush();
    }
  };
  function isLoggable(h) {
    if (!h || h.i === void 0 || h.tp !== REPORT_TYPE_NPC_RAID || h.s !== true) return false;
    const ad = h.ad || {};
    return !!CAMP_TYPES[parseInt(ad.dbn, 10)] && Number.isFinite(Number(ad.dbx)) && Number.isFinite(Number(ad.dby)) && typeof h.t === "number";
  }
  function buildAttack(h, worldId, loot) {
    if (!isLoggable(h)) return null;
    const ad = h.ad;
    const level = Number(ad.dbl);
    return {
      targetType: CAMP_TYPES[parseInt(ad.dbn, 10)],
      targetLevel: Number.isFinite(level) && level >= 0 ? level : 0,
      targetX: Math.round(Number(ad.dbx)),
      targetY: Math.round(Number(ad.dby)),
      lootTib: nonNeg(loot.tib),
      lootCrystal: nonNeg(loot.cry),
      lootCredits: nonNeg(loot.credits),
      worldId: Number(worldId),
      timestamp: h.t,
      reportId: h.i
    };
  }
  function readLoot(rep) {
    const E = ClientLib.Base.EResourceType;
    const get = (name) => {
      try {
        return E[name] === void 0 ? 0 : rep.GetAttackerTotalResourceReceived(E[name]);
      } catch {
        return 0;
      }
    };
    return { tib: get("Tiberium"), cry: get("Crystal"), credits: get("Gold") };
  }
  function nonNeg(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  function attackKey(a) {
    return `${a.worldId}:${a.reportId}:${a.targetX}:${a.targetY}:${a.timestamp}`;
  }
  function gameUtil() {
    if (typeof webfrontend !== "undefined" && webfrontend.phe && webfrontend.phe.cnc && webfrontend.phe.cnc.Util) return webfrontend.phe.cnc.Util;
    if (typeof phe !== "undefined" && phe.cnc && phe.cnc.Util) return phe.cnc.Util;
    return null;
  }
  function loadOutbox() {
    try {
      const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function saveOutbox(outbox) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch {
    }
  }
  function loadDone(worldId) {
    try {
      const v = JSON.parse(localStorage.getItem(DONE_KEY_PREFIX + worldId) || "null");
      if (v && Array.isArray(v.done) && typeof v.cutoff === "number") return v;
    } catch {
    }
    return { cutoff: Date.now() - BACKFILL_DAYS * 86400 * 1e3, done: [] };
  }
  function markDone(worldId, id, time) {
    const state = loadDone(worldId);
    if (!state.done.some(([d]) => d === id)) state.done.push([id, time]);
    state.done.sort((a, b) => a[1] - b[1]);
    while (state.done.length > DONE_MAX) {
      const [, dropped] = state.done.shift();
      state.cutoff = Math.max(state.cutoff, dropped);
    }
    try {
      localStorage.setItem(DONE_KEY_PREFIX + worldId, JSON.stringify(state));
    } catch {
    }
  }

  // lib/main.js
  var ST_VERSION = "5.10.0";
  async function startup() {
    console.log(`[ST] Shockr TA Tools v${ST_VERSION} loading...`);
    const ready = await waitForGame({ maxAttempts: 200, intervalMs: 100 });
    if (!ready) {
      console.error("[ST] Game client did not load in time \u2014 aborting.");
      return;
    }
    const config = new Config("st-config");
    initI18n(config);
    const patchResults = applyPatches(PATCHES);
    const failed = patchResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      const names = failed.map((r) => r.name).join(", ");
      console.warn(`[ST] Patch failures: ${names}`);
      chatMessage(`[ST] ${t("patchFailed", { names })}`);
    }
    const cli = new Cli(config);
    const idle = new IdleDetect();
    const online = new OnlineStateWatch();
    const api = new ApiClient(config);
    const plugins = [
      new CampTracker(config, cli),
      new KillInfo(config, cli),
      new PlayerStatus(),
      new LayoutScanner(config, cli, api, idle, online),
      new AllianceScanner(config, cli, api, idle, online),
      new RepairGuard(config),
      new UpgradeCalc(config),
      new TargetWatcher(config, api),
      new AttackTracker(config, api)
    ];
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
        chatMessage(`[ST] ${t("pluginStartFailed", { name: plugin.name, error: err.message })}`);
      }
    }
    cli.register("plugin", (args) => {
      const [action, name] = args;
      const norm = (s) => (s || "").toLowerCase().replace(/[-_]/g, "");
      const plugin = plugins.find((p) => norm(p.name) === norm(name));
      if (!plugin) {
        chatMessage(`[ST] ${t("unknownPlugin", { names: plugins.map((p) => p.name).join(", ") })}`);
        return;
      }
      if (action === "enable") {
        config.set(`${plugin.name}.enabled`, true);
        if (!plugin.running) plugin.start();
        chatMessage(`[ST] ${t("pluginEnabledMsg", { name: plugin.name })}`);
      } else if (action === "disable") {
        config.set(`${plugin.name}.enabled`, false);
        if (plugin.running) plugin.stop();
        chatMessage(`[ST] ${t("pluginDisabledMsg", { name: plugin.name })}`);
      } else {
        chatMessage(`[ST] ${escapeHtml(t("pluginUsage"))}`);
      }
    });
    cli.register("status", () => {
      chatMessage(`[ST] ${t("statusHeader", { version: ST_VERSION })}`);
      for (const p of plugins) {
        const extra = typeof p.statusText === "function" ? ` \u2014 ${p.statusText()}` : "";
        chatMessage(`[ST] ${p.name}: ${t(p.running ? "pluginEnabled" : "pluginDisabled")}${extra}`);
      }
      const reg = { player: "registerStatusOn", shared: "registerStatusShared", none: "registerStatusOff" };
      chatMessage(`[ST] ${t(reg[api.registration])}`);
    });
    const registerPanel = new RegisterPanel(async (code) => {
      const result = await api.enroll(code);
      if (result.ok) chatMessage(`[ST] ${t("registerSuccessChat")}`);
      return result;
    });
    cli.register("register", () => registerPanel.open());
    cli.register("version", () => {
      chatMessage(`[ST] ${t("versionLine", { version: ST_VERSION })}`);
    });
    const helpPanel = new HelpPanel();
    cli.register("help", () => {
      if (config.get("help.popup", true)) {
        helpPanel.toggle(buildHelpPanel(ST_VERSION, plugins, cli.commands));
      } else {
        helpPanel.hide();
        chatMessage(buildHelp(ST_VERSION, plugins, cli.commands));
      }
    });
    cli.start();
    idle.start();
    online.start();
    fixUnload();
    chatMessage(`[ST] ${t("loaded", { version: ST_VERSION, active: plugins.filter((p) => p.running).length, total: plugins.length })}`);
    console.log(`[ST] v${ST_VERSION} ready`);
  }
  function chatMessage(msg) {
    try {
      const chat = qx.core.Init.getApplication().getChat().getChatWidget();
      chat.showMessage(
        `<font color="lightblue">${msg}</font>`,
        webfrontend.gui.chat.ChatWidget.sender.system,
        31
      );
    } catch (e) {
      console.warn("[ST] Chat not available:", msg);
    }
  }
  startup().catch((err) => console.error("[ST] Fatal:", err));
  return __toCommonJS(main_exports);
})();
