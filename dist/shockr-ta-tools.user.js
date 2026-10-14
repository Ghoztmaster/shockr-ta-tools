// ==UserScript==
// @name            Shockr - Tiberium Alliances Tools
// @author          Ghozt [SoO] (original: Shockr, fixed by NetquiK [SoO])
// @description     Camp tracker, kill info, player status, alliance recon, upgrade calculator, target watcher, attack tracker, watchlist, base info, attack range, map labels, tunnel info, formation saver, wavy, loot summary, chat helper & PvP alert for C&C Tiberium Alliances
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @grant           none
// @version         5.23.2
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
      this.isNew = true;
      this.load();
    }
    load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        this.isNew = !raw;
        if (raw) this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
    }
    /**
     * Pin `<plugin>.enabled` for plugins whose default changed, so the new default
     * only reaches fresh installs. Unset key: fresh install -> the plugin's current
     * default, existing install -> the old default from `legacyDefaults`. A key the
     * player set is never touched. After this runs the key is always stored,
     * so later startups (when isNew is false) can't flip it.
     * @param {Array<{name: string, defaultEnabled?: boolean}>} plugins
     * @param {Object<string, boolean>} legacyDefaults — plugin name -> old default
     */
    pinChangedDefaults(plugins, legacyDefaults) {
      for (const plugin of plugins) {
        if (!(plugin.name in legacyDefaults)) continue;
        const key = `${plugin.name}.enabled`;
        if (this.get(key) !== void 0) continue;
        this.set(key, this.isNew ? plugin.defaultEnabled !== false : legacyDefaults[plugin.name]);
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
      pluginUsage: "Usage: /st plugin list|enable|disable <name>",
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
      helpPluginList: "show all plugins (on/off)",
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
      helpSetColors: "shockr / maelstrom (default: shockr)",
      helpSetApiUrl: "Server URL for scanners/watcher",
      helpSetApiKey: "Shared alliance key (transition \u2014 use /st register)",
      helpSetButtonLeft: "UC button X position (px)",
      helpSetButtonTop: "UC button Y position (px)",
      helpSetPvpSound: "PvP Alert siren on/off (default: true)",
      helpHelp: "This message",
      helpCloseHint: "Press Escape, click \u2715 or type /st help again to close. Show help in the chat instead: /st config set help.popup false",
      // ── Plugin descriptions ──
      descCampTracker: "FG base markers on world map",
      descKillInfo: "Plunder panel for the selected FG base",
      descPlayerStatus: "Alliance base colors by online status",
      colorSchemeSet: "Color scheme set to: {scheme}",
      colorSchemeUnknown: "Unknown color scheme: {scheme} (choose: {schemes})",
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
      attackTrackerStatusNoServer: "no server configured (api.url / /st register)",
      descWatchList: "Claim Forgotten targets you intend to attack (/st watch) \u2014 visible to the alliance",
      descBaseInfo: "Offense/defense level + number (#1, #2\u2026) at player bases on the world map",
      descAttackRange: "Attack range circle around your own bases on the world map",
      baseInfoTitle: "Offense {off} \xB7 Defense {def}",
      baseInfoUnknown: "Levels unknown \u2014 select the base once to load them",
      scannerPausePaused: "Scanners: paused (you are online)",
      scannerPauseActive: "Scanners: active (you are away/offline)",
      scannerPauseUnknown: "Scanners: online status not readable \u2014 not paused",
      scannerPauseStopped: "Scanners: online watch not running",
      descMapLabels: "Who is viewing \u{1F441}, has claimed \u{1F4CC} or attacked \u2694 Forgotten targets, on the world map",
      descTunnelInfo: "Tunnel level, required offense and influence range on the world map",
      tunnelInfoTitle: "Tunnel level {level} \xB7 active from offense {required} \xB7 range {range}",
      descFormationSaver: "Save attack formations by name and load them back (/st formation)",
      formationUsage: "Usage: /st formation save|load|delete <name> \xB7 /st formation list",
      formationNotInSetup: "Open the attack setup of a target first",
      formationNoUnits: "No offense units in this formation",
      formationSaved: 'Formation "{name}" saved ({count} units)',
      formationOverwritten: 'Formation "{name}" overwritten ({count} units)',
      formationLoaded: 'Formation "{name}" loaded: {placed}/{total} units placed',
      formationMissing: "missing: {units}",
      formationNotFound: 'No formation "{name}" in this world',
      formationDeleted: 'Formation "{name}" deleted',
      formationListEmpty: "No saved formations in this world",
      formationListHeader: "Saved formations ({count}):",
      formationListLine: "{count} units \xB7 {base} \xB7 {date}",
      formationStorageFailed: "Could not save (browser storage unavailable)",
      helpCmdFormation: "Save/load attack formations",
      descWavy: "Forgotten attack waves per base: Forgotten bases in range, level distribution, waves + distance lines on the world map",
      descPoiAnalyser: "Alliance POI bonuses: POI labels on the world map (gold = yours), the active bonuses in the base info panel and the real gain/loss of a selected POI",
      descSectorHud: "Sector HUD on the world map: view coordinates + sector, and per sector the POIs held (own green, enemy red, free grey)",
      descMovableMenu: "Movable menus: drag game windows and menu overlays (alliance, mail, forum, \u2026) by their title bar; the position is remembered per window",
      movableMenuStatus: "{n} remembered window position(s)",
      descTransferAll: "Transfer All in the resource-transfer panel: pulls all tiberium and crystal from your other bases into the open base in one click (tick the box first: shows the cost)",
      transferAllButton: "Transfer All",
      transferAllTooltip: "Pull all tiberium and crystal from your other bases into this base",
      transferAllCheckTooltip: "Tick to show the total transfer cost and enable Transfer All",
      transferAllCost: "Cost: {cost}",
      transferAllSkippedFull: "{res} skipped (storage full)",
      transferAllSkippedCredits: "{n} base(s) skipped (not enough credits)",
      transferAllFailed: "{n} transfer(s) refused",
      descChatHelper: "Chat Helper: coordinates and urls in chat, mail and forum are tagged automatically ([coords] = clickable), Alt shortcuts for BB codes ([player], [alliance], [b], [i], [u], [s]) and a contact list for /whisper \u2014 type /chelp in the chat",
      chatHelperStatus: "{n} contact(s)",
      chatHelperHooked: "chat input hooked",
      chatHelperNotHooked: "chat input NOT found",
      chatHelperUrlPrompt: "Website (syntax: google.com or www.google.com)",
      chatHelperAddConfirm: "Add {name} to your contacts list?\n\nYou can see your contacts by typing /list",
      chatHelperAdded: "{name} added to your contacts",
      chatHelperAlready: "{name} is already in your contacts list",
      chatHelperNotInList: "{name} is not in your contacts list",
      chatHelperDelConfirm: "Really delete {name} from your contacts?",
      chatHelperDelAllConfirm: "Really delete ALL your contacts?",
      chatHelperDeleted: "{name} deleted from your contacts",
      chatHelperDeletedAll: "All contacts deleted",
      chatHelperEmptyPrompt: "Your contacts list is empty.\n\nType a name here to add a contact:",
      chatHelperListHeader: "{n} contact(s):",
      chatHelperHelp1: "Chat Helper \u2014 space in the chat tags coordinates (123:456) and urls before sending; Enter does it in mail/forum.",
      chatHelperHelp2: "Alt+1: tag coordinates/urls in a message or forum post \xB7 Alt+2: insert a url \xB7 Alt+0: remove all tags",
      chatHelperHelp3: "Alt+p or Alt+3: [player] \xB7 Alt+a or Alt+4: [alliance] \xB7 Alt+b bold \xB7 Alt+i italic \xB7 Alt+u underline \xB7 Alt+s strikethrough",
      chatHelperHelp4: "Tags go around the selection, or around the word at the cursor; in an empty box or after a space an empty pair is inserted.",
      chatHelperHelp5: "Shorthands: [p]name[/p] \u2192 [player], [a]name[/a] \u2192 [alliance]",
      chatHelperHelp6: 'Contacts: /list or /contacts \xB7 /add <name> \xB7 /del <name> \xB7 /del all \u2014 "/whisper <first letters>" completes a contact',
      descPvpAlert: "PvP Alert: when one of your bases is attacked while the game tab is in the background, the tab title and icon turn to ALERT and a siren sounds; resets when you return (siren: PvpAlert.sound)",
      pvpAlertTitle: "ALERT - Base {base} under attack!",
      pvpAlertStatusAlarm: "ALARM: base {base} under attack",
      pvpAlertStatusWatching: "watching your bases (siren {sound})",
      pvpAlertSoundOn: "on",
      pvpAlertSoundOff: "off",
      descLootSummary: "Loot Summary in the info panel of a Forgotten camp/outpost/base: lootable research, tiberium, crystal, credits and total, per CP and for the 2nd/3rd run, and the possible attacks from your current base",
      lootPossibleAttacks: "Possible attacks from this base (available CP)",
      lootLootable: "Lootable resources",
      lootPerCpRow: "per CP",
      loot2nd: "2nd run",
      loot3rd: "3rd run",
      lootCalculating: "Calculating resources...",
      lootOutOfRange: "Target out of range, no resource calculation possible",
      lootCpFrom: "{cp} CP from {base}",
      lootStatus: "{n} target(s) inspected",
      poiShort_tib: "Tib",
      poiShort_cry: "Cry",
      poiShort_pow: "Pow",
      poiShort_inf: "Inf",
      poiShort_veh: "Veh",
      poiShort_air: "Air",
      poiShort_def: "Def",
      poiName_tib: "Tiberium",
      poiName_cry: "Crystal",
      poiName_pow: "Power",
      poiName_inf: "Infantry",
      poiName_veh: "Vehicle",
      poiName_air: "Aircraft",
      poiName_def: "Resonator (defense)",
      poiTitle: "POI",
      poiAllianceBonus: "Alliance POI bonus (all bases):",
      poiNone: "No POI bonus",
      poiBonusLine: "{type} {bonus}",
      poiBonusLineRank: "{type} {bonus} (rank {rank})",
      poiLabelTitle: "{type} POI level {level} \xB7 score {score} \xB7 {owner}",
      poiOwnerNone: "not occupied",
      poiInfoLine: "{type} level {level} \xB7 score {score} \xB7 {owner}",
      poiRealGain: "Real gain: {value}",
      poiRealLoss: "Real loss: {value}",
      poiLoading: "loading\u2026",
      poiStatus: "{labels} POI label(s) \xB7 {types} bonus type(s) active",
      sectorHudPoi: "POI {own} own \xB7 {enemy} enemy \xB7 {free} free",
      sectorHudSeenNote: "Own POIs: complete list. Enemy/free: POIs seen on the map this session.",
      sectorHudClickNote: "Left click: coordinates into the chat \xB7 right click: jump to coordinates",
      sectorHudJumpPrompt: "Jump to coordinates (x:y):",
      sectorHudStatus: "{n} POI(s) seen this session",
      wavyTitle: "Wavy",
      wavyCount: "Forgotten bases within attack range: {count} ({countW}) \xB7 {waves} waves",
      wavyCountOne: "Forgotten bases within attack range: {count} ({countW}) \xB7 1 wave",
      wavyLevels: "Levels: {levels}",
      helpCmdWatch: "Claim the selected FG target (force: claim anyway)",
      helpCmdUnwatch: "Remove your claim on the selected target (all: every claim)",
      watchClaimed: "{type} lvl {level} @ {x}:{y} claimed",
      watchRefreshed: "{type} lvl {level} @ {x}:{y} claimed again (24 h from now)",
      watchAlsoClaimedBy: "(also claimed by {players})",
      watchConflict: "this target is already claimed by {players} \u2014 /st watch force to claim it anyway",
      watchClaimedBy: "This target is claimed by {players}",
      watchUnclaimed: "claim on {type} @ {x}:{y} removed",
      watchUnclaimedAll: "{count} claim(s) removed",
      watchNothingToRemove: "you have no claim on {x}:{y}",
      watchDefeated: "{type} @ {x}:{y} defeated \u2014 claim removed",
      watchSelectFirst: "select a Forgotten camp, outpost or base first (world map or base view)",
      watchOnlyForgotten: "only Forgotten targets (camp, outpost, base) can be claimed",
      watchNoServer: "no server configured \u2014 set api.url, then /st register",
      watchFailed: "request failed \u2014 see the console (F12)",
      watchStatus: "{own} own claim(s), {total} in the alliance",
      watchStatusNoServer: "no server configured (api.url / /st register)",
      watchAgoNow: "just now",
      watchAgoMin: "{n} min ago",
      watchAgoHour: "1 hour ago",
      watchAgoHours: "{n} hours ago"
    },
    de: {
      loaded: "v{version} geladen \u2014 {active}/{total} Plugins aktiv",
      patchFailed: "\u26A0 Patch fehlgeschlagen: {names} \u2014 einige Funktionen gehen evtl. nicht. Pr\xFCfe auf ein Script-Update.",
      pluginStartFailed: "\u26A0 {name} konnte nicht starten: {error}",
      unknownPlugin: "Unbekanntes Plugin. Verf\xFCgbar: {names}",
      pluginEnabledMsg: "{name} aktiviert",
      pluginDisabledMsg: "{name} deaktiviert",
      pluginUsage: "Verwendung: /st plugin list|enable|disable <name>",
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
      helpPluginList: "alle Plugins anzeigen (an/aus)",
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
      helpSetColors: "shockr / maelstrom (Standard: shockr)",
      helpSetApiUrl: "Server-URL f\xFCr Scanner/Watcher",
      helpSetApiKey: "Gemeinsamer Allianz-Key (\xDCbergang \u2014 nutze /st register)",
      helpSetButtonLeft: "UC-Button X-Position (px)",
      helpSetButtonTop: "UC-Button Y-Position (px)",
      helpSetPvpSound: "PvP-Alarm-Sirene an/aus (Standard: true)",
      helpHelp: "Diese Hilfe",
      helpCloseHint: "Schlie\xDFen mit Escape, \u2715 oder erneut /st help. Hilfe stattdessen im Chat: /st config set help.popup false",
      descCampTracker: "FG-Basis-Markierungen auf der Weltkarte",
      descKillInfo: "Pl\xFCnder-Panel f\xFCr die gew\xE4hlte FG-Basis",
      descPlayerStatus: "Allianz-Basisfarben nach Online-Status",
      colorSchemeSet: "Farbschema gesetzt auf: {scheme}",
      colorSchemeUnknown: "Unbekanntes Farbschema: {scheme} (Auswahl: {schemes})",
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
      attackTrackerStatusNoServer: "kein Server eingerichtet (api.url / /st register)",
      descWatchList: "Forgotten-Ziele reservieren, die du angreifen willst (/st watch) \u2014 f\xFCr die Allianz sichtbar",
      descBaseInfo: "Offensiv-/Defensivlevel + Nummer (#1, #2\u2026) an Spielerbasen auf der Weltkarte",
      descAttackRange: "Angriffsreichweite als Kreis um deine eigenen Basen auf der Weltkarte",
      baseInfoTitle: "Offensive {off} \xB7 Defensive {def}",
      baseInfoUnknown: "Level unbekannt \u2014 Basis einmal ausw\xE4hlen, um sie zu laden",
      scannerPausePaused: "Scanner: pausiert (du bist online)",
      scannerPauseActive: "Scanner: aktiv (du bist abwesend/offline)",
      scannerPauseUnknown: "Scanner: Online-Status nicht lesbar \u2014 nicht pausiert",
      scannerPauseStopped: "Scanner: Online-\xDCberwachung l\xE4uft nicht",
      descMapLabels: "Wer Forgotten-Ziele ansieht \u{1F441}, reserviert hat \u{1F4CC} oder angegriffen hat \u2694, auf der Weltkarte",
      descTunnelInfo: "Tunnel-Level, ben\xF6tigte Offensive und Einflussbereich auf der Weltkarte",
      tunnelInfoTitle: "Tunnel-Level {level} \xB7 aktiv ab Offensive {required} \xB7 Reichweite {range}",
      descFormationSaver: "Angriffsformationen unter einem Namen speichern und wieder laden (/st formation)",
      formationUsage: "Verwendung: /st formation save|load|delete <Name> \xB7 /st formation list",
      formationNotInSetup: "\xD6ffne zuerst die Angriffsaufstellung eines Ziels",
      formationNoUnits: "Keine Offensiveinheiten in dieser Formation",
      formationSaved: "Formation \u201E{name}\u201C gespeichert ({count} Einheiten)",
      formationOverwritten: "Formation \u201E{name}\u201C \xFCberschrieben ({count} Einheiten)",
      formationLoaded: "Formation \u201E{name}\u201C geladen: {placed}/{total} Einheiten platziert",
      formationMissing: "fehlt: {units}",
      formationNotFound: "Keine Formation \u201E{name}\u201C in dieser Welt",
      formationDeleted: "Formation \u201E{name}\u201C gel\xF6scht",
      formationListEmpty: "Keine gespeicherten Formationen in dieser Welt",
      formationListHeader: "Gespeicherte Formationen ({count}):",
      formationListLine: "{count} Einheiten \xB7 {base} \xB7 {date}",
      formationStorageFailed: "Speichern fehlgeschlagen (Browserspeicher nicht verf\xFCgbar)",
      helpCmdFormation: "Angriffsformationen speichern/laden",
      descWavy: "Forgotten-Angriffswellen pro Basis: Forgotten-Basen in Reichweite, Level-Verteilung, Wellen + Entfernungslinien auf der Weltkarte",
      descPoiAnalyser: "Allianz-POI-Boni: POI-Labels auf der Weltkarte (gold = eure), aktive Boni im Basis-Infofenster und der echte Gewinn/Verlust eines gew\xE4hlten POI",
      descSectorHud: "Sektor-HUD auf der Weltkarte: Ansichtskoordinaten + Sektor, und pro Sektor die gehaltenen POIs (eigene gr\xFCn, feindliche rot, freie grau)",
      descMovableMenu: "Verschiebbare Men\xFCs: Spielfenster und Men\xFC-Overlays (Allianz, Post, Forum, \u2026) an der Titelleiste verschieben; die Position wird pro Fenster gespeichert",
      movableMenuStatus: "{n} gespeicherte Fensterposition(en)",
      descTransferAll: "Alles transferieren im Ressourcen-Transferfenster: holt mit einem Klick alles Tiberium und Kristall aus deinen anderen Basen in die offene Basis (erst das K\xE4stchen anhaken: zeigt die Kosten)",
      transferAllButton: "Alles holen",
      transferAllTooltip: "Alles Tiberium und Kristall aus deinen anderen Basen in diese Basis holen",
      transferAllCheckTooltip: "Anhaken zeigt die gesamten Transferkosten und aktiviert den Knopf",
      transferAllCost: "Kosten: {cost}",
      transferAllSkippedFull: "{res} \xFCbersprungen (Lager voll)",
      transferAllSkippedCredits: "{n} Basis/Basen \xFCbersprungen (nicht genug Credits)",
      transferAllFailed: "{n} Transfer(s) abgelehnt",
      descChatHelper: "Chat Helper: Koordinaten und URLs in Chat, Post und Forum werden automatisch getaggt ([coords] = anklickbar), Alt-K\xFCrzel f\xFCr BB-Codes ([player], [alliance], [b], [i], [u], [s]) und eine Kontaktliste f\xFCr /whisper \u2014 tippe /chelp im Chat",
      chatHelperStatus: "{n} Kontakt(e)",
      chatHelperHooked: "Chat-Eingabe verbunden",
      chatHelperNotHooked: "Chat-Eingabe NICHT gefunden",
      chatHelperUrlPrompt: "Webseite (Syntax: google.com oder www.google.com)",
      chatHelperAddConfirm: "{name} zu deiner Kontaktliste hinzuf\xFCgen?\n\nDeine Kontakte siehst du mit /list",
      chatHelperAdded: "{name} zu deinen Kontakten hinzugef\xFCgt",
      chatHelperAlready: "{name} ist schon in deiner Kontaktliste",
      chatHelperNotInList: "{name} ist nicht in deiner Kontaktliste",
      chatHelperDelConfirm: "{name} wirklich aus deinen Kontakten l\xF6schen?",
      chatHelperDelAllConfirm: "Wirklich ALLE Kontakte l\xF6schen?",
      chatHelperDeleted: "{name} aus deinen Kontakten gel\xF6scht",
      chatHelperDeletedAll: "Alle Kontakte gel\xF6scht",
      chatHelperEmptyPrompt: "Deine Kontaktliste ist leer.\n\nGib hier einen Namen ein, um einen Kontakt hinzuzuf\xFCgen:",
      chatHelperListHeader: "{n} Kontakt(e):",
      chatHelperHelp1: "Chat Helper \u2014 Leertaste im Chat taggt Koordinaten (123:456) und URLs vor dem Senden; Enter tut das in Post/Forum.",
      chatHelperHelp2: "Alt+1: Koordinaten/URLs in Nachricht oder Forumsbeitrag taggen \xB7 Alt+2: URL einf\xFCgen \xB7 Alt+0: alle Tags entfernen",
      chatHelperHelp3: "Alt+p oder Alt+3: [player] \xB7 Alt+a oder Alt+4: [alliance] \xB7 Alt+b fett \xB7 Alt+i kursiv \xB7 Alt+u unterstrichen \xB7 Alt+s durchgestrichen",
      chatHelperHelp4: "Tags kommen um die Auswahl oder um das Wort am Cursor; in einem leeren Feld oder nach einem Leerzeichen wird ein leeres Paar eingef\xFCgt.",
      chatHelperHelp5: "K\xFCrzel: [p]Name[/p] \u2192 [player], [a]Name[/a] \u2192 [alliance]",
      chatHelperHelp6: 'Kontakte: /list oder /contacts \xB7 /add <Name> \xB7 /del <Name> \xB7 /del all \u2014 "/whisper <Anfangsbuchstaben>" erg\xE4nzt einen Kontakt',
      descPvpAlert: "PvP Alert: wird eine deiner Basen angegriffen, w\xE4hrend der Spiel-Tab im Hintergrund ist, zeigen Tab-Titel und -Symbol ALARM und eine Sirene ert\xF6nt; zur\xFCckgesetzt, sobald du zur\xFCckkommst (Sirene: PvpAlert.sound)",
      pvpAlertTitle: "ALARM - Basis {base} wird angegriffen!",
      pvpAlertStatusAlarm: "ALARM: Basis {base} wird angegriffen",
      pvpAlertStatusWatching: "\xFCberwacht deine Basen (Sirene {sound})",
      pvpAlertSoundOn: "an",
      pvpAlertSoundOff: "aus",
      descLootSummary: "Beute-\xDCbersicht im Infofenster eines Forgotten-Camps/-Au\xDFenpostens/-Basis: pl\xFCnderbare Forschung, Tiberium, Kristall, Credits und Summe, pro KP und f\xFCr den 2./3. Angriff, und die m\xF6glichen Angriffe von deiner aktuellen Basis",
      lootPossibleAttacks: "M\xF6gliche Angriffe (verf\xFCgbare KP)",
      lootLootable: "Pl\xFCnderbare Ressourcen",
      lootPerCpRow: "pro KP",
      loot2nd: "2. Angriff",
      loot3rd: "3. Angriff",
      lootCalculating: "Ressourcen werden berechnet...",
      lootOutOfRange: "Ziel au\xDFer Reichweite, keine Ressourcenberechnung m\xF6glich",
      lootCpFrom: "{cp} KP ab {base}",
      lootStatus: "{n} Ziel(e) angesehen",
      poiShort_tib: "Tib",
      poiShort_cry: "Kri",
      poiShort_pow: "Str",
      poiShort_inf: "Inf",
      poiShort_veh: "Fz",
      poiShort_air: "Luft",
      poiShort_def: "Def",
      poiName_tib: "Tiberium",
      poiName_cry: "Kristall",
      poiName_pow: "Strom",
      poiName_inf: "Infanterie",
      poiName_veh: "Fahrzeuge",
      poiName_air: "Luftwaffe",
      poiName_def: "Resonator (Verteidigung)",
      poiTitle: "POI",
      poiAllianceBonus: "Allianz-POI-Bonus (alle Basen):",
      poiNone: "Kein POI-Bonus",
      poiBonusLine: "{type} {bonus}",
      poiBonusLineRank: "{type} {bonus} (Rang {rank})",
      poiLabelTitle: "{type}-POI Level {level} \xB7 Punkte {score} \xB7 {owner}",
      poiOwnerNone: "nicht besetzt",
      poiInfoLine: "{type} Level {level} \xB7 Punkte {score} \xB7 {owner}",
      poiRealGain: "Echter Gewinn: {value}",
      poiRealLoss: "Echter Verlust: {value}",
      poiLoading: "l\xE4dt\u2026",
      poiStatus: "{labels} POI-Label(s) \xB7 {types} Bonusart(en) aktiv",
      sectorHudPoi: "POI {own} eigene \xB7 {enemy} feindl. \xB7 {free} frei",
      sectorHudSeenNote: "Eigene POIs: vollst\xE4ndige Liste. Feindlich/frei: in dieser Sitzung auf der Karte gesehene POIs.",
      sectorHudClickNote: "Linksklick: Koordinaten in den Chat \xB7 Rechtsklick: zu Koordinaten springen",
      sectorHudJumpPrompt: "Zu Koordinaten springen (x:y):",
      sectorHudStatus: "{n} POI(s) in dieser Sitzung gesehen",
      wavyTitle: "Wavy",
      wavyCount: "Forgotten-Basen in Angriffsreichweite: {count} ({countW}) \xB7 {waves} Wellen",
      wavyCountOne: "Forgotten-Basen in Angriffsreichweite: {count} ({countW}) \xB7 1 Welle",
      wavyLevels: "Level: {levels}",
      helpCmdWatch: "Ausgew\xE4hltes FG-Ziel reservieren (force: trotzdem reservieren)",
      helpCmdUnwatch: "Deine Reservierung des ausgew\xE4hlten Ziels entfernen (all: alle)",
      watchClaimed: "{type} Lv {level} @ {x}:{y} reserviert",
      watchRefreshed: "{type} Lv {level} @ {x}:{y} erneut reserviert (24 Std. ab jetzt)",
      watchAlsoClaimedBy: "(auch reserviert von {players})",
      watchConflict: "dieses Ziel ist bereits von {players} reserviert \u2014 /st watch force, um es trotzdem zu reservieren",
      watchClaimedBy: "Dieses Ziel ist reserviert von {players}",
      watchUnclaimed: "Reservierung f\xFCr {type} @ {x}:{y} entfernt",
      watchUnclaimedAll: "{count} Reservierung(en) entfernt",
      watchNothingToRemove: "du hast keine Reservierung auf {x}:{y}",
      watchDefeated: "{type} @ {x}:{y} besiegt \u2014 Reservierung entfernt",
      watchSelectFirst: "w\xE4hle zuerst ein Forgotten-Camp, -Outpost oder -Base aus (Weltkarte oder Basisansicht)",
      watchOnlyForgotten: "nur Forgotten-Ziele (Camp, Outpost, Base) k\xF6nnen reserviert werden",
      watchNoServer: "kein Server eingerichtet \u2014 setze api.url, dann /st register",
      watchFailed: "Anfrage fehlgeschlagen \u2014 siehe Konsole (F12)",
      watchStatus: "{own} eigene Reservierung(en), {total} in der Allianz",
      watchStatusNoServer: "kein Server eingerichtet (api.url / /st register)",
      watchAgoNow: "gerade eben",
      watchAgoMin: "vor {n} Min.",
      watchAgoHour: "vor 1 Stunde",
      watchAgoHours: "vor {n} Stunden"
    },
    nl: {
      loaded: "v{version} geladen \u2014 {active}/{total} plugins actief",
      patchFailed: "\u26A0 Patch mislukt: {names} \u2014 sommige functies werken mogelijk niet. Kijk of er een script-update is.",
      pluginStartFailed: "\u26A0 {name} kon niet starten: {error}",
      unknownPlugin: "Onbekende plugin. Beschikbaar: {names}",
      pluginEnabledMsg: "{name} aangezet",
      pluginDisabledMsg: "{name} uitgezet",
      pluginUsage: "Gebruik: /st plugin list|enable|disable <naam>",
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
      helpPluginList: "toon alle plugins (aan/uit)",
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
      helpSetColors: "shockr / maelstrom (standaard: shockr)",
      helpSetApiUrl: "Server-URL voor scanners/watcher",
      helpSetApiKey: "Gedeelde alliance-key (overgang \u2014 gebruik /st register)",
      helpSetButtonLeft: "UC-knop X-positie (px)",
      helpSetButtonTop: "UC-knop Y-positie (px)",
      helpSetPvpSound: "PvP Alert-sirene aan/uit (standaard: true)",
      helpHelp: "Dit bericht",
      helpCloseHint: "Sluiten met Escape, \u2715 of nogmaals /st help. Help liever in de chat: /st config set help.popup false",
      descCampTracker: "FG-base-markeringen op de wereldkaart",
      descKillInfo: "Plunder-paneel voor de geselecteerde FG-base",
      descPlayerStatus: "Alliance-basekleuren op online-status",
      colorSchemeSet: "Kleurschema ingesteld op: {scheme}",
      colorSchemeUnknown: "Onbekend kleurschema: {scheme} (kies: {schemes})",
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
      attackTrackerStatusNoServer: "geen server ingesteld (api.url / /st register)",
      descWatchList: "Forgotten-targets claimen die je wilt aanvallen (/st watch) \u2014 zichtbaar voor de alliance",
      descBaseInfo: "Offense-/defense-level + nummer (#1, #2\u2026) bij speler-bases op de wereldkaart",
      descAttackRange: "Aanvalsbereik als cirkel rond je eigen bases op de wereldkaart",
      baseInfoTitle: "Offense {off} \xB7 Defense {def}",
      baseInfoUnknown: "Levels onbekend \u2014 selecteer de base \xE9\xE9n keer om ze te laden",
      scannerPausePaused: "Scanners: gepauzeerd (je bent online)",
      scannerPauseActive: "Scanners: actief (je bent away/offline)",
      scannerPauseUnknown: "Scanners: online-status niet leesbaar \u2014 niet gepauzeerd",
      scannerPauseStopped: "Scanners: online-bewaking draait niet",
      descMapLabels: "Wie Forgotten-targets bekijkt \u{1F441}, geclaimd heeft \u{1F4CC} of aangevallen heeft \u2694, op de wereldkaart",
      descTunnelInfo: "Tunnel-level, benodigde offense en invloedsbereik op de wereldkaart",
      tunnelInfoTitle: "Tunnel level {level} \xB7 actief vanaf offense {required} \xB7 bereik {range}",
      descFormationSaver: "Aanvalsformaties op naam opslaan en terugladen (/st formation)",
      formationUsage: "Gebruik: /st formation save|load|delete <naam> \xB7 /st formation list",
      formationNotInSetup: "Open eerst het aanvalsscherm van een target",
      formationNoUnits: "Geen offense-units in deze formatie",
      formationSaved: 'Formatie "{name}" opgeslagen ({count} units)',
      formationOverwritten: 'Formatie "{name}" overschreven ({count} units)',
      formationLoaded: 'Formatie "{name}" geladen: {placed}/{total} units geplaatst',
      formationMissing: "ontbreekt: {units}",
      formationNotFound: 'Geen formatie "{name}" in deze wereld',
      formationDeleted: 'Formatie "{name}" verwijderd',
      formationListEmpty: "Geen opgeslagen formaties in deze wereld",
      formationListHeader: "Opgeslagen formaties ({count}):",
      formationListLine: "{count} units \xB7 {base} \xB7 {date}",
      formationStorageFailed: "Opslaan mislukt (browseropslag niet beschikbaar)",
      helpCmdFormation: "Aanvalsformaties opslaan/laden",
      descWavy: "Forgotten-aanvalsgolven per base: Forgotten-bases in bereik, level-verdeling, waves + afstandslijnen op de wereldkaart",
      descPoiAnalyser: "Alliance-POI-bonussen: POI-labels op de wereldkaart (goud = van jullie), de actieve bonussen in het base-infopaneel en de echte winst/verlies van een geselecteerde POI",
      descSectorHud: "Sector-HUD op de wereldkaart: kijkco\xF6rdinaten + sector, en per sector de bezette POIs (eigen groen, vijandelijk rood, vrij grijs)",
      descMovableMenu: "Verplaatsbare menu's: game-vensters en menu-overlays (alliance, mail, forum, \u2026) verslepen aan de titelbalk; de positie wordt per venster onthouden",
      movableMenuStatus: "{n} onthouden vensterpositie(s)",
      descTransferAll: "Alles overzetten in het resource-transferpaneel: haalt met \xE9\xE9n klik alle tiberium en crystal uit je andere bases naar de open base (eerst het vakje aanvinken: toont de kosten)",
      transferAllButton: "Alles halen",
      transferAllTooltip: "Alle tiberium en crystal uit je andere bases naar deze base halen",
      transferAllCheckTooltip: "Aanvinken toont de totale transferkosten en zet de knop aan",
      transferAllCost: "Kosten: {cost}",
      transferAllSkippedFull: "{res} overgeslagen (opslag vol)",
      transferAllSkippedCredits: "{n} base(s) overgeslagen (niet genoeg credits)",
      transferAllFailed: "{n} transfer(s) geweigerd",
      descChatHelper: "Chat Helper: co\xF6rdinaten en urls in chat, mail en forum worden automatisch getagd ([coords] = klikbaar), Alt-sneltoetsen voor BB-codes ([player], [alliance], [b], [i], [u], [s]) en een contactlijst voor /whisper \u2014 typ /chelp in de chat",
      chatHelperStatus: "{n} contact(en)",
      chatHelperHooked: "chat-invoer gekoppeld",
      chatHelperNotHooked: "chat-invoer NIET gevonden",
      chatHelperUrlPrompt: "Website (syntax: google.com of www.google.com)",
      chatHelperAddConfirm: "{name} aan je contactlijst toevoegen?\n\nJe contacten zie je met /list",
      chatHelperAdded: "{name} toegevoegd aan je contacten",
      chatHelperAlready: "{name} staat al in je contactlijst",
      chatHelperNotInList: "{name} staat niet in je contactlijst",
      chatHelperDelConfirm: "{name} echt uit je contacten verwijderen?",
      chatHelperDelAllConfirm: "Echt ALLE contacten verwijderen?",
      chatHelperDeleted: "{name} verwijderd uit je contacten",
      chatHelperDeletedAll: "Alle contacten verwijderd",
      chatHelperEmptyPrompt: "Je contactlijst is leeg.\n\nTyp hier een naam om een contact toe te voegen:",
      chatHelperListHeader: "{n} contact(en):",
      chatHelperHelp1: "Chat Helper \u2014 spatie in de chat tagt co\xF6rdinaten (123:456) en urls v\xF3\xF3r het versturen; Enter doet dat in mail/forum.",
      chatHelperHelp2: "Alt+1: co\xF6rdinaten/urls taggen in een bericht of forumpost \xB7 Alt+2: url invoegen \xB7 Alt+0: alle tags weghalen",
      chatHelperHelp3: "Alt+p of Alt+3: [player] \xB7 Alt+a of Alt+4: [alliance] \xB7 Alt+b vet \xB7 Alt+i cursief \xB7 Alt+u onderstreept \xB7 Alt+s doorgehaald",
      chatHelperHelp4: "Tags komen om de selectie, of om het woord bij de cursor; in een leeg vak of na een spatie komt een leeg paar.",
      chatHelperHelp5: "Afkortingen: [p]naam[/p] \u2192 [player], [a]naam[/a] \u2192 [alliance]",
      chatHelperHelp6: 'Contacten: /list of /contacts \xB7 /add <naam> \xB7 /del <naam> \xB7 /del all \u2014 "/whisper <beginletters>" vult een contact aan',
      descPvpAlert: "PvP Alert: wordt een van je bases aangevallen terwijl het game-tabblad op de achtergrond staat, dan tonen titel en icoon van het tabblad ALARM en klinkt een sirene; reset zodra je terugkomt (sirene: PvpAlert.sound)",
      pvpAlertTitle: "ALARM - Base {base} wordt aangevallen!",
      pvpAlertStatusAlarm: "ALARM: base {base} wordt aangevallen",
      pvpAlertStatusWatching: "bewaakt je bases (sirene {sound})",
      pvpAlertSoundOn: "aan",
      pvpAlertSoundOff: "uit",
      descLootSummary: "Loot-overzicht in het infopaneel van een Forgotten camp/outpost/base: plunderbare research, tiberium, crystal, credits en totaal, per CP en voor de 2e/3e aanval, en de mogelijke aanvallen vanaf je huidige base",
      lootPossibleAttacks: "Mogelijke aanvallen vanaf deze base (beschikbare CP)",
      lootLootable: "Plunderbare resources",
      lootPerCpRow: "per CP",
      loot2nd: "2e aanval",
      loot3rd: "3e aanval",
      lootCalculating: "Resources worden berekend...",
      lootOutOfRange: "Target buiten bereik, geen resource-berekening mogelijk",
      lootCpFrom: "{cp} CP vanaf {base}",
      lootStatus: "{n} target(s) bekeken",
      poiShort_tib: "Tib",
      poiShort_cry: "Cry",
      poiShort_pow: "Pow",
      poiShort_inf: "Inf",
      poiShort_veh: "Veh",
      poiShort_air: "Air",
      poiShort_def: "Def",
      poiName_tib: "Tiberium",
      poiName_cry: "Crystal",
      poiName_pow: "Power",
      poiName_inf: "Infantry",
      poiName_veh: "Vehicle",
      poiName_air: "Aircraft",
      poiName_def: "Resonator (defense)",
      poiTitle: "POI",
      poiAllianceBonus: "Alliance-POI-bonus (alle bases):",
      poiNone: "Geen POI-bonus",
      poiBonusLine: "{type} {bonus}",
      poiBonusLineRank: "{type} {bonus} (rang {rank})",
      poiLabelTitle: "{type}-POI level {level} \xB7 score {score} \xB7 {owner}",
      poiOwnerNone: "niet bezet",
      poiInfoLine: "{type} level {level} \xB7 score {score} \xB7 {owner}",
      poiRealGain: "Echte winst: {value}",
      poiRealLoss: "Echt verlies: {value}",
      poiLoading: "laden\u2026",
      poiStatus: "{labels} POI-label(s) \xB7 {types} bonustype(s) actief",
      sectorHudPoi: "POI {own} eigen \xB7 {enemy} vijandelijk \xB7 {free} vrij",
      sectorHudSeenNote: "Eigen POIs: volledige lijst. Vijandelijk/vrij: POIs die je deze sessie op de kaart zag.",
      sectorHudClickNote: "Linksklik: co\xF6rdinaten in de chat \xB7 rechtsklik: naar co\xF6rdinaten springen",
      sectorHudJumpPrompt: "Spring naar co\xF6rdinaten (x:y):",
      sectorHudStatus: "{n} POI(s) gezien deze sessie",
      wavyTitle: "Wavy",
      wavyCount: "Forgotten-bases binnen aanvalsbereik: {count} ({countW}) \xB7 {waves} waves",
      wavyCountOne: "Forgotten-bases binnen aanvalsbereik: {count} ({countW}) \xB7 1 wave",
      wavyLevels: "Levels: {levels}",
      helpCmdWatch: "Geselecteerd FG-target claimen (force: toch claimen)",
      helpCmdUnwatch: "Je claim op het geselecteerde target verwijderen (all: alle claims)",
      watchClaimed: "{type} lvl {level} @ {x}:{y} geclaimd",
      watchRefreshed: "{type} lvl {level} @ {x}:{y} opnieuw geclaimd (24 uur vanaf nu)",
      watchAlsoClaimedBy: "(ook geclaimd door {players})",
      watchConflict: "dit target is al geclaimd door {players} \u2014 /st watch force om het toch te claimen",
      watchClaimedBy: "Dit target is geclaimd door {players}",
      watchUnclaimed: "claim op {type} @ {x}:{y} verwijderd",
      watchUnclaimedAll: "{count} claim(s) verwijderd",
      watchNothingToRemove: "je hebt geen claim op {x}:{y}",
      watchDefeated: "{type} @ {x}:{y} verslagen \u2014 claim verwijderd",
      watchSelectFirst: "selecteer eerst een Forgotten camp, outpost of base (wereldkaart of base-view)",
      watchOnlyForgotten: "alleen Forgotten-targets (camp, outpost, base) kun je claimen",
      watchNoServer: "geen server ingesteld \u2014 zet api.url en doe dan /st register",
      watchFailed: "verzoek mislukt \u2014 zie de console (F12)",
      watchStatus: "{own} eigen claim(s), {total} in de alliance",
      watchStatusNoServer: "geen server ingesteld (api.url / /st register)",
      watchAgoNow: "net",
      watchAgoMin: "{n} min geleden",
      watchAgoHour: "1 uur geleden",
      watchAgoHours: "{n} uur geleden"
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
      this._setHooks = {};
      this.PREFIX = "/st";
      this._handleKeyDown = this._handleKeyDown.bind(this);
    }
    /** Register a command handler. */
    register(name, handler) {
      this.commands[name.toLowerCase()] = handler;
    }
    /**
     * Let a plugin own `/st config set <key> <value>` for one key: the hook
     * validates, stores and confirms itself (no generic "key = value" line).
     */
    onConfigSet(key, hook) {
      this._setHooks[key.toLowerCase()] = hook;
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
          const hook = this._setHooks[key.toLowerCase()];
          if (hook) {
            hook(value);
            return;
          }
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
  var REFRESH_EVERY_POLLS = 3;
  var STATE_NAMES = { 0: "offline", 1: "online", 2: "away", 3: "hidden" };
  function ownPlayerId(player) {
    if (!player) return null;
    try {
      if (typeof player.get_Id === "function") {
        const id2 = Number(player.get_Id());
        if (id2 > 0) return id2;
      }
    } catch {
    }
    const id = Number(player.id);
    return id > 0 ? id : null;
  }
  function refreshMemberData() {
    try {
      const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
      if (alliance && alliance.get_Id() > 0 && typeof alliance.RefreshMemberData === "function") {
        alliance.RefreshMemberData();
      }
    } catch {
    }
  }
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
        const id = ownPlayerId(md.get_Player());
        const member = id === null ? null : alliance.get_MemberData().d[id];
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
    constructor(read = readOwnOnlineState, refresh = refreshMemberData) {
      this._read = read;
      this._refresh = refresh;
      this._polls = 0;
      this.state = null;
      this.paused = false;
      this._interval = null;
      this._warned = false;
      this.listeners = { pause: [], resume: [] };
    }
    start() {
      if (this._interval) return;
      this._refresh();
      this.check();
      this._interval = setInterval(() => this._tick(), POLL_MS);
    }
    _tick() {
      this._polls++;
      if (this._polls % REFRESH_EVERY_POLLS === 0) this._refresh();
      this.check();
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
    /** True once start() ran (for /st status). */
    get started() {
      return this._interval !== null;
    }
    /** 'paused' | 'active' | 'unknown' | 'stopped' — for /st status. */
    describe() {
      if (!this.started) return "stopped";
      if (this.state === null) return "unknown";
      return this.paused ? "paused" : "active";
    }
    /** True while the player is Online — scanners start no new scan. */
    get isPaused() {
      return this.paused;
    }
    check() {
      const state = this._read();
      if (state === null) {
        if (!this._warned) {
          console.warn("[ST] Scanner: online state not readable \u2014 scanners not paused");
          this._warned = true;
        }
        this.state = null;
        this._set(false, null);
        return;
      }
      this._warned = false;
      this.state = state;
      this._set(state === ONLINE, state);
    }
    _set(paused, state) {
      if (paused === this.paused) return;
      this.paused = paused;
      if (paused) {
        console.log("[ST] Scanner paused (player online)");
        this.listeners.pause.forEach((fn) => fn());
      } else {
        const why = state === null ? "state unknown" : `player ${STATE_NAMES[state] || state}`;
        console.log(`[ST] Scanner resumed (${why})`);
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
  var MEMBERS_INTERVAL_MS = 3600 * 1e3;
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
      this._gate = null;
      this._heldLogged = false;
      this._membersSentAt = 0;
    }
    /** Hold the scan queue while gate() returns true (e.g. () => online.isPaused). */
    setSendGate(gate) {
      this._gate = gate;
    }
    /** True while scans must not be sent. */
    get isHeld() {
      try {
        return !!(this._gate && this._gate());
      } catch {
        return false;
      }
    }
    _logHeld() {
      if (this._heldLogged) return;
      this._heldLogged = true;
      console.log(`[ST] API: sending held (scanner paused) \u2014 ${this.queue.length} scan(s) buffered`);
    }
    /** Send what was buffered during the hold (call when the scanners resume). */
    resumeQueue() {
      if (this.isHeld) return;
      const wasHeld = this._heldLogged;
      this._heldLogged = false;
      if (this.queue.length === 0) return;
      if (wasHeld) console.log(`[ST] API: sending resumed \u2014 ${this.queue.length} buffered scan(s)`);
      this.flush();
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
      if (this.isHeld) {
        this._logHeld();
        return;
      }
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
      if (this.isHeld) {
        this._logHeld();
        return;
      }
      const batch = this.queue.splice(0, MAX_BATCH);
      let success = 0;
      let failed = 0;
      for (let i = 0; i < batch.length; i++) {
        if (this.isHeld) {
          this.queue.unshift(...batch.slice(i));
          this._logHeld();
          break;
        }
        const members = this._membersDue() ? readAllianceMembers() : null;
        const payload = members ? { ...batch[i], allianceMembers: members } : batch[i];
        const result = await this._sendOne(payload);
        if (result === true) {
          success++;
          if (members) this._membersSentAt = Date.now();
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
    /** True when the next scan should carry the alliance member list. */
    _membersDue(now = Date.now()) {
      return !this._membersSentAt || now - this._membersSentAt >= MEMBERS_INTERVAL_MS;
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
      let worldId3 = 0;
      try {
        worldId3 = md.get_Server().get_WorldId();
      } catch {
      }
      if (!worldId3) {
        const m = location.pathname.match(/\/(\d+)\/index\.aspx/i);
        worldId3 = m ? Number(m[1]) : 0;
      }
      return { id: id || 0, name: name || "", allianceId: allianceId || 0, worldId: worldId3 };
    } catch {
      return null;
    }
  }
  function readAllianceMembers() {
    try {
      const alliance = ClientLib.Data.MainData.GetInstance().get_Alliance();
      if (!alliance || !alliance.get_Id()) return null;
      const data = alliance.get_MemberData().d;
      const out = [];
      for (const key of Object.keys(data || {})) {
        const m = data[key];
        const id = Number(m && m.Id || key);
        if (!Number.isInteger(id) || id <= 0) continue;
        out.push({ playerId: id, playerName: String(m && m.Name || "").slice(0, 50) });
      }
      return out.length ? out : null;
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
    { cmd: "scanalliance", usage: "/st scanalliance", key: "helpCmdScanAlliance" },
    { cmd: "watch", usage: "/st watch [force]", key: "helpCmdWatch" },
    { cmd: "unwatch", usage: "/st unwatch [all]", key: "helpCmdUnwatch" },
    { cmd: "formation", usage: "/st formation save|load|list|delete [name]", key: "helpCmdFormation" }
  ];
  var USEFUL_SETTINGS = [
    ["language", "helpSetLanguage"],
    ["colors", "helpSetColors"],
    ["api.url", "helpSetApiUrl"],
    ["api.key", "helpSetApiKey"],
    ["UpgradeCalc.buttonLeft", "helpSetButtonLeft"],
    ["UpgradeCalc.buttonTop", "helpSetButtonTop"],
    ["PvpAlert.sound", "helpSetPvpSound"]
  ];
  function getHelpModel(version, plugins, commands) {
    const sections = [{
      title: t("helpPlugins"),
      rows: [
        ["/st plugin list", t("helpPluginList")],
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
  function getPlunder(unitId2, level, forgotten = true) {
    const cacheKey = `${unitId2}:${level}:${forgotten ? 1 : 0}`;
    if (plunderCache.has(cacheKey)) return plunderCache.get(cacheKey);
    let result = null;
    const gd = typeof GAMEDATA !== "undefined" && GAMEDATA.units && GAMEDATA.units[unitId2];
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
  var COLOR_SCHEMES = {
    shockr: {
      0: "#5a5653",
      // Offline
      1: "#76ff03",
      // Online
      2: "#ffd600",
      // Away
      3: "#5a5653"
      // Hidden — same as Offline
    },
    maelstrom: {
      0: "#FF0000",
      // Offline
      1: "#B700FF",
      // Online
      2: "#FFFF00",
      // Away
      3: "#C2C2C2"
      // Hidden
    }
  };
  var DEFAULT_SCHEME = "shockr";
  var SCHEME_KEY = "colors";
  var PLAYER_COLORS = COLOR_SCHEMES[DEFAULT_SCHEME];
  function schemeName(value) {
    const name = String(value || "").toLowerCase();
    return COLOR_SCHEMES[name] ? name : DEFAULT_SCHEME;
  }
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
    constructor(config, cli) {
      this.name = "PlayerStatus";
      this.running = false;
      this._patchedNames = [];
      this._oldFunctions = {};
      this._refreshInterval = null;
      this._events = [];
      this.config = config;
      if (config) PLAYER_COLORS = COLOR_SCHEMES[schemeName(config.get(SCHEME_KEY))];
      if (cli) cli.onConfigSet(SCHEME_KEY, (value) => this.setScheme(value));
    }
    /** `/st config set colors <scheme>` — store, switch, repaint, confirm. */
    setScheme(value) {
      const name = String(value).toLowerCase();
      if (!COLOR_SCHEMES[name]) {
        chatMessage(`[ST] ${escapeHtml(t("colorSchemeUnknown", {
          scheme: value,
          schemes: Object.keys(COLOR_SCHEMES).join(", ")
        }))}`);
        return;
      }
      if (this.config) this.config.set(SCHEME_KEY, name);
      PLAYER_COLORS = COLOR_SCHEMES[name];
      if (this.running) {
        try {
          ClientLib.Vis.VisMain.GetInstance().get_Region().SetColorDirty();
        } catch {
        }
      }
      chatMessage(`[ST] ${escapeHtml(t("colorSchemeSet", { scheme: name }))}`);
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
    const names2 = {};
    try {
      const units = city.get_CityUnitsData();
      if (!units) return names2;
      for (const list of [units.$DefenseUnits, units.$OffenseUnits]) {
        if (!list || !list.d) continue;
        for (const u of Object.values(list.d)) {
          try {
            const id = u.get_MdbUnitId();
            if (names2[id]) continue;
            const entry = readUnitName(u, id);
            if (entry) names2[id] = entry;
          } catch {
          }
        }
      }
    } catch {
    }
    return names2;
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
        this.scanAll({ manual: true });
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
      this.scanAll({ manual: false });
    }
    /** Scan all nearby FG objects. */
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
        const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
        originalCityId = cities.get_CurrentCityId();
      } catch {
      }
      try {
        const nearbyObjects = getAllNearbyObjects();
        for (const obj of nearbyObjects) {
          if (!manual && this.online.isPaused) {
            aborted = true;
            break;
          }
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
        console.log(`[ST] LayoutScanner: ${scanned} sent, ${skipped} skipped, ${duration}s${aborted ? " (aborted: player online)" : ""}`);
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
          if (!manual && (!this.idle.isIdle || this.online.isPaused)) {
            aborted = this.online.isPaused ? "player online" : "player active";
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
        console.log(`[ST] AllianceScanner: ${scanned} sent, ${skipped} skipped, ${duration}s${aborted ? ` (aborted: ${aborted})` : ""}`);
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
        const names2 = others.map((w) => `${name(w)}${since(w.timestamp)}`).join(", ");
        chatMessage(`[ST] ${t("targetWatcherWarningMulti", { players: names2, target: targetName })}`);
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
      this.onUnclaimed = null;
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
      let md, net, worldId3;
      try {
        md = ClientLib.Data.MainData.GetInstance();
        net = ClientLib.Net.CommunicationManager.GetInstance();
        worldId3 = Number(md.get_Server().get_WorldId());
      } catch {
        return;
      }
      if (!util || !worldId3 || !this._ensureListener(md, util)) return;
      this._pollBusy = true;
      try {
        net.SendSimpleCommand(
          "GetReportHeaderAll",
          { type: 1, skip: 0, take: HEADER_TAKE, sort: 1, ascending: false },
          util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
            this._pollBusy = false;
            this._onHeaders(worldId3, Array.isArray(data) ? data : []);
          }),
          null
        );
      } catch (e) {
        this._pollBusy = false;
        console.warn("[ST] AttackTracker: GetReportHeaderAll failed", e && e.message);
      }
      this.flush();
    }
    _onHeaders(worldId3, headers) {
      if (!this.running) return;
      const state = loadDone(worldId3);
      const fresh = headers.filter((h) => isLoggable(h) && h.t > state.cutoff && !state.done.some(([id]) => id === h.i) && !(this._inFlight && this._inFlight.header.i === h.i) && !this._pending.some((p) => p.header.i === h.i)).reverse();
      for (const h of fresh) this._pending.push({ header: h, worldId: worldId3, attempts: 0 });
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
        if (this.onUnclaimed && Array.isArray(result.unclaimed)) {
          for (const claim of result.unclaimed) this.onUnclaimed(claim);
        }
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
  function buildAttack(h, worldId3, loot) {
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
      worldId: Number(worldId3),
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
  function loadDone(worldId3) {
    try {
      const v = JSON.parse(localStorage.getItem(DONE_KEY_PREFIX + worldId3) || "null");
      if (v && Array.isArray(v.done) && typeof v.cutoff === "number") return v;
    } catch {
    }
    return { cutoff: Date.now() - BACKFILL_DAYS * 86400 * 1e3, done: [] };
  }
  function markDone(worldId3, id, time) {
    const state = loadDone(worldId3);
    if (!state.done.some(([d]) => d === id)) state.done.push([id, time]);
    state.done.sort((a, b) => a[1] - b[1]);
    while (state.done.length > DONE_MAX) {
      const [, dropped] = state.done.shift();
      state.cutoff = Math.max(state.cutoff, dropped);
    }
    try {
      localStorage.setItem(DONE_KEY_PREFIX + worldId3, JSON.stringify(state));
    } catch {
    }
  }

  // plugins/watchlist.js
  var POLL_INTERVAL_MS3 = 2500;
  var LIST_REFRESH_MS = 60 * 1e3;
  var PLAYER_FACTIONS3 = [1, 2];
  var BASE_VIEW_MODES2 = ["City", "CombatSetup", "Battleground"];
  var CAMP_TYPES2 = { 1: "camp", 2: "camp", 3: "outpost", 4: "base" };
  var WatchList = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descWatchList");
    }
    constructor(config, cli, apiClient) {
      this.name = "WatchList";
      this.config = config;
      this.cli = cli;
      this.api = apiClient;
      this.running = false;
      this._timer = null;
      this._viewKey = null;
      this._warned = false;
      this._claims = null;
      this._claimsAt = 0;
      this._refreshing = null;
    }
    async start() {
      this.running = true;
      this.cli.register("watch", (args) => this.watch(args));
      this.cli.register("unwatch", (args) => this.unwatch(args));
      this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS3);
    }
    stop() {
      this.running = false;
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this._viewKey = null;
      this._claims = null;
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.api.isConfigured) return t("watchStatusNoServer");
      const me = myPlayerId();
      const own = (this._claims || []).filter((c) => c.playerId === me).length;
      return t("watchStatus", { own, total: (this._claims || []).length });
    }
    // ─── Commands ────────────────────────────────────────────────────
    /** `/st watch [force]` */
    async watch(args = []) {
      if (!this._ready()) return;
      const target = readSelectedTarget();
      if (!this._usable(target)) return;
      const force = String(args[0] || "").toLowerCase() === "force";
      const result = await this.api.request("POST", "/api/watchlist", {
        action: "claim",
        targetType: target.targetType,
        targetLevel: target.targetLevel,
        targetX: target.targetX,
        targetY: target.targetY,
        worldId: target.worldId,
        force
      });
      if (!result) {
        say(t("watchFailed"));
        return;
      }
      const others = Array.isArray(result.others) ? result.others : [];
      if (result.status === "conflict") {
        say(`\u26A0 ${t("watchConflict", { players: names(others) })}`);
        this._remember(others, result.serverTime);
        this._markWarned(target);
        return;
      }
      const vars = { type: target.targetType, level: Math.floor(target.targetLevel), x: target.targetX, y: target.targetY };
      say(t(result.status === "refreshed" ? "watchRefreshed" : "watchClaimed", vars) + (others.length ? ` ${t("watchAlsoClaimedBy", { players: names(others) })}` : ""));
      this._remember([result.claim, ...others], result.serverTime);
      this._markWarned(target);
    }
    /** `/st unwatch [all]` */
    async unwatch(args = []) {
      if (!this._ready()) return;
      if (String(args[0] || "").toLowerCase() === "all") {
        const worldId3 = currentWorldId();
        const result2 = worldId3 && await this.api.request("POST", "/api/watchlist", { action: "unclaim_all", worldId: worldId3 });
        if (!result2) {
          say(t("watchFailed"));
          return;
        }
        const removed2 = result2.removed || [];
        this._forget(removed2);
        say(t("watchUnclaimedAll", { count: removed2.length }));
        return;
      }
      const target = readSelectedTarget();
      if (!this._usable(target)) return;
      const result = await this.api.request("POST", "/api/watchlist", {
        action: "unclaim",
        targetX: target.targetX,
        targetY: target.targetY,
        worldId: target.worldId
      });
      if (!result) {
        say(t("watchFailed"));
        return;
      }
      const removed = result.removed || [];
      this._forget(removed);
      say(removed.length ? t("watchUnclaimed", { type: target.targetType, x: target.targetX, y: target.targetY }) : t("watchNothingToRemove", { x: target.targetX, y: target.targetY }));
    }
    /** AttackTracker hook: the server removed this claim because the attack on it was won. */
    notifyDefeated(claim) {
      if (!claim) return;
      this._forget([claim]);
      say(t("watchDefeated", { type: claim.targetType, x: claim.targetX, y: claim.targetY }));
    }
    // ─── Warning while viewing ───────────────────────────────────────
    _tick() {
      if (!this.running || !this.api.isConfigured || scanLockHolder()) return;
      const target = readSelectedTarget();
      const key = target && target.targetType ? `${target.worldId}:${target.targetX}:${target.targetY}` : null;
      if (key !== this._viewKey) {
        this._viewKey = key;
        this._warned = false;
      }
      if (!key || this._warned) return;
      if (this._claims && Date.now() - this._claimsAt < LIST_REFRESH_MS) {
        this._warned = true;
        this._warnIfClaimed(target);
        return;
      }
      if (this._refreshing) return;
      this._refreshing = this._refresh(target.worldId).finally(() => {
        this._refreshing = null;
      });
    }
    async _refresh(worldId3) {
      const result = await this.api.request("POST", "/api/watchlist", { action: "list", worldId: worldId3 });
      this._claimsAt = Date.now();
      if (result && Array.isArray(result.claims)) {
        this._claims = result.claims;
        this._serverOffset = Number(result.serverTime) ? Number(result.serverTime) - Date.now() : 0;
      } else if (!this._claims) {
        this._claims = [];
      }
    }
    _markWarned(target) {
      this._viewKey = `${target.worldId}:${target.targetX}:${target.targetY}`;
      this._warned = true;
    }
    _warnIfClaimed(target) {
      const me = myPlayerId();
      const others = claimsAt(this._claims, target.targetX, target.targetY).filter((c) => c.playerId !== me);
      if (!others.length) return;
      const now = Date.now() + (this._serverOffset || 0);
      const list = others.map((c) => `${escapeHtml(c.playerName || "?")} (${ago(now - c.claimedAt)})`).join(", ");
      say(`\u26A0 ${t("watchClaimedBy", { players: list })}`, false);
    }
    // ─── Local claims cache ──────────────────────────────────────────
    /** Merge claims the server just returned into the cached list (by id, or by player + coordinate). */
    _remember(claims, serverTime) {
      if (!this._claims) return;
      for (const c of claims) {
        if (!c) continue;
        this._claims = this._claims.filter((k) => k.id !== c.id && !(k.playerId === c.playerId && k.targetX === c.targetX && k.targetY === c.targetY));
        this._claims.push(c);
      }
      if (Number(serverTime)) this._serverOffset = Number(serverTime) - Date.now();
    }
    _forget(claims) {
      if (!this._claims) return;
      const ids = new Set(claims.map((c) => c && c.id));
      this._claims = this._claims.filter((c) => !ids.has(c.id));
    }
    // ─── Checks ──────────────────────────────────────────────────────
    _ready() {
      if (!this.running) return false;
      if (!this.api.isConfigured) {
        say(t("watchNoServer"));
        return false;
      }
      return true;
    }
    _usable(target) {
      if (!target) {
        say(t("watchSelectFirst"));
        return false;
      }
      if (target.notForgotten) {
        say(t("watchOnlyForgotten"));
        return false;
      }
      if (!target.targetType) {
        say(t("watchSelectFirst"));
        return false;
      }
      return true;
    }
  };
  function readSelectedTarget() {
    try {
      const md = ClientLib.Data.MainData.GetInstance();
      const vis = ClientLib.Vis.VisMain.GetInstance();
      const baseModes = BASE_VIEW_MODES2.map((m) => ClientLib.Vis.Mode[m]).filter((m) => m !== void 0);
      let x, y, cityLevel = null, inBaseView = false;
      if (baseModes.includes(vis.get_Mode())) {
        const city = md.get_Cities().get_CurrentCity();
        if (!city || city.get_IsGhostMode() || city.IsOwnBase()) return null;
        if (PLAYER_FACTIONS3.includes(city.get_CityFaction())) return { notForgotten: true };
        x = city.get_PosX();
        y = city.get_PosY();
        cityLevel = city.get_LvlBase();
        inBaseView = true;
      } else {
        const sel = vis.get_SelectedObject();
        if (!sel || typeof sel.get_VisObjectType !== "function") return null;
        const types = ClientLib.Vis.VisObject.EObjectType;
        const type = sel.get_VisObjectType();
        if (type === types.RegionCityType) return { notForgotten: true };
        if (type !== types.RegionNPCBase && type !== types.RegionNPCCamp) return null;
        x = sel.get_RawX();
        y = sel.get_RawY();
        try {
          const city = md.get_Cities().GetCity(sel.get_Id());
          if (city && !city.get_IsGhostMode()) cityLevel = city.get_LvlBase();
        } catch {
        }
      }
      if (!(x >= 0 && y >= 0)) return null;
      const obj = md.get_World().GetObjectFromPosition(x, y);
      let targetType = null;
      let level = null;
      if (obj && obj.Type === 3) {
        targetType = CAMP_TYPES2[obj.$CampType] || null;
        level = obj.$Level;
      } else if (obj && obj.Type === 2) {
        targetType = "base";
        level = obj.$Level;
      } else if (inBaseView) {
        targetType = "base";
      }
      if (!targetType) return null;
      if (level === null || level === void 0 || !Number.isFinite(Number(level))) level = cityLevel;
      level = Number(level);
      return {
        targetType,
        targetLevel: Number.isFinite(level) && level >= 0 ? Math.min(level, 100) : 0,
        targetX: Math.round(Number(x)),
        targetY: Math.round(Number(y)),
        worldId: Number(md.get_Server().get_WorldId())
      };
    } catch {
      return null;
    }
  }
  function claimsAt(claims, x, y) {
    return (claims || []).filter((c) => c && c.targetX === x && c.targetY === y);
  }
  function ago(ms) {
    const min = Math.max(0, Math.round(ms / 6e4));
    if (min < 1) return t("watchAgoNow");
    if (min < 60) return t("watchAgoMin", { n: min });
    const h = Math.round(min / 60);
    return t(h === 1 ? "watchAgoHour" : "watchAgoHours", { n: h });
  }
  function names(claims) {
    return claims.map((c) => escapeHtml(c && c.playerName || "?")).join(", ");
  }
  function myPlayerId() {
    try {
      const player = ClientLib.Data.MainData.GetInstance().get_Player();
      return Number(typeof player.get_Id === "function" ? player.get_Id() : player.id) || 0;
    } catch {
      return 0;
    }
  }
  function currentWorldId() {
    try {
      return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId()) || 0;
    } catch {
      return 0;
    }
  }
  function say(msg, withPrefix = true) {
    const text = `[ST] ${withPrefix ? "WatchList: " : ""}${msg}`;
    chatMessage(text);
    console.log(text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }

  // lib/map-overlay.js
  function isWorldMapVisible() {
    try {
      const vis = ClientLib.Vis.VisMain.GetInstance();
      return vis.get_Mode() === ClientLib.Vis.Mode.Region;
    } catch {
      return false;
    }
  }
  function cellToScreen(x, y, fx = 0.5, fy = 0.5) {
    const visMain = ClientLib.Vis.VisMain.GetInstance();
    const region = visMain.get_Region();
    return {
      left: visMain.ScreenPosFromWorldPosX((x + fx) * region.get_GridWidth()),
      top: visMain.ScreenPosFromWorldPosY((y + fy) * region.get_GridHeight())
    };
  }
  function viewSize() {
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    return { width: region.get_ViewWidth(), height: region.get_ViewHeight() };
  }
  function visibleCellRange(margin = 1, maxCells = 80) {
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    const gw = region.get_GridWidth();
    const gh = region.get_GridHeight();
    const zoom = region.get_ZoomFactor() || 1;
    const x0 = region.get_PosX() / gw;
    const y0 = region.get_PosY() / gh;
    const w = Math.min(region.get_ViewWidth() / zoom / gw, maxCells);
    const h = Math.min(region.get_ViewHeight() / zoom / gh, maxCells);
    return {
      minX: Math.floor(x0) - margin,
      minY: Math.floor(y0) - margin,
      maxX: Math.ceil(x0 + w) + margin,
      maxY: Math.ceil(y0 + h) + margin
    };
  }
  function addToMap(el) {
    try {
      const canvas = document.querySelector("canvas");
      if (canvas && canvas.parentElement && el.parentElement !== canvas.parentElement) {
        canvas.parentElement.appendChild(el);
      }
    } catch {
    }
  }
  function attachMapEvents(owner, onMove, onData) {
    const events = [];
    const attach = (source, name, type, cb) => {
      try {
        webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, owner, cb);
        events.push({ source, name, type, cb });
      } catch {
      }
    };
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    attach(region, "PositionChange", ClientLib.Vis.PositionChange, onMove);
    attach(region, "ZoomFactorChange", ClientLib.Vis.ZoomFactorChange, onMove);
    attach(region, "SectorUpdated", ClientLib.Vis.Region.SectorUpdated, onData);
    attach(ClientLib.Data.MainData.GetInstance().get_Cities(), "Change", ClientLib.Data.CitiesChange, onData);
    return events;
  }
  function detachMapEvents(owner, events) {
    for (const ev of events) {
      try {
        webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, owner, ev.cb);
      } catch {
      }
    }
  }
  function cityObjectType() {
    try {
      const t2 = ClientLib.Data.WorldSector.ObjectType.City;
      if (typeof t2 === "number") return t2;
    } catch {
    }
    return 1;
  }

  // plugins/base-info.js
  var REFRESH_MS = 2e3;
  var OWN_COLOR2 = "#00bcd4";
  var OTHER_COLOR = "#ffcc80";
  function labelText(number, levels) {
    if (!levels) return `#${number}`;
    return `#${number} ${levels.off.toFixed(1)}/${levels.def.toFixed(1)}`;
  }
  function baseNumber(ids, id) {
    const sorted = Array.from(ids).sort((a, b) => a - b);
    return sorted.indexOf(id) + 1;
  }
  var BaseInfo = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descBaseInfo");
    }
    constructor(config) {
      this.name = "BaseInfo";
      this.config = config;
      this.running = false;
      this.labels = /* @__PURE__ */ new Map();
      this.levels = /* @__PURE__ */ new Map();
      this.seen = /* @__PURE__ */ new Map();
      this._events = [];
      this._interval = null;
      this._raf = null;
    }
    async start() {
      this.running = true;
      this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
      this._interval = setInterval(() => this.update(), REFRESH_MS);
      this.update();
      console.log("[ST] BaseInfo: started");
    }
    stop() {
      this.running = false;
      detachMapEvents(this, this._events);
      this._events = [];
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      this._clear();
    }
    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.update();
      });
    }
    _clear() {
      for (const { el } of this.labels.values()) el.remove();
      this.labels.clear();
    }
    /**
     * Player bases in view with number and levels.
     * @returns {Array<{id, x, y, own, number, levels}>}
     */
    collect() {
      const md = ClientLib.Data.MainData.GetInstance();
      const world = md.get_World();
      const cities = md.get_Cities();
      const cityType = cityObjectType();
      let ownPlayerId2 = null;
      try {
        ownPlayerId2 = md.get_Player().id;
      } catch {
      }
      let ownIds = [];
      try {
        ownIds = Object.values(cities.get_AllCities().d).map((c) => c.get_Id());
      } catch {
      }
      const range = visibleCellRange();
      const found = [];
      for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
          try {
            const obj = world.GetObjectFromPosition(x, y);
            if (!obj || obj.Type !== cityType) continue;
            if (typeof obj.$Id === "undefined") continue;
            const id = obj.$Id;
            const playerId = obj.$PlayerId;
            const own = ownIds.includes(id) || ownPlayerId2 !== null && playerId === ownPlayerId2;
            if (!own) {
              if (!this.seen.has(playerId)) this.seen.set(playerId, /* @__PURE__ */ new Set());
              this.seen.get(playerId).add(id);
            }
            found.push({ id, x, y, own, playerId });
          } catch {
          }
        }
      }
      for (const base of found) {
        base.number = base.own ? baseNumber(ownIds.includes(base.id) ? ownIds : [...ownIds, base.id], base.id) : baseNumber(this.seen.get(base.playerId), base.id);
        this._readLevels(cities, base.id);
        base.levels = this.levels.get(base.id) || null;
      }
      return found;
    }
    _readLevels(cities, id) {
      try {
        const city = cities.GetCity(id);
        if (!city) return;
        const off = Number(city.get_LvlOffense());
        const def = Number(city.get_LvlDefense());
        if (off > 0) this.levels.set(id, { off, def: def > 0 ? def : 0 });
      } catch {
      }
    }
    /** Rescan and render; never throws. */
    update() {
      if (!this.running) return;
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        const bases = this.collect();
        const keep = /* @__PURE__ */ new Set();
        for (const base of bases) {
          keep.add(base.id);
          let label = this.labels.get(base.id);
          if (!label) {
            label = { el: this._createElement(), x: base.x, y: base.y };
            this.labels.set(base.id, label);
          }
          label.x = base.x;
          label.y = base.y;
          const el = label.el;
          el.textContent = labelText(base.number, base.levels);
          el.style.color = base.own ? OWN_COLOR2 : OTHER_COLOR;
          el.title = base.levels ? t("baseInfoTitle", { off: base.levels.off.toFixed(2), def: base.levels.def.toFixed(2) }) : t("baseInfoUnknown");
          this._place(label);
        }
        for (const [id, label] of this.labels) {
          if (!keep.has(id)) {
            label.el.remove();
            this.labels.delete(id);
          }
        }
      } catch (e) {
        console.warn("[ST] BaseInfo: update failed", e);
      }
    }
    _reposition() {
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        for (const label of this.labels.values()) this._place(label);
      } catch {
      }
    }
    _place(label) {
      const { left, top } = cellToScreen(label.x, label.y, 0.1, 0.1);
      const view = viewSize();
      if (top < 0 || left < 0 || top > view.height || left > view.width) {
        if (label.el.parentElement) label.el.remove();
        return;
      }
      label.el.style.left = left + "px";
      label.el.style.top = top + "px";
      addToMap(label.el);
    }
    _createElement() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        zIndex: "10",
        fontFamily: "Iosevka Term",
        fontWeight: "bold",
        fontSize: "12px",
        padding: "1px 4px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.75)",
        whiteSpace: "nowrap"
      });
      el.setAttribute("data-st-baseinfo", "1");
      return el;
    }
  };

  // plugins/attack-range.js
  var REFRESH_MS2 = 2e3;
  function ownBases() {
    const out = [];
    try {
      const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
      for (const city of Object.values(all)) {
        try {
          out.push({ id: city.get_Id(), x: city.get_PosX(), y: city.get_PosY() });
        } catch {
        }
      }
    } catch {
    }
    return out;
  }
  function attackRange() {
    try {
      const r = Number(ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance());
      return r > 0 ? r : null;
    } catch {
      return null;
    }
  }
  function circleBox(x, y, range) {
    const c = cellToScreen(x, y, 0.5, 0.5);
    const e = cellToScreen(x + range, y + range, 0.5, 0.5);
    const rx = Math.abs(e.left - c.left);
    const ry = Math.abs(e.top - c.top);
    return { left: c.left - rx, top: c.top - ry, width: 2 * rx, height: 2 * ry };
  }
  var AttackRange = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descAttackRange");
    }
    constructor(config) {
      this.name = "AttackRange";
      this.config = config;
      this.defaultEnabled = true;
      this.running = false;
      this.circles = /* @__PURE__ */ new Map();
      this._events = [];
      this._interval = null;
      this._range = null;
      this._onMove = () => this._reposition();
      this._onData = () => this._update();
    }
    async start() {
      this.running = true;
      this._range = attackRange();
      try {
        this._events = attachMapEvents(this, this._onMove, this._onData);
      } catch {
        this._events = [];
      }
      this._interval = setInterval(() => this._update(), REFRESH_MS2);
      this._update();
      console.log(`[ST] AttackRange: started (range ${this._range ?? "?"})`);
    }
    stop() {
      this.running = false;
      detachMapEvents(this, this._events);
      this._events = [];
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      for (const [, c] of this.circles) c.el.remove();
      this.circles.clear();
    }
    /** Sync the circle set with the own bases, then position them. */
    _update() {
      if (!this.running) return;
      try {
        if (!this._range) this._range = attackRange();
        const bases = ownBases();
        const keep = /* @__PURE__ */ new Set();
        for (const b of bases) {
          keep.add(b.id);
          const existing = this.circles.get(b.id);
          if (existing) {
            existing.x = b.x;
            existing.y = b.y;
          } else {
            this.circles.set(b.id, { el: this._createEl(), x: b.x, y: b.y });
          }
        }
        for (const [id, c] of this.circles) {
          if (!keep.has(id)) {
            c.el.remove();
            this.circles.delete(id);
          }
        }
        this._reposition();
      } catch (e) {
        console.warn("[ST] AttackRange: update failed", e);
      }
    }
    _createEl() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        zIndex: "9",
        borderRadius: "50%",
        border: "2px dashed rgba(255,152,0,0.85)",
        background: "rgba(255,152,0,0.06)",
        boxSizing: "border-box"
      });
      el.className = "st-attack-range";
      return el;
    }
    /** Position every circle; hide all off the world map or off-screen. */
    _reposition() {
      if (!this.running) return;
      try {
        const visible = isWorldMapVisible() && this._range;
        const view = visible ? viewSize() : null;
        for (const [, c] of this.circles) {
          if (!visible) {
            if (c.el.parentElement) c.el.remove();
            continue;
          }
          const box = circleBox(c.x, c.y, this._range);
          const offScreen = box.left + box.width < 0 || box.top + box.height < 0 || box.left > view.width || box.top > view.height;
          if (offScreen) {
            if (c.el.parentElement) c.el.remove();
            continue;
          }
          Object.assign(c.el.style, {
            left: box.left + "px",
            top: box.top + "px",
            width: box.width + "px",
            height: box.height + "px"
          });
          if (!c.el.parentElement) addToMap(c.el);
        }
      } catch (e) {
        console.warn("[ST] AttackRange: reposition failed", e);
      }
    }
  };

  // plugins/map-labels.js
  var WATCH_POLL_MS = 10 * 1e3;
  var CLAIM_POLL_MS = 60 * 1e3;
  var ATTACK_POLL_MS = 60 * 1e3;
  var ALLIANCE_ATTACK_POLL_MS = 60 * 1e3;
  var RENDER_MS = 2e3;
  var ATTACK_MAX_AGE_MS = 7 * 24 * 3600 * 1e3;
  var NAME_MAX = 10;
  var CAMP_TYPES3 = { 1: "camp", 2: "camp", 3: "outpost", 4: "base" };
  var STATUS = {
    attacked: { rank: 3, icon: "\u2694", color: "#f44336" },
    claimed: { rank: 2, icon: "\u{1F4CC}", color: "#ff9800" },
    viewing: { rank: 1, icon: "\u{1F441}", color: "#ffeb3b" }
  };
  function truncateName(name) {
    const s = String(name || "?");
    return s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1) + "\u2026" : s;
  }
  function mergeLabels(data, own = {}) {
    const out = /* @__PURE__ */ new Map();
    const add = (entry, status) => {
      const x = Math.round(Number(entry.x));
      const y = Math.round(Number(entry.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const key = `${x}:${y}`;
      if (!out.has(key)) out.set(key, { x, y, players: /* @__PURE__ */ new Map() });
      const players = out.get(key).players;
      const pid = String(entry.playerId ?? entry.playerName);
      const known = players.get(pid);
      if (!known || STATUS[status].rank > STATUS[known.status].rank) {
        players.set(pid, { status, playerId: entry.playerId, playerName: entry.playerName || "?" });
      }
    };
    for (const w of data.watches || []) {
      const isOwn = own.ownId != null && Number(w.playerId) === Number(own.ownId);
      if (isOwn && Number(own.ownCurrentTargetId) !== Number(w.targetId)) continue;
      add(w, "viewing");
    }
    for (const c of data.claims || []) add(c, "claimed");
    for (const a of data.attacks || []) add(a, "attacked");
    const result = /* @__PURE__ */ new Map();
    for (const [key, { x, y, players }] of out) {
      const lines = [...players.values()].sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank || String(a.playerName).localeCompare(String(b.playerName)));
      result.set(key, { x, y, lines });
    }
    return result;
  }
  function currentTarget(world, x, y) {
    try {
      const obj = world.GetObjectFromPosition(x, y);
      if (!obj) return null;
      let type = null;
      if (obj.Type === 2) type = "base";
      else if (obj.Type === 3 && obj.$CampType !== 0) type = CAMP_TYPES3[obj.$CampType] || null;
      else return null;
      const level = typeof obj.$Level === "number" && Number.isFinite(obj.$Level) ? obj.$Level : null;
      return { type, level };
    } catch {
      return null;
    }
  }
  function sameTarget(attack, current) {
    if (!current) return false;
    if (attack.targetType && current.type && attack.targetType !== current.type) return false;
    const a = Number(attack.targetLevel);
    if (attack.targetLevel != null && Number.isFinite(a) && current.level != null && Math.floor(a) !== Math.floor(current.level)) return false;
    return true;
  }
  function isFgTarget(world, x, y) {
    try {
      const obj = world.GetObjectFromPosition(x, y);
      if (!obj) return false;
      if (obj.Type === 2) return true;
      if (obj.Type === 3) return obj.$CampType !== 0;
      return false;
    } catch {
      return false;
    }
  }
  function ownPlayer() {
    try {
      const p = ClientLib.Data.MainData.GetInstance().get_Player();
      const id = Number(typeof p.get_Id === "function" ? p.get_Id() : p.id) || null;
      const name = String((typeof p.get_Name === "function" ? p.get_Name() : p.name) || "");
      return { id, name };
    } catch {
      return { id: null, name: "" };
    }
  }
  function worldId() {
    try {
      return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId()) || null;
    } catch {
      return null;
    }
  }
  function gameUtil2() {
    if (typeof webfrontend !== "undefined" && webfrontend.phe && webfrontend.phe.cnc && webfrontend.phe.cnc.Util) return webfrontend.phe.cnc.Util;
    if (typeof phe !== "undefined" && phe.cnc && phe.cnc.Util) return phe.cnc.Util;
    return null;
  }
  var ANSWER_TIMEOUT_MS2 = 15 * 1e3;
  var MapLabels = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descMapLabels");
    }
    constructor(config, apiClient, plugins = {}) {
      this.name = "MapLabels";
      this.config = config;
      this.api = apiClient;
      this.plugins = plugins || {};
      this.running = false;
      this.watches = [];
      this.claims = [];
      this.attacks = [];
      this.allianceAttacks = [];
      this._last = { watch: 0, claim: 0, attack: 0, alliance: 0 };
      this._busy = { watch: false, claim: false, attack: false, alliance: false };
      this.labels = /* @__PURE__ */ new Map();
      this._events = [];
      this._timer = null;
      this._renderTimer = null;
    }
    async start() {
      this.running = true;
      try {
        this._events = attachMapEvents(this, () => this._reposition(), () => this.render());
      } catch {
        this._events = [];
      }
      this._timer = setInterval(() => this.poll(), 1e3);
      this._renderTimer = setInterval(() => this.render(), RENDER_MS);
      this.poll();
      console.log("[ST] MapLabels: started");
    }
    stop() {
      this.running = false;
      detachMapEvents(this, this._events);
      this._events = [];
      if (this._timer) clearInterval(this._timer);
      if (this._renderTimer) clearInterval(this._renderTimer);
      this._timer = this._renderTimer = null;
      this._clear();
    }
    /** One-line status for `/st status`. */
    statusText() {
      return `\u{1F441} ${this.watches.length} \xB7 \u{1F4CC} ${this.claims.length} \xB7 \u2694 ${new Set(this._allAttacks().map((a) => `${a.x}:${a.y}:${a.playerId ?? a.playerName}`)).size}`;
    }
    /** Called every second: fires each source when its interval is due. Only on the world map. */
    poll(now = Date.now()) {
      if (!this.running) return;
      try {
        if (!isWorldMapVisible()) return;
        const configured = !!(this.api && this.api.isConfigured);
        if (configured && now - this._last.watch >= WATCH_POLL_MS) this._fetchWatches(now);
        if (configured && now - this._last.claim >= CLAIM_POLL_MS) this._fetchClaims(now);
        if (configured && now - this._last.alliance >= ALLIANCE_ATTACK_POLL_MS) this._fetchAllianceAttacks(now);
        if (now - this._last.attack >= ATTACK_POLL_MS) this._readAttacks(now);
      } catch (e) {
        console.warn("[ST] MapLabels: poll failed", e && e.message);
      }
    }
    async _fetchWatches(now) {
      if (this._busy.watch) return;
      const wid = worldId();
      if (!wid) return;
      this._busy.watch = true;
      this._last.watch = now;
      try {
        const data = await this.api.request("GET", `/api/target-watch/${wid}`);
        if (data && Array.isArray(data.targets)) {
          const list = [];
          for (const tg of data.targets) {
            for (const w of tg.watchers || []) {
              list.push({ x: tg.targetX, y: tg.targetY, targetId: tg.targetId, playerId: w.playerId, playerName: w.playerName });
            }
          }
          this.watches = list;
          this.render();
        }
      } catch {
      } finally {
        this._busy.watch = false;
      }
    }
    async _fetchClaims(now) {
      if (this._busy.claim) return;
      const wid = worldId();
      if (!wid) return;
      this._busy.claim = true;
      this._last.claim = now;
      try {
        const data = await this.api.request("POST", "/api/watchlist", { action: "list", worldId: wid });
        if (data && Array.isArray(data.claims)) {
          this.claims = data.claims.map((c) => ({ x: c.targetX, y: c.targetY, playerId: c.playerId, playerName: c.playerName }));
          this.render();
        }
      } catch {
      } finally {
        this._busy.claim = false;
      }
    }
    /** Every alliance member's won attacks of the last 24 h (GET /api/attacks/alliance). */
    async _fetchAllianceAttacks(now) {
      if (this._busy.alliance) return;
      const wid = worldId();
      if (!wid) return;
      this._busy.alliance = true;
      this._last.alliance = now;
      try {
        const data = await this.api.request("GET", `/api/attacks/alliance?worldId=${wid}`);
        if (data && Array.isArray(data.attacks)) {
          const me = ownPlayer();
          this.allianceAttacks = data.attacks.map((a) => ({
            x: a.targetX,
            y: a.targetY,
            playerName: a.playerName,
            targetType: a.targetType,
            targetLevel: a.targetLevel,
            // No playerId from the server: the own name -> the own id, so it merges with the report-based ⚔
            playerId: me.id != null && a.playerName === me.name ? me.id : void 0
          }));
          this.render();
        }
      } catch {
      } finally {
        this._busy.alliance = false;
      }
    }
    /** Own (report headers) + alliance (server) attacks, for mergeLabels. */
    _allAttacks() {
      return [...this.attacks, ...this.allianceAttacks];
    }
    /** Own won FG attacks from the report headers (read-only, same route/filter as AttackTracker). */
    _readAttacks(now) {
      if (this._busy.attack && now - this._last.attack < ANSWER_TIMEOUT_MS2) return;
      const util = gameUtil2();
      if (!util) return;
      let net;
      try {
        net = ClientLib.Net.CommunicationManager.GetInstance();
      } catch {
        return;
      }
      this._busy.attack = true;
      this._last.attack = now;
      try {
        net.SendSimpleCommand(
          "GetReportHeaderAll",
          { type: 1, skip: 0, take: 50, sort: 1, ascending: false },
          util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
            this._busy.attack = false;
            this._onHeaders(Array.isArray(data) ? data : []);
          }),
          null
        );
      } catch (e) {
        this._busy.attack = false;
        console.warn("[ST] MapLabels: GetReportHeaderAll failed", e && e.message);
      }
    }
    _onHeaders(headers, now = Date.now()) {
      const me = ownPlayer();
      this.attacks = headers.filter((h) => isLoggable(h) && now - h.t <= ATTACK_MAX_AGE_MS).map((h) => ({
        x: Number(h.ad.dbx),
        y: Number(h.ad.dby),
        playerId: me.id,
        playerName: me.name,
        targetType: CAMP_TYPES3[parseInt(h.ad.dbn, 10)] || null,
        targetLevel: Number.isFinite(Number(h.ad.dbl)) ? Number(h.ad.dbl) : null
      }));
      this.render();
    }
    _clear() {
      for (const { el } of this.labels.values()) el.remove();
      this.labels.clear();
    }
    /** Rebuild the labels from the current data; never throws. */
    render() {
      if (!this.running) return;
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        const me = ownPlayer();
        const tw = this.plugins.targetWatcher;
        const world = ClientLib.Data.MainData.GetInstance().get_World();
        const attacks = this._allAttacks().filter((a) => sameTarget(a, currentTarget(world, Math.round(Number(a.x)), Math.round(Number(a.y)))));
        const merged = mergeLabels(
          { watches: this.watches, claims: this.claims, attacks },
          { ownId: me.id, ownCurrentTargetId: tw && tw.running ? tw._currentId : null }
        );
        const keep = /* @__PURE__ */ new Set();
        for (const [key, entry] of merged) {
          if (!entry.lines.length || !isFgTarget(world, entry.x, entry.y)) continue;
          keep.add(key);
          let label = this.labels.get(key);
          if (!label) {
            label = { el: this._createElement(), x: entry.x, y: entry.y };
            this.labels.set(key, label);
          }
          this._fill(label.el, entry.lines);
          this._place(label);
        }
        for (const [key, label] of this.labels) {
          if (!keep.has(key)) {
            label.el.remove();
            this.labels.delete(key);
          }
        }
      } catch (e) {
        console.warn("[ST] MapLabels: render failed", e && e.message);
      }
    }
    _fill(el, lines) {
      el.textContent = "";
      for (const line of lines) {
        const st = STATUS[line.status];
        const row = document.createElement("div");
        row.textContent = `${st.icon} ${truncateName(line.playerName)}`;
        row.style.color = st.color;
        el.appendChild(row);
      }
      el.title = lines.map((l) => `${STATUS[l.status].icon} ${l.playerName}`).join("\n");
    }
    _reposition() {
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        for (const label of this.labels.values()) this._place(label);
      } catch {
      }
    }
    _place(label) {
      const { left, top } = cellToScreen(label.x, label.y, 0.5, 0.95);
      const view = viewSize();
      if (top < 0 || left < 0 || top > view.height || left > view.width) {
        if (label.el.parentElement) label.el.remove();
        return;
      }
      label.el.style.left = left + "px";
      label.el.style.top = top + "px";
      addToMap(label.el);
    }
    _createElement() {
      const size = Math.max(11, Math.round(Number(this.config ? this.config.get("camptracker.fontsize", 20) : 20) * 0.6));
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: "10",
        fontFamily: this.config ? this.config.get("camptracker.font", "Iosevka Term") : "Iosevka Term",
        fontWeight: "bold",
        fontSize: size + "px",
        lineHeight: "1.15",
        padding: "1px 4px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.7)",
        whiteSpace: "nowrap"
      });
      el.setAttribute("data-st-maplabel", "1");
      return el;
    }
  };

  // plugins/tunnel-info.js
  var REFRESH_MS3 = 2e3;
  var DEFAULT_INFLUENCE_RANGE = 6;
  var COLOR_ACTIVE = "#06ff00";
  var COLOR_BLOCKED = "#ff3600";
  var TIR_TAG = /\[tir\]([0-9])\[\/tir\]/;
  function parseInfluenceRange(announcement) {
    const m = typeof announcement === "string" ? announcement.match(TIR_TAG) : null;
    const n = m ? parseInt(m[1], 10) : NaN;
    return n > 0 ? n : DEFAULT_INFLUENCE_RANGE;
  }
  function requiredOffense(level, activationDiff) {
    return level - (Number(activationDiff) || 0);
  }
  function labelText2(level, required) {
    return `T${fmt3(level)} \xB7 \u2265${fmt3(required)}`;
  }
  function tunnelColor(offense, required) {
    return offense >= required ? COLOR_ACTIVE : COLOR_BLOCKED;
  }
  function fmt3(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function rgba(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`;
  }
  function circleBox2(x, y, range) {
    const c = cellToScreen(x, y, 0.5, 0.5);
    const e = cellToScreen(x + range, y + range, 0.5, 0.5);
    const rx = Math.abs(e.left - c.left);
    const ry = Math.abs(e.top - c.top);
    return { left: c.left - rx, top: c.top - ry, width: 2 * rx, height: 2 * ry };
  }
  function readInfluenceRange() {
    try {
      return parseInfluenceRange(ClientLib.Data.MainData.GetInstance().get_Alliance().get_Announcement());
    } catch {
      return DEFAULT_INFLUENCE_RANGE;
    }
  }
  function readActivationDiff() {
    try {
      return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_POIActivationLevelDifference()) || 0;
    } catch {
      return 0;
    }
  }
  function maxOwnOffense() {
    let max = 0;
    try {
      const all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
      for (const city of Object.values(all)) {
        try {
          const off = Number(city.get_LvlOffense());
          if (off > max) max = off;
        } catch {
        }
      }
    } catch {
    }
    return max;
  }
  var TunnelInfo = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descTunnelInfo");
    }
    constructor(config) {
      this.name = "TunnelInfo";
      this.config = config;
      this.running = false;
      this.tunnels = /* @__PURE__ */ new Map();
      this._events = [];
      this._interval = null;
      this._raf = null;
    }
    async start() {
      this.running = true;
      try {
        this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
      } catch {
        this._events = [];
      }
      this._interval = setInterval(() => this.update(), REFRESH_MS3);
      this.update();
      console.log("[ST] TunnelInfo: started");
    }
    stop() {
      this.running = false;
      detachMapEvents(this, this._events);
      this._events = [];
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      this._clear();
    }
    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.update();
      });
    }
    _clear() {
      for (const tn of this.tunnels.values()) {
        tn.label.remove();
        tn.circle.remove();
      }
      this.tunnels.clear();
    }
    /** Tunnels in the visible cell range: [{x, y, level}]. */
    collect() {
      const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
      const gw = region.get_GridWidth();
      const gh = region.get_GridHeight();
      const poiType = ClientLib.Vis.VisObject.EObjectType.RegionPointOfInterest;
      const range = visibleCellRange();
      const found = /* @__PURE__ */ new Map();
      for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
          try {
            const obj = region.GetObjectFromPosition(x * gw, y * gh);
            if (!obj || obj.get_VisObjectType() !== poiType || obj.get_Type() !== 0) continue;
            const tx = obj.get_RawX();
            const ty = obj.get_RawY();
            const key = `${tx}:${ty}`;
            if (!found.has(key)) found.set(key, { x: tx, y: ty, level: Number(obj.get_Level()) });
          } catch {
          }
        }
      }
      return Array.from(found.entries());
    }
    /** Rescan and render; never throws. */
    update() {
      if (!this.running) return;
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        const influence = readInfluenceRange();
        const diff = readActivationDiff();
        const offense = maxOwnOffense();
        const keep = /* @__PURE__ */ new Set();
        for (const [key, tunnel] of this.collect()) {
          keep.add(key);
          let tn = this.tunnels.get(key);
          if (!tn) {
            tn = { label: this._createLabel(), circle: this._createCircle(), x: tunnel.x, y: tunnel.y };
            this.tunnels.set(key, tn);
          }
          const required = requiredOffense(tunnel.level, diff);
          const color = tunnelColor(offense, required);
          tn.range = influence;
          tn.label.textContent = labelText2(tunnel.level, required);
          tn.label.style.color = color;
          tn.label.title = t("tunnelInfoTitle", { level: fmt3(tunnel.level), required: fmt3(required), range: influence });
          tn.circle.style.borderColor = rgba(color, 0.6);
          tn.circle.style.background = rgba(color, 0.05);
          this._place(tn);
        }
        for (const [key, tn] of this.tunnels) {
          if (!keep.has(key)) {
            tn.label.remove();
            tn.circle.remove();
            this.tunnels.delete(key);
          }
        }
      } catch (e) {
        console.warn("[ST] TunnelInfo: update failed", e);
      }
    }
    _reposition() {
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        for (const tn of this.tunnels.values()) this._place(tn);
      } catch {
      }
    }
    _place(tn) {
      const view = viewSize();
      const pos = cellToScreen(tn.x, tn.y, 0.1, 0.1);
      const labelOn = !(pos.top < 0 || pos.left < 0 || pos.top > view.height || pos.left > view.width);
      if (labelOn) {
        tn.label.style.left = pos.left + "px";
        tn.label.style.top = pos.top + "px";
        addToMap(tn.label);
      } else if (tn.label.parentElement) {
        tn.label.remove();
      }
      if (!labelOn || !(tn.range > 0)) {
        if (tn.circle.parentElement) tn.circle.remove();
        return;
      }
      const box = circleBox2(tn.x, tn.y, tn.range);
      Object.assign(tn.circle.style, {
        left: box.left + "px",
        top: box.top + "px",
        width: box.width + "px",
        height: box.height + "px"
      });
      addToMap(tn.circle);
    }
    _createLabel() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        zIndex: "10",
        fontFamily: "Iosevka Term",
        fontWeight: "bold",
        fontSize: "12px",
        padding: "1px 4px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.75)",
        whiteSpace: "nowrap"
      });
      el.className = "st-tunnel-info";
      return el;
    }
    _createCircle() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        pointerEvents: "none",
        zIndex: "8",
        borderRadius: "50%",
        borderWidth: "2px",
        borderStyle: "dashed",
        boxSizing: "border-box"
      });
      el.className = "st-tunnel-range";
      return el;
    }
  };

  // plugins/formation-saver.js
  var STORAGE_KEY = "st-formations";
  var NAME_MAX2 = 30;
  function cleanName(name) {
    return String(name || "").trim().slice(0, NAME_MAX2);
  }
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }
  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      console.warn("[ST] FormationSaver: save failed", e);
      return false;
    }
  }
  function findFormation(list, name) {
    const key = cleanName(name).toLowerCase();
    return (list || []).find((f) => f.name.toLowerCase() === key) || null;
  }
  function matchUnits(saved, army) {
    const used = /* @__PURE__ */ new Set();
    const moves = [];
    const missing = [];
    for (const s of saved) {
      let best = null;
      for (const a of army) {
        if (used.has(a.id) || a.type !== s.type) continue;
        if (!best || Math.abs(a.level - s.level) < Math.abs(best.level - s.level)) best = a;
      }
      if (best) {
        used.add(best.id);
        moves.push({ id: best.id, x: s.x, y: s.y, enabled: s.enabled });
      } else {
        missing.push({ type: s.type, name: s.name, level: s.level });
      }
    }
    return { moves, missing };
  }
  function summarizeMissing(missing) {
    const counts = /* @__PURE__ */ new Map();
    for (const m of missing) {
      const name = m.name || String(m.type);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts, ([name, n]) => `${n}\xD7 ${name}`).join(", ");
  }
  function worldId2() {
    try {
      return String(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId());
    } catch {
      return null;
    }
  }
  function inCombatSetup() {
    try {
      return ClientLib.Vis.VisMain.GetInstance().get_Mode() === ClientLib.Vis.Mode.CombatSetup;
    } catch {
      return false;
    }
  }
  function currentFormation() {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    const own = cities.get_CurrentOwnCity();
    let targetId = 0;
    try {
      targetId = cities.get_CurrentForeignCityId();
    } catch {
    }
    if (!targetId) {
      try {
        targetId = cities.get_CurrentCity().get_Id();
      } catch {
      }
    }
    if (!own || !targetId || targetId === own.get_Id()) return null;
    const formation = own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(targetId);
    if (!formation) return null;
    const units = formation.get_ArmyUnits();
    if (!units || !units.l) return null;
    return { formation, units: units.l, own };
  }
  function unitType(unit) {
    try {
      if (typeof unit.get_MdbUnitId === "function") return unit.get_MdbUnitId();
    } catch {
    }
    try {
      return unit.get_UnitGameData_Obj().i;
    } catch {
      return null;
    }
  }
  function unitName(unit) {
    try {
      const gd = unit.get_UnitGameData_Obj();
      return gd.dn || gd.n || String(unitType(unit));
    } catch {
      return String(unitType(unit));
    }
  }
  function unitLevel(unit) {
    try {
      return Number(unit.get_CurrentLevel()) || 0;
    } catch {
      return 0;
    }
  }
  function unitId(unit) {
    try {
      return unit.get_Id();
    } catch {
      return null;
    }
  }
  function readUnits(units) {
    return units.map((u) => ({
      type: unitType(u),
      name: unitName(u),
      level: unitLevel(u),
      x: u.get_CoordX(),
      y: u.get_CoordY(),
      enabled: typeof u.get_Enabled === "function" ? !!u.get_Enabled() : true
    }));
  }
  function moveUnit(formation, unit, x, y) {
    if (typeof unit.MoveBattleUnit === "function") {
      unit.MoveBattleUnit(x, y);
    } else if (typeof formation.MoveBattleUnit === "function") {
      formation.MoveBattleUnit(unit.get_Id(), x, y);
    }
  }
  function applyMoves(formation, units, moves) {
    const byId = new Map(units.map((u) => [unitId(u), u]));
    const at = (m) => {
      const u = byId.get(m.id);
      return u && u.get_CoordX() === m.x && u.get_CoordY() === m.y;
    };
    for (let pass = 0; pass < moves.length + 2; pass++) {
      let changed = false;
      for (const m of moves) {
        if (at(m)) continue;
        try {
          moveUnit(formation, byId.get(m.id), m.x, m.y);
          changed = true;
        } catch (e) {
          console.warn("[ST] FormationSaver: move failed", e && e.message);
        }
      }
      if (!changed) break;
    }
    for (const m of moves) {
      const u = byId.get(m.id);
      if (!u || m.enabled === void 0) continue;
      try {
        if (typeof u.set_Enabled === "function") u.set_Enabled(m.enabled);
      } catch {
      }
    }
    return moves.filter(at).length;
  }
  var FormationSaver = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descFormationSaver");
    }
    constructor(config, cli) {
      this.name = "FormationSaver";
      this.config = config;
      this.cli = cli;
      this.running = false;
    }
    async start() {
      this.running = true;
      this.cli.register("formation", (args) => this.command(args || []));
      console.log("[ST] FormationSaver: started");
    }
    stop() {
      this.running = false;
    }
    /** `/st formation save|load|list|delete [name]` */
    command(args) {
      if (!this.running) return;
      const [action, ...rest] = args;
      const name = cleanName(rest.join(" "));
      switch (String(action || "").toLowerCase()) {
        case "save":
          return name ? this.save(name) : say2(escapeHtml(t("formationUsage")));
        case "load":
          return name ? this.load(name) : say2(escapeHtml(t("formationUsage")));
        case "delete":
          return name ? this.remove(name) : say2(escapeHtml(t("formationUsage")));
        case "list":
          return this.list();
        default:
          return say2(escapeHtml(t("formationUsage")));
      }
    }
    save(name) {
      const ctx = this._context();
      if (!ctx) return;
      const units = readUnits(ctx.units);
      if (!units.length) return say2(t("formationNoUnits"));
      const store = loadStore();
      const list = store[ctx.world] || [];
      const existing = findFormation(list, name);
      const entry = { name, base: safeName(ctx.own), units, savedAt: Date.now() };
      store[ctx.world] = existing ? list.map((f) => f === existing ? entry : f) : [...list, entry];
      if (!saveStore(store)) return say2(t("formationStorageFailed"));
      say2(t(existing ? "formationOverwritten" : "formationSaved", { name: escapeHtml(name), count: units.length }));
    }
    load(name) {
      const ctx = this._context();
      if (!ctx) return;
      const saved = findFormation(loadStore()[ctx.world], name);
      if (!saved) return say2(t("formationNotFound", { name: escapeHtml(name) }));
      const army = ctx.units.map((u) => ({ id: unitId(u), type: unitType(u), level: unitLevel(u) }));
      const { moves, missing } = matchUnits(saved.units, army);
      const placed = applyMoves(ctx.formation, ctx.units, moves);
      const total = saved.units.length;
      let msg = t("formationLoaded", { name: escapeHtml(saved.name), placed, total });
      if (missing.length) msg += " \u2014 " + t("formationMissing", { units: escapeHtml(summarizeMissing(missing)) });
      say2(msg);
      console.log(`[ST] FormationSaver: loaded "${saved.name}" ${placed}/${total}, missing ${missing.length}`);
    }
    list() {
      const world = worldId2();
      const list = world && loadStore()[world] || [];
      if (!list.length) return say2(t("formationListEmpty"));
      say2(t("formationListHeader", { count: list.length }));
      for (const f of list) {
        const date = new Date(f.savedAt).toLocaleString(void 0, { dateStyle: "short", timeStyle: "short" });
        say2(`${escapeHtml(f.name)} \u2014 ${t("formationListLine", { count: f.units.length, base: escapeHtml(f.base || "?"), date })}`);
      }
    }
    remove(name) {
      const world = worldId2();
      if (!world) return;
      const store = loadStore();
      const list = store[world] || [];
      const found = findFormation(list, name);
      if (!found) return say2(t("formationNotFound", { name: escapeHtml(name) }));
      store[world] = list.filter((f) => f !== found);
      if (!saveStore(store)) return say2(t("formationStorageFailed"));
      say2(t("formationDeleted", { name: escapeHtml(found.name) }));
    }
    /** World + formation in the attack setup view, or null after telling the player why. */
    _context() {
      const world = worldId2();
      if (!world || !inCombatSetup()) {
        say2(t("formationNotInSetup"));
        return null;
      }
      let ctx = null;
      try {
        ctx = currentFormation();
      } catch (e) {
        console.warn("[ST] FormationSaver: formation not readable", e);
      }
      if (!ctx) {
        say2(t("formationNotInSetup"));
        return null;
      }
      return { ...ctx, world };
    }
  };
  function safeName(city) {
    try {
      return city.get_Name();
    } catch {
      return "";
    }
  }
  function say2(msg) {
    chatMessage(`[ST] ${msg}`);
  }

  // plugins/wavy.js
  var CACHE_MS = 30 * 1e3;
  var LINE_RANGE = 50;
  var LINE_COLOR = "#00bcd4";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var FALLBACK = {
    wavyTitle: "Wavy",
    wavyCount: "Forgotten bases within attack range: {count} ({countW}) \xB7 {waves} waves",
    wavyCountOne: "Forgotten bases within attack range: {count} ({countW}) \xB7 1 wave",
    wavyLevels: "Levels: {levels}"
  };
  function tr(key, vars) {
    const s = t(key, vars);
    if (s !== key || !(key in FALLBACK)) return s;
    return FALLBACK[key].replace(/\{(\w+)\}/g, (m, name) => vars && vars[name] !== void 0 ? String(vars[name]) : m);
  }
  var STATUS_INFOS = [
    "RegionCityStatusInfoOwn",
    "RegionCityStatusInfoAlliance",
    "RegionCityStatusInfoEnemy",
    "RegionNPCBaseStatusInfo",
    "RegionNPCCampStatusInfo",
    "RegionRuinStatusInfo"
  ];
  function wavesFor(count) {
    if (count <= 21) return 1;
    if (count <= 31) return 2;
    if (count <= 41) return 3;
    if (count <= 51) return 4;
    return 5;
  }
  function formatLevels(levels) {
    const keys = Object.keys(levels).map(Number).sort((a, b) => b - a);
    if (!keys.length) return "-";
    return keys.map((l) => `${levels[l]}\xD7${l}`).join(", ");
  }
  function npcBaseType() {
    try {
      const v = ClientLib.Data.WorldSector.ObjectType.NPCBase;
      if (typeof v === "number") return v;
    } catch {
    }
    return 2;
  }
  function baseLevel(obj) {
    if (typeof obj.$Level === "number") return obj.$Level;
    try {
      if (typeof obj.get_BaseLevel === "function") return Number(obj.get_BaseLevel());
    } catch {
    }
    return null;
  }
  function scanWaves(world, x, y, range) {
    const type = npcBaseType();
    const floored = Math.floor(range);
    const reach = floored + 1;
    const levels = {};
    let count = 0;
    let countW = 0;
    for (let sx = x - reach; sx <= x + reach; sx++) {
      for (let sy = y - reach; sy <= y + reach; sy++) {
        const dist = Math.hypot(x - sx, y - sy);
        if (dist > range) continue;
        let obj;
        try {
          obj = world.GetObjectFromPosition(sx, sy);
        } catch {
          continue;
        }
        if (!obj || obj.Type !== type) continue;
        count++;
        if (dist <= floored) countW++;
        const level = baseLevel(obj);
        if (level !== null && Number.isFinite(level)) levels[level] = (levels[level] || 0) + 1;
      }
    }
    return { count, countW, waves: wavesFor(countW), levels };
  }
  function ownBases2() {
    const out = [];
    try {
      for (const c of Object.values(ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d)) {
        try {
          out.push({ x: c.get_PosX(), y: c.get_PosY() });
        } catch {
        }
      }
    } catch {
    }
    return out;
  }
  function lineTargets(x, y, bases, range = LINE_RANGE) {
    return bases.filter((b) => !(b.x === x && b.y === y)).map((b) => ({ ...b, dist: Math.hypot(b.x - x, b.y - y) })).filter((b) => b.dist <= range);
  }
  var Wavy = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descWavy");
    }
    constructor(config) {
      this.name = "Wavy";
      this.config = config;
      this.running = false;
      this._cache = /* @__PURE__ */ new Map();
      this._listeners = [];
      this._panel = null;
      this._selected = null;
      this._svg = null;
      this._events = [];
      this._warned = false;
    }
    async start() {
      this.running = true;
      this._hookPanels();
      try {
        this._events = attachMapEvents(this, () => this._drawLines(), () => this._drawLines());
      } catch {
        this._events = [];
      }
      console.log("[ST] Wavy: started");
    }
    stop() {
      this.running = false;
      for (const { widget, id } of this._listeners) {
        try {
          widget.removeListenerById(id);
        } catch {
        }
      }
      this._listeners = [];
      if (this._panel) {
        try {
          const parent = this._panel.container.getLayoutParent();
          if (parent) parent.remove(this._panel.container);
          this._panel.container.dispose();
        } catch {
        }
        this._panel = null;
      }
      detachMapEvents(this, this._events);
      this._events = [];
      this._selected = null;
      this._removeSvg();
      this._cache.clear();
    }
    /** Wave info for a position, cached CACHE_MS. */
    info(x, y, now = Date.now()) {
      const key = `${x}:${y}`;
      const hit = this._cache.get(key);
      if (hit && now - hit.at < CACHE_MS) return hit.result;
      const md = ClientLib.Data.MainData.GetInstance();
      const range = Number(md.get_Server().get_MaxAttackDistance());
      const result = scanWaves(md.get_World(), x, y, range);
      this._cache.set(key, { at: now, result });
      if (this._cache.size > 200) this._cache.delete(this._cache.keys().next().value);
      return result;
    }
    // ─── Info panel ──────────────────────────────────────────────────
    _warn(msg, e) {
      if (this._warned) return;
      this._warned = true;
      console.warn(`[ST] Wavy: ${msg}`, e && e.message ? e.message : "");
    }
    _hookPanels() {
      let region;
      try {
        region = webfrontend.gui.region;
      } catch (e) {
        this._warn("region info widgets not available \u2014 panel disabled", e);
        return;
      }
      for (const name of STATUS_INFOS) {
        try {
          const cls = region && region[name];
          if (!cls || typeof cls.getInstance !== "function") continue;
          const widget = cls.getInstance();
          const appear = widget.addListener("appear", () => this._onAppear(widget), this);
          const disappear = widget.addListener("disappear", () => this._onDisappear(widget), this);
          this._listeners.push({ widget, id: appear }, { widget, id: disappear });
        } catch (e) {
          this._warn(`could not hook ${name}`, e);
        }
      }
    }
    /** Position of the object whose info panel is shown: the selection, else the panel's own object. */
    _panelObject(widget) {
      try {
        const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
        if (sel && typeof sel.get_RawX === "function") return { x: sel.get_RawX(), y: sel.get_RawY() };
      } catch {
      }
      try {
        const parent = widget.getLayoutParent();
        const obj = parent && typeof parent.getObject === "function" ? parent.getObject() : null;
        if (obj) return { x: obj.get_RawX(), y: obj.get_RawY() };
      } catch {
      }
      return null;
    }
    _onAppear(widget) {
      if (!this.running) return;
      try {
        const pos = this._panelObject(widget);
        if (!pos) return;
        const panel = this._ensurePanel();
        if (!panel) return;
        const r = this.info(pos.x, pos.y);
        panel.title.setValue(tr("wavyTitle"));
        panel.count.setValue(tr(
          r.waves === 1 ? "wavyCountOne" : "wavyCount",
          { count: r.count, countW: r.countW, waves: r.waves }
        ));
        panel.levels.setValue(tr("wavyLevels", { levels: formatLevels(r.levels) }));
        widget.add(panel.container);
        this._selected = pos;
        this._drawLines();
      } catch (e) {
        this._warn("panel update failed", e);
      }
    }
    _onDisappear(widget) {
      try {
        if (this._panel && this._panel.container.getLayoutParent() !== widget) return;
      } catch {
      }
      this._selected = null;
      this._drawLines();
    }
    _ensurePanel() {
      if (this._panel) return this._panel;
      try {
        const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
          marginTop: 6,
          textColor: "text-region-tooltip"
        });
        const title = new qx.ui.basic.Label("Wavy").set({ font: "font_size_14", textColor: "text-region-value" });
        const count = new qx.ui.basic.Label("");
        const levels = new qx.ui.basic.Label("").set({ textColor: "text-region-value" });
        box.add(title);
        box.add(count);
        box.add(levels);
        this._panel = { container: box, title, count, levels };
      } catch (e) {
        this._warn("could not build the panel", e);
      }
      return this._panel;
    }
    // ─── Distance lines ──────────────────────────────────────────────
    _removeSvg() {
      if (this._svg) {
        try {
          this._svg.remove();
        } catch {
        }
        this._svg = null;
      }
    }
    /** (Re)draw the lines from the selected object to nearby own bases; never throws. */
    _drawLines() {
      if (!this.running) return;
      try {
        if (!this._selected || !isWorldMapVisible()) {
          this._removeSvg();
          return;
        }
        const { x, y } = this._selected;
        const targets = lineTargets(x, y, ownBases2());
        if (!targets.length) {
          this._removeSvg();
          return;
        }
        const view = viewSize();
        const svg = this._svg || document.createElementNS(SVG_NS, "svg");
        this._svg = svg;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        svg.setAttribute("width", String(view.width));
        svg.setAttribute("height", String(view.height));
        svg.setAttribute("data-st-wavy", "1");
        Object.assign(svg.style, {
          position: "absolute",
          left: "0px",
          top: "0px",
          pointerEvents: "none",
          zIndex: "9",
          overflow: "visible"
        });
        const from = cellToScreen(x, y);
        for (const b of targets) {
          const to = cellToScreen(b.x, b.y);
          const line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(from.left));
          line.setAttribute("y1", String(from.top));
          line.setAttribute("x2", String(to.left));
          line.setAttribute("y2", String(to.top));
          line.setAttribute("stroke", LINE_COLOR);
          line.setAttribute("stroke-width", "2");
          line.setAttribute("stroke-dasharray", "6 4");
          svg.appendChild(line);
          const text = document.createElementNS(SVG_NS, "text");
          text.setAttribute("x", String((from.left + to.left) / 2));
          text.setAttribute("y", String((from.top + to.top) / 2));
          text.setAttribute("fill", LINE_COLOR);
          text.setAttribute("font-size", "13");
          text.setAttribute("font-weight", "bold");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("stroke", "rgba(0,0,0,0.8)");
          text.setAttribute("stroke-width", "3");
          text.setAttribute("paint-order", "stroke");
          text.textContent = b.dist.toFixed(1);
          svg.appendChild(text);
        }
        addToMap(svg);
      } catch (e) {
        this._warn("drawing distance lines failed", e);
      }
    }
  };

  // lib/poi-util.js
  var POI_KEYS = {
    TiberiumBonus: "tib",
    CrystalBonus: "cry",
    PowerBonus: "pow",
    InfanteryBonus: "inf",
    VehicleBonus: "veh",
    AirBonus: "air",
    DefenseBonus: "def"
  };
  var KEY_ORDER = ["tib", "cry", "pow", "inf", "veh", "air", "def"];
  var RESOURCE_KEYS = /* @__PURE__ */ new Set(["tib", "cry", "pow"]);
  var BONUS_GETTERS = {
    tib: "get_POITiberiumBonus",
    cry: "get_POICrystalBonus",
    pow: "get_POIPowerBonus",
    inf: "get_POIInfantryBonus",
    veh: "get_POIVehicleBonus",
    air: "get_POIAirBonus",
    def: "get_POIDefenseBonus"
  };
  var SECTOR_FALLBACK = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  var SECTOR_TR = ["south", "southwest", "west", "northwest", "north", "northeast", "east", "southeast"];
  function fmtNumber(n) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "G";
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(Math.round(n * 10) / 10);
  }
  function fmtBonus(key, value, sign = false) {
    const s = sign && value > 0 ? "+" : "";
    return RESOURCE_KEYS.has(key) ? `${s}${fmtNumber(value)}/h` : `${s}${fmtNumber(value)}%`;
  }
  function poiKey(poiType) {
    try {
      const e = ClientLib.Base.EPOIType;
      for (const name of Object.keys(POI_KEYS)) if (e[name] === poiType) return POI_KEYS[name];
    } catch {
    }
    return null;
  }
  function sectorNo(x, y, worldWidth, worldHeight, sectorCount) {
    const cx = Math.floor(worldWidth / 2) - x;
    const cy = y - Math.floor(worldHeight / 2);
    const a = Math.atan2(cx, cy) * sectorCount / 6.283185307179586 + (sectorCount + 0.5);
    return Math.floor(a) % sectorCount;
  }
  function worldGeometry() {
    try {
      const s = ClientLib.Data.MainData.GetInstance().get_Server();
      const g = { width: s.get_WorldWidth(), height: s.get_WorldHeight(), count: s.get_SectorCount() };
      return g.width > 0 && g.height > 0 && g.count > 0 ? g : null;
    } catch {
      return null;
    }
  }
  function sectorAbbr(i) {
    try {
      const name = SECTOR_TR[i];
      const text = name ? String(qx.core.Init.getApplication().tr(`tnf:${name} abbr`)) : "";
      if (text && !text.startsWith("tnf:")) return text;
    } catch {
    }
    return SECTOR_FALLBACK[i] || String(i);
  }
  function ownAlliance() {
    try {
      const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
      if (!a || typeof a.get_Exists === "function" && !a.get_Exists()) return null;
      const id = Number(a.get_Id());
      return id > 0 ? { id, name: String(a.get_Name() || "") } : null;
    } catch {
      return null;
    }
  }
  function allianceBonuses() {
    try {
      const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
      if (!ownAlliance()) return null;
      let ranks = [];
      try {
        ranks = a.get_POIRankScore() || [];
      } catch {
      }
      let begin = 0;
      try {
        begin = ClientLib.Base.EPOIType.RankedTypeBegin;
      } catch {
      }
      const out = [];
      for (const [name, key] of Object.entries(POI_KEYS)) {
        let value = 0;
        try {
          value = Number(a[BONUS_GETTERS[key]]()) || 0;
        } catch {
        }
        let rs = null;
        try {
          rs = ranks[ClientLib.Base.EPOIType[name] - begin] || null;
        } catch {
        }
        out.push({ key, value, rank: rs ? rs.r : null, score: rs ? rs.s : null });
      }
      return out;
    } catch {
      return null;
    }
  }
  function ownedPois() {
    try {
      const a = ClientLib.Data.MainData.GetInstance().get_Alliance();
      if (!ownAlliance()) return [];
      return (a.get_OwnedPOIs() || []).map((p) => ({ x: Number(p.x), y: Number(p.y), level: Number(p.l) }));
    } catch {
      return [];
    }
  }
  function poiObjectType() {
    try {
      const v = ClientLib.Data.WorldSector.ObjectType.PointOfInterest;
      if (typeof v === "number") return v;
    } catch {
    }
    return 4;
  }
  function poiFromVisObject(obj) {
    try {
      if (!obj) return null;
      const visType = ClientLib.Vis.VisObject.EObjectType.RegionPointOfInterest;
      if (typeof obj.get_VisObjectType === "function" && obj.get_VisObjectType() !== visType) return null;
      const worldType = obj.get_Type();
      let tunnel;
      try {
        tunnel = ClientLib.Data.WorldSector.WorldObjectPointOfInterest.EPOIType.TunnelExit;
      } catch {
        tunnel = void 0;
      }
      if (tunnel !== void 0 && worldType === tunnel) return null;
      const poiType = ClientLib.Base.PointOfInterestTypes.GetPOITypeFromWorldPOIType(worldType);
      const key = poiKey(poiType);
      if (!key) return null;
      return {
        key,
        poiType,
        level: Number(obj.get_Level()),
        ownerId: Number(obj.get_OwnerAllianceId()) || 0,
        ownerName: String(typeof obj.get_OwnerAllianceName === "function" && obj.get_OwnerAllianceName() || "")
      };
    } catch {
      return null;
    }
  }
  function visiblePois() {
    const md = ClientLib.Data.MainData.GetInstance();
    const world = md.get_World();
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    const gw = region.get_GridWidth();
    const gh = region.get_GridHeight();
    const type = poiObjectType();
    const range = visibleCellRange();
    const out = [];
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        try {
          const w = world.GetObjectFromPosition(x, y);
          if (!w || w.Type !== type) continue;
          const poi = poiFromVisObject(region.GetObjectFromPosition(x * gw, y * gh));
          if (poi) out.push({ x, y, ...poi });
        } catch {
        }
      }
    }
    return out;
  }
  function poiScore(level) {
    try {
      return Number(ClientLib.Base.PointOfInterestTypes.GetScoreByLevel(level)) || 0;
    } catch {
      return 0;
    }
  }
  function realPoiDelta(ctx, total) {
    const { own, ownerIsAlliance, poiScore: ps, rank, score, nextScore, prevScore } = ctx;
    const current = total(rank, score);
    if (own) {
      if (prevScore <= 0 || score - ps >= prevScore) return { kind: "loss", value: current - total(rank, score - ps) };
      return { kind: "loss", value: null };
    }
    if (!score) return { kind: "gain", value: null };
    if (nextScore <= 0 || rank <= 1) return { kind: "gain", value: total(rank, score + ps) - current };
    if (ownerIsAlliance) return { kind: "gain", value: null };
    if (score + ps > nextScore) return { kind: "gain", value: null };
    if (score + ps < nextScore) return { kind: "gain", value: total(rank, score + ps) - current };
    return { kind: "gain", value: total(rank - 1, score + ps) - current };
  }
  function rankedPoiDelta(ctx, rows, total) {
    let others = rows.map((r) => ({ a: r.a, pois: Number(r.pois) || 0 }));
    const isGain = !ctx.own;
    if (isGain && ctx.poiOwnerId) {
      const owner = others.find((r) => r.a === ctx.poiOwnerId);
      if (owner) {
        owner.pois -= ctx.poiScore;
        others.sort((a, b) => b.pois - a.pois);
      }
    }
    const newScore = ctx.score + (isGain ? ctx.poiScore : -ctx.poiScore);
    let i = 0;
    while (i < others.length && others[i].pois > newScore) i++;
    const current = total(ctx.rank, ctx.score);
    const next = total(i + 1, newScore);
    return { kind: isGain ? "gain" : "loss", value: isGain ? next - current : current - next };
  }
  function sectorSummary(pois, ownId, geo) {
    const out = [];
    for (let i = 0; i < geo.count; i++) out.push({ sector: i, own: 0, enemy: 0, free: 0, status: "none" });
    for (const p of pois) {
      const s = out[sectorNo(p.x, p.y, geo.width, geo.height, geo.count)];
      if (!s) continue;
      if (!p.ownerId) s.free++;
      else if (ownId && p.ownerId === ownId) s.own++;
      else s.enemy++;
    }
    for (const s of out) {
      if (s.own > 0 && s.own >= s.enemy) s.status = "own";
      else if (s.enemy > 0) s.status = "enemy";
    }
    return out;
  }

  // plugins/poi-analyser.js
  var REFRESH_MS4 = 3e3;
  var RANKING_CACHE_MS = 10 * 60 * 1e3;
  var COLORS = { own: "#ffc107", enemy: "#ef5350", free: "#bdbdbd" };
  var BASE_INFOS = ["RegionCityStatusInfoOwn", "RegionCityStatusInfoAlliance"];
  var POI_INFO = "RegionPointOfInterestStatusInfo";
  function labelText3(poi) {
    return `${t(`poiShort_${poi.key}`)} ${Math.floor(poi.level)}`;
  }
  function ownerKind(ownerId, ownId) {
    if (!ownerId) return "free";
    return ownId && ownerId === ownId ? "own" : "enemy";
  }
  function bonusLines(bonuses) {
    return (bonuses || []).filter((b) => b.value > 0).sort((a, b) => KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key)).map((b) => t(
      b.rank ? "poiBonusLineRank" : "poiBonusLine",
      { type: t(`poiName_${b.key}`), bonus: fmtBonus(b.key, b.value, true), rank: b.rank }
    ));
  }
  var PoiAnalyser = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descPoiAnalyser");
    }
    constructor(config) {
      this.name = "PoiAnalyser";
      this.config = config;
      this.running = false;
      this.labels = /* @__PURE__ */ new Map();
      this._events = [];
      this._interval = null;
      this._raf = null;
      this._listeners = [];
      this._panel = null;
      this._rankingCache = {};
      this._poiPanelKey = null;
      this._warned = false;
    }
    async start() {
      this.running = true;
      try {
        this._events = attachMapEvents(this, () => this._reposition(), () => this._schedule());
      } catch {
        this._events = [];
      }
      this._interval = setInterval(() => this.update(), REFRESH_MS4);
      this._hookPanels();
      this.update();
      console.log("[ST] PoiAnalyser: started");
    }
    stop() {
      this.running = false;
      detachMapEvents(this, this._events);
      this._events = [];
      if (this._interval) clearInterval(this._interval);
      if (this._raf) cancelAnimationFrame(this._raf);
      this._interval = this._raf = null;
      for (const { widget, id } of this._listeners) {
        try {
          widget.removeListenerById(id);
        } catch {
        }
      }
      this._listeners = [];
      if (this._panel) {
        try {
          const parent = this._panel.container.getLayoutParent();
          if (parent) parent.remove(this._panel.container);
          this._panel.container.dispose();
        } catch {
        }
        this._panel = null;
      }
      this._poiPanelKey = null;
      this._clear();
    }
    /** One-line status for `/st status`. */
    statusText() {
      const n = (allianceBonuses() || []).filter((b) => b.value > 0).length;
      return t("poiStatus", { labels: this.labels.size, types: n });
    }
    _warn(msg, e) {
      if (this._warned) return;
      this._warned = true;
      console.warn(`[ST] PoiAnalyser: ${msg}`, e && e.message ? e.message : "");
    }
    // ─── Map labels ──────────────────────────────────────────────────
    _schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.update();
      });
    }
    _clear() {
      for (const { el } of this.labels.values()) el.remove();
      this.labels.clear();
    }
    /** Rescan the visible POIs and render their labels; never throws. */
    update() {
      if (!this.running) return;
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        const own = ownAlliance();
        const keep = /* @__PURE__ */ new Set();
        for (const poi of visiblePois()) {
          const key = `${poi.x}:${poi.y}`;
          keep.add(key);
          let label = this.labels.get(key);
          if (!label) {
            label = { el: this._createElement(), x: poi.x, y: poi.y };
            this.labels.set(key, label);
          }
          const kind = ownerKind(poi.ownerId, own && own.id);
          label.el.textContent = labelText3(poi);
          label.el.style.color = COLORS[kind];
          label.el.title = t("poiLabelTitle", {
            type: t(`poiName_${poi.key}`),
            level: Math.floor(poi.level),
            score: fmtNumber(poiScore(poi.level)),
            owner: poi.ownerId ? poi.ownerName || `#${poi.ownerId}` : t("poiOwnerNone")
          });
          this._place(label);
        }
        for (const [key, label] of this.labels) {
          if (!keep.has(key)) {
            label.el.remove();
            this.labels.delete(key);
          }
        }
      } catch (e) {
        this._warn("update failed", e);
      }
    }
    _reposition() {
      try {
        if (!isWorldMapVisible()) {
          this._clear();
          return;
        }
        for (const label of this.labels.values()) this._place(label);
      } catch {
      }
    }
    _place(label) {
      const { left, top } = cellToScreen(label.x, label.y, 0.1, 0.1);
      const view = viewSize();
      if (top < 0 || left < 0 || top > view.height || left > view.width) {
        if (label.el.parentElement) label.el.remove();
        return;
      }
      label.el.style.left = left + "px";
      label.el.style.top = top + "px";
      addToMap(label.el);
    }
    _createElement() {
      const el = document.createElement("div");
      Object.assign(el.style, {
        // Base Info's label style
        position: "absolute",
        pointerEvents: "none",
        zIndex: "10",
        fontFamily: "Iosevka Term",
        fontWeight: "bold",
        fontSize: "12px",
        padding: "1px 4px",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.75)",
        whiteSpace: "nowrap"
      });
      el.setAttribute("data-st-poi", "1");
      return el;
    }
    // ─── Info panel ──────────────────────────────────────────────────
    _hookPanels() {
      let region;
      try {
        region = webfrontend.gui.region;
      } catch (e) {
        this._warn("region info widgets not available \u2014 panel disabled", e);
        return;
      }
      for (const name of [...BASE_INFOS, POI_INFO]) {
        try {
          const cls = region && region[name];
          if (!cls || typeof cls.getInstance !== "function") continue;
          const widget = cls.getInstance();
          const id = widget.addListener("appear", () => this._onAppear(widget, name), this);
          this._listeners.push({ widget, id });
        } catch (e) {
          this._warn(`could not hook ${name}`, e);
        }
      }
    }
    _ensurePanel() {
      if (this._panel) return this._panel;
      try {
        const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
          marginTop: 6,
          textColor: "text-region-tooltip"
        });
        const title = new qx.ui.basic.Label("POI").set({ font: "font_size_14", textColor: "text-region-value" });
        const body = new qx.ui.basic.Label("").set({ rich: true, textColor: COLORS.own });
        box.add(title);
        box.add(body);
        this._panel = { container: box, title, body };
      } catch (e) {
        this._warn("could not build the panel", e);
      }
      return this._panel;
    }
    _setPanel(widget, lines, color = COLORS.own) {
      const panel = this._ensurePanel();
      if (!panel) return;
      panel.title.setValue(t("poiTitle"));
      panel.body.setValue(lines.map(escape).join("<br>"));
      panel.body.setTextColor(color);
      widget.add(panel.container);
    }
    _onAppear(widget, name) {
      if (!this.running) return;
      try {
        if (name === POI_INFO) this._showPoi(widget);
        else this._showBase(widget);
      } catch (e) {
        this._warn("panel update failed", e);
      }
    }
    _showBase(widget) {
      this._poiPanelKey = null;
      const bonuses = allianceBonuses();
      if (!bonuses) return;
      const lines = bonusLines(bonuses);
      this._setPanel(
        widget,
        lines.length ? [t("poiAllianceBonus"), ...lines] : [t("poiNone")],
        lines.length ? COLORS.own : COLORS.free
      );
    }
    /** The selected POI vis object (selection first, else the panel's own object). */
    _selectedPoi(widget) {
      try {
        const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
        if (sel && poiFromVisObject(sel)) return sel;
      } catch {
      }
      try {
        const obj = typeof widget.getObject === "function" ? widget.getObject() : null;
        if (obj && poiFromVisObject(obj)) return obj;
      } catch {
      }
      return null;
    }
    _showPoi(widget) {
      const vis = this._selectedPoi(widget);
      const poi = vis && poiFromVisObject(vis);
      if (!poi) return;
      const own = ownAlliance();
      const kind = ownerKind(poi.ownerId, own && own.id);
      const score = poiScore(poi.level);
      const head = t("poiInfoLine", {
        type: t(`poiName_${poi.key}`),
        level: Math.floor(poi.level),
        score: fmtNumber(score),
        owner: poi.ownerId ? poi.ownerName || `#${poi.ownerId}` : t("poiOwnerNone")
      });
      let key = null;
      try {
        key = `${vis.get_RawX()}:${vis.get_RawY()}`;
      } catch {
        key = `${poi.key}:${poi.level}:${poi.ownerId}`;
      }
      this._poiPanelKey = key;
      if (!own) {
        this._setPanel(widget, [head], COLORS[kind]);
        return;
      }
      const ctx = this._deltaContext(poi, own, score);
      if (!ctx) {
        this._setPanel(widget, [head], COLORS[kind]);
        return;
      }
      const direct = realPoiDelta(ctx, ctx.total);
      if (direct.value !== null) {
        this._setPanel(widget, [head, this._deltaText(poi.key, direct)], COLORS[kind]);
        return;
      }
      this._setPanel(widget, [head, t(direct.kind === "loss" ? "poiRealLoss" : "poiRealGain", { value: t("poiLoading") })], COLORS[kind]);
      this._fetchRanking(poi.poiType, own.id, (rows) => {
        if (!this.running || this._poiPanelKey !== key) return;
        const ranked = rankedPoiDelta({ ...ctx, poiOwnerId: poi.ownerId }, rows, ctx.total);
        this._setPanel(widget, [head, this._deltaText(poi.key, ranked)], COLORS[kind]);
      });
    }
    _deltaText(key, d) {
      return t(d.kind === "loss" ? "poiRealLoss" : "poiRealGain", { value: fmtBonus(key, d.value, d.kind === "gain") });
    }
    /** Rank/score of the own alliance for this POI type + the game's bonus formula. */
    _deltaContext(poi, own, score) {
      try {
        const md = ClientLib.Data.MainData.GetInstance();
        const rs = md.get_Alliance().get_POIRankScore()[poi.poiType - ClientLib.Base.EPOIType.RankedTypeBegin];
        if (!rs) return null;
        const factor = md.get_Server().get_POIGlobalBonusFactor();
        const util = ClientLib.Base.PointOfInterestTypes;
        let noAlliance = 0;
        try {
          noAlliance = webfrontend.gui.widgets.AllianceLabel.ESpecialNoAllianceName;
        } catch {
        }
        return {
          own: poi.ownerId === own.id,
          ownerIsAlliance: !!poi.ownerId && poi.ownerId !== noAlliance,
          poiScore: score,
          rank: rs.r,
          score: rs.s,
          nextScore: rs.ns,
          prevScore: rs.ps,
          total: (rank, s) => util.GetTotalBonusByType(poi.poiType, rank, s, factor)
        };
      } catch {
        return null;
      }
    }
    /** Other alliances' scores for this POI type (RankingGetData, read-only), cached 10 min. */
    _fetchRanking(poiType, ownId, done) {
      const hit = this._rankingCache[poiType];
      if (hit && hit.expire >= Date.now()) {
        done(hit.rows);
        return;
      }
      try {
        const R = ClientLib.Data.Ranking;
        const E = ClientLib.Base.EPOIType;
        const rankingType = {
          [E.TiberiumBonus]: R.ERankingType.BonusTiberium,
          [E.CrystalBonus]: R.ERankingType.BonusCrystal,
          [E.PowerBonus]: R.ERankingType.BonusPower,
          [E.InfanteryBonus]: R.ERankingType.BonusInfantry,
          [E.VehicleBonus]: R.ERankingType.BonusVehicles,
          [E.AirBonus]: R.ERankingType.BonusAircraft,
          [E.DefenseBonus]: R.ERankingType.BonusDefense
        }[poiType];
        const sortColumn = {
          [R.ERankingType.BonusTiberium]: R.ESortColumn.TiberiumScore,
          [R.ERankingType.BonusCrystal]: R.ESortColumn.CrystalScore,
          [R.ERankingType.BonusPower]: R.ESortColumn.PowerScore,
          [R.ERankingType.BonusInfantry]: R.ESortColumn.InfantryScore,
          [R.ERankingType.BonusVehicles]: R.ESortColumn.VehicleScore,
          [R.ERankingType.BonusAircraft]: R.ESortColumn.AircraftScore,
          [R.ERankingType.BonusDefense]: R.ESortColumn.DefenseScore
        }[rankingType];
        const lastIndex = Object.keys(ClientLib.Res.ResMain.GetInstance().GetGamedata().poibmbr).length;
        ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand("RankingGetData", {
          firstIndex: 0,
          lastIndex,
          view: R.EViewType.Alliance,
          rankingType,
          sortColumn,
          ascending: true
        }, webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, data) => {
          if (!data || !Array.isArray(data.a)) return;
          const rows = data.a.filter((r) => r.a !== ownId).map((r) => ({ a: r.a, pois: r.pois || 0 }));
          this._rankingCache[poiType] = { expire: Date.now() + RANKING_CACHE_MS, rows };
          done(rows);
        }), null);
      } catch (e) {
        this._warn("RankingGetData failed", e);
      }
    }
  };
  function escape(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // plugins/sector-hud.js
  var TICK_MS = 1e3;
  var SCAN_MS = 3e3;
  var STATUS_COLORS = { own: "#66bb6a", enemy: "#ef5350", none: "#9e9e9e" };
  function viewCenter(region) {
    const zoom = region.get_ZoomFactor();
    return {
      x: Math.floor((region.get_PosX() + region.get_ViewWidth() / 2 / zoom) / region.get_GridWidth() - 0.5),
      y: Math.floor((region.get_PosY() + region.get_ViewHeight() / 2 / zoom) / region.get_GridHeight() - 0.5)
    };
  }
  function parseCoords(text) {
    const m = /(\[coords\])?#?(\d{1,4})\D(\d{1,4})/i.exec(String(text || ""));
    return m ? { x: parseInt(m[2], 10), y: parseInt(m[3], 10) } : null;
  }
  var SectorHud = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descSectorHud");
    }
    constructor(config) {
      this.name = "SectorHud";
      this.config = config;
      this.running = false;
      this.seen = /* @__PURE__ */ new Map();
      this.el = null;
      this._timer = null;
      this._lastScan = 0;
      this._warned = false;
    }
    async start() {
      this.running = true;
      this._timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
      console.log("[ST] SectorHud: started");
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
      return t("sectorHudStatus", { n: this.seen.size });
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
          if (this.el) this.el.style.display = "none";
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
          console.warn("[ST] SectorHud: update failed", e && e.message);
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
      el.style.display = "";
      el.textContent = "";
      const line1 = document.createElement("div");
      const coords = document.createElement("span");
      coords.textContent = `${c.x}:${c.y} `;
      const sec = document.createElement("span");
      sec.textContent = `[${sectorAbbr(here)}]`;
      sec.style.color = STATUS_COLORS[cur.status];
      sec.style.fontWeight = "bold";
      const poi = document.createElement("span");
      poi.textContent = " \xB7 " + t("sectorHudPoi", { own: cur.own, enemy: cur.enemy, free: cur.free });
      line1.append(coords, sec, poi);
      const line2 = document.createElement("div");
      line2.style.marginTop = "1px";
      for (const s of summary) {
        const chip = document.createElement("span");
        chip.textContent = `${sectorAbbr(s.sector)} ${s.own}`;
        chip.style.color = STATUS_COLORS[s.status];
        chip.style.marginRight = "6px";
        if (s.sector === here) chip.style.textDecoration = "underline";
        line2.appendChild(chip);
      }
      el.append(line1, line2);
      el.title = [
        ...summary.map((s) => `${sectorAbbr(s.sector)}: ${t("sectorHudPoi", { own: s.own, enemy: s.enemy, free: s.free })}`),
        t("sectorHudSeenNote"),
        t("sectorHudClickNote")
      ].join("\n");
    }
    _ensureElement() {
      if (this.el) return this.el;
      const el = document.createElement("div");
      Object.assign(el.style, {
        // WarChiefs' spot: desktop left 128, top 0
        position: "fixed",
        left: "128px",
        top: "0px",
        zIndex: "100000",
        padding: "2px 8px",
        background: "rgba(0,0,0,0.75)",
        borderRadius: "0 0 4px 4px",
        color: "#ffffff",
        fontFamily: "Iosevka Term, monospace",
        fontSize: "11px",
        lineHeight: "1.35",
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap"
      });
      el.setAttribute("data-st-sectorhud", "1");
      el.addEventListener("mousedown", (e) => {
        if (e.button === 0) this._pasteCoords();
        if (e.button === 2) this._jumpCoords();
      });
      el.addEventListener("contextmenu", (e) => e.preventDefault());
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
        const value = dom.value || "";
        input.setValue([
          value.substring(0, dom.selectionStart),
          `[coords]${c.x}:${c.y}[/coords]`,
          value.substring(dom.selectionEnd)
        ].join(" "));
      } catch (e) {
        console.warn("[ST] SectorHud: paste coords failed", e && e.message);
      }
    }
    /** Right click: ask for coordinates and centre the map there (WarChiefs' jump_Coords). */
    _jumpCoords() {
      try {
        const c = parseCoords(window.prompt(t("sectorHudJumpPrompt")));
        if (c) ClientLib.Vis.VisMain.GetInstance().get_Region().CenterGridPosition(c.x, c.y);
      } catch (e) {
        console.warn("[ST] SectorHud: jump failed", e && e.message);
      }
    }
  };

  // plugins/movable-menu.js
  var SCAN_MS2 = 1e3;
  var HEADER_PX = 40;
  var DRAG_THRESHOLD_PX = 4;
  var MIN_VISIBLE_PX = 80;
  var MAX_ENTRIES = 60;
  var STORE_KEY = "MovableMenu.positions";
  function clampPosition(left, top, w, vw, vh) {
    const minLeft = -Math.max(0, w - MIN_VISIBLE_PX);
    const maxLeft = Math.max(0, vw - MIN_VISIBLE_PX);
    return {
      left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
      top: Math.round(Math.min(Math.max(top, 0), Math.max(0, vh - 30)))
    };
  }
  function widgetId(w) {
    const cls = String(w && w.classname || "");
    if (cls === "webfrontend.gui.OverlayWindow" && typeof w.getCaption === "function") {
      const cap = String(w.getCaption() || "").replace(/[\d()]/g, "").trim();
      if (cap) return `${cls}:${cap}`;
    }
    return cls;
  }
  function domOf(widget) {
    try {
      const el = typeof widget.getContainerElement === "function" ? widget.getContainerElement() : widget.getContentElement();
      return el && el.getDomElement() || null;
    } catch {
      return null;
    }
  }
  function windowClass() {
    try {
      return qx.ui.window.Window;
    } catch {
      return null;
    }
  }
  function overlayClass() {
    try {
      return webfrontend.gui.MenuOverlayWidget;
    } catch {
      return null;
    }
  }
  var MovableMenu = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descMovableMenu");
    }
    constructor(config) {
      this.name = "MovableMenu";
      this.config = config;
      this.running = false;
      this._timer = null;
      this._hooked = /* @__PURE__ */ new Set();
      this._qxListeners = [];
      this._domListeners = [];
      this._madeMovable = [];
      this._shifted = /* @__PURE__ */ new Set();
      this._attached = /* @__PURE__ */ new Set();
      this._warned = false;
    }
    async start() {
      this.running = true;
      this._timer = setInterval(() => this.scan(), SCAN_MS2);
      this.scan();
      console.log("[ST] MovableMenu: started");
    }
    stop() {
      this.running = false;
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      for (const { widget, id } of this._qxListeners) {
        try {
          widget.removeListenerById(id);
        } catch {
        }
      }
      for (const { el, type, fn, capture } of this._domListeners) el.removeEventListener(type, fn, capture);
      for (const win of this._madeMovable) {
        try {
          win.setMovable(false);
        } catch {
        }
      }
      for (const el of this._shifted) el.style.transform = "";
      this._qxListeners = [];
      this._domListeners = [];
      this._madeMovable = [];
      this._shifted.clear();
      this._attached.clear();
      this._hooked.clear();
    }
    /** One-line status for `/st status`. */
    statusText() {
      return t("movableMenuStatus", { n: Object.keys(this._positions()).length });
    }
    // ─── Storage ─────────────────────────────────────────────────────
    _positions() {
      const p = this.config.get(STORE_KEY, {});
      return p && typeof p === "object" ? p : {};
    }
    _save(id, pos) {
      const all = this._positions();
      delete all[id];
      all[id] = pos;
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
      this.config.set(STORE_KEY, all);
    }
    // ─── Scan ────────────────────────────────────────────────────────
    /** Root + desktop children that are game windows or menu overlays. */
    candidates() {
      const out = [];
      let app;
      try {
        app = qx.core.Init.getApplication();
      } catch {
        return out;
      }
      for (const getter of ["getRoot", "getDesktop"]) {
        try {
          const parent = typeof app[getter] === "function" ? app[getter]() : null;
          if (parent) {
            for (const c of parent.getChildren()) if (!out.includes(c)) out.push(c);
          }
        } catch {
        }
      }
      return out;
    }
    scan() {
      if (!this.running) return;
      try {
        const Win = windowClass();
        const Overlay = overlayClass();
        for (const w of this.candidates()) {
          if (this._hooked.has(w)) continue;
          if (Overlay && w instanceof Overlay) this._hookOverlay(w);
          else if (Win && w instanceof Win && widgetId(w).startsWith("webfrontend.")) this._hookWindow(w);
        }
      } catch (e) {
        if (!this._warned) {
          this._warned = true;
          console.warn("[ST] MovableMenu: scan failed", e && e.message);
        }
      }
    }
    _listen(widget, type, fn) {
      const id = widget.addListener(type, fn, this);
      this._qxListeners.push({ widget, id });
    }
    _domListen(el, type, fn, capture = false) {
      el.addEventListener(type, fn, capture);
      this._domListeners.push({ el, type, fn, capture });
    }
    _viewport() {
      return { vw: window.innerWidth || 1024, vh: window.innerHeight || 768 };
    }
    // ─── qx windows ──────────────────────────────────────────────────
    _hookWindow(win) {
      this._hooked.add(win);
      try {
        if (typeof win.getMovable === "function" && !win.getMovable()) {
          win.setMovable(true);
          this._madeMovable.push(win);
        }
      } catch {
      }
      this._listen(win, "appear", () => {
        this._attachWindowDom(win);
        this._restoreWindow(win);
        setTimeout(() => this._restoreWindow(win), 0);
      });
      if (win.isVisible && win.isVisible()) {
        this._attachWindowDom(win);
        this._restoreWindow(win);
      }
    }
    _attachWindowDom(win) {
      const el = domOf(win);
      if (!el || this._attached.has(el)) return;
      this._attached.add(el);
      this._domListen(el, "mousedown", () => {
        const start = { ...win.getLayoutProperties() || {} };
        const up = () => {
          document.removeEventListener("mouseup", up, true);
          setTimeout(() => this._saveWindow(win, start), 0);
        };
        document.addEventListener("mouseup", up, true);
      }, true);
    }
    _saveWindow(win, start) {
      if (!this.running) return;
      const p = win.getLayoutProperties() || {};
      if (typeof p.left !== "number" || typeof p.top !== "number") return;
      if (p.left === start.left && p.top === start.top) return;
      this._save(widgetId(win), { left: p.left, top: p.top });
    }
    _restoreWindow(win) {
      if (!this.running) return;
      const pos = this._positions()[widgetId(win)];
      if (!pos || typeof pos.left !== "number") return;
      const b = win.getBounds && win.getBounds() || {};
      const { vw, vh } = this._viewport();
      const c = clampPosition(pos.left, pos.top, b.width || 0, vw, vh);
      const cur = win.getLayoutProperties() || {};
      if (cur.left !== c.left || cur.top !== c.top) win.moveTo(c.left, c.top);
    }
    // ─── Menu overlays ───────────────────────────────────────────────
    _hookOverlay(ov) {
      this._hooked.add(ov);
      this._listen(ov, "appear", () => {
        this._attachOverlayDom(ov);
        this._restoreOverlay(ov);
      });
      if (ov.isVisible && ov.isVisible()) {
        this._attachOverlayDom(ov);
        this._restoreOverlay(ov);
      }
    }
    _offset(el) {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || "");
      return m ? { dx: Number(m[1]), dy: Number(m[2]) } : { dx: 0, dy: 0 };
    }
    /** Clamp a translate offset so the overlay stays reachable, then apply it. */
    _shift(el, dx, dy) {
      const cur = this._offset(el);
      const r = el.getBoundingClientRect();
      const baseLeft = r.left - cur.dx;
      const baseTop = r.top - cur.dy;
      const { vw, vh } = this._viewport();
      const c = clampPosition(baseLeft + dx, baseTop + dy, r.width, vw, vh);
      const off = { dx: c.left - Math.round(baseLeft), dy: c.top - Math.round(baseTop) };
      el.style.transform = off.dx || off.dy ? `translate(${off.dx}px, ${off.dy}px)` : "";
      this._shifted.add(el);
      return off;
    }
    _restoreOverlay(ov) {
      if (!this.running) return;
      const el = domOf(ov);
      const pos = this._positions()[widgetId(ov)];
      if (el && pos && typeof pos.dx === "number") this._shift(el, pos.dx, pos.dy);
    }
    _attachOverlayDom(ov) {
      const el = domOf(ov);
      if (!el || this._attached.has(el)) return;
      this._attached.add(el);
      this._domListen(el, "mousedown", (e) => {
        if (!this.running || e.button !== 0) return;
        const r = el.getBoundingClientRect();
        if (e.clientY - r.top > HEADER_PX) return;
        const start = { x: e.clientX, y: e.clientY, ...this._offset(el) };
        let dragging = false;
        let off = null;
        const move = (ev) => {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
          if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
          if (!dragging) {
            dragging = true;
            document.body.style.userSelect = "none";
          }
          off = this._shift(el, start.dx + dx, start.dy + dy);
        };
        const up = () => {
          document.removeEventListener("mousemove", move, true);
          document.removeEventListener("mouseup", up, true);
          if (!dragging) return;
          document.body.style.userSelect = "";
          if (off) this._save(widgetId(ov), off);
          const swallow = (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          document.addEventListener("click", swallow, true);
          setTimeout(() => document.removeEventListener("click", swallow, true), 0);
        };
        document.addEventListener("mousemove", move, true);
        document.addEventListener("mouseup", up, true);
      }, true);
    }
  };

  // plugins/transfer-all.js
  var COST_OK = "#ffffff";
  var COST_TOO_HIGH = "#ef5350";
  function resourceTypes() {
    const e = ClientLib.Base.EResourceType;
    return [{ key: "tib", type: e.Tiberium }, { key: "cry", type: e.Crystal }];
  }
  function tradeOk(city) {
    try {
      return city.CanTrade() === ClientLib.Data.ETradeError.None;
    } catch {
      return false;
    }
  }
  function freeStorage(city, type) {
    try {
      const max = Number(city.GetResourceMaxStorage(type));
      if (!(max > 0)) return Infinity;
      return Math.max(0, Math.floor(max - Number(city.GetResourceCount(type))));
    } catch {
      return Infinity;
    }
  }
  function planTransfers(target, sources, credits2) {
    const items = [];
    const skippedFull = [];
    let skippedCredits = 0;
    let left = Number(credits2);
    if (!Number.isFinite(left)) left = Infinity;
    if (!tradeOk(target)) return { items, skippedFull, skippedCredits, cost: 0 };
    for (const { key, type } of resourceTypes()) {
      let free = freeStorage(target, type);
      if (free <= 0) {
        skippedFull.push(key);
        continue;
      }
      for (const source of sources) {
        if (free <= 0) break;
        if (source === target || !tradeOk(source)) continue;
        const amount = Math.min(Math.floor(Number(source.GetResourceCount(type)) || 0), free);
        if (amount <= 0) continue;
        const cost = Number(source.CalculateTradeCostToCoord(target.get_PosX(), target.get_PosY(), amount)) || 0;
        if (cost > left) {
          skippedCredits++;
          continue;
        }
        left -= cost;
        free -= amount;
        items.push({ source, type, key, amount, cost });
      }
    }
    return { items, skippedFull, skippedCredits, cost: items.reduce((s, i) => s + i.cost, 0) };
  }
  function ownCities() {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    return { target: cities.get_CurrentOwnCity(), all: Object.values(cities.get_AllCities().d) };
  }
  function credits() {
    try {
      return ClientLib.Data.MainData.GetInstance().get_Player().GetCreditsCount();
    } catch {
      return Infinity;
    }
  }
  function fmt4(n) {
    try {
      return String(phe.cnc.gui.util.Numbers.formatNumbersCompactAfterMillion(n));
    } catch {
      return fmtNumber(n);
    }
  }
  var TransferAll = class _TransferAll {
    /** Short description for `/st help`. */
    get description() {
      return t("descTransferAll");
    }
    constructor(config) {
      this.name = "TransferAll";
      this.config = config;
      this.running = false;
      this.busy = false;
      this._widgets = null;
      this._listeners = [];
      this._timer = null;
    }
    async start() {
      this.running = true;
      if (!this._install()) {
        let tries = 0;
        this._timer = setInterval(() => {
          if (this._install() || ++tries >= 30) {
            clearInterval(this._timer);
            this._timer = null;
            if (!this._widgets) console.warn("[ST] TransferAll: transfer panel not found \u2014 no button");
          }
        }, 2e3);
      }
      console.log("[ST] TransferAll: started");
    }
    stop() {
      this.running = false;
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      for (const { widget, id } of this._listeners) {
        try {
          widget.removeListenerById(id);
        } catch {
        }
      }
      this._listeners = [];
      if (this._widgets) {
        const { container, button, check, cost } = this._widgets;
        for (const w of [button, check, cost]) {
          try {
            container.remove(w);
            w.dispose();
          } catch {
          }
        }
        this._widgets = null;
      }
    }
    /** The overlay's container the original adds its button to, or null. */
    static findContainer() {
      try {
        const overlay = webfrontend.gui.trade.TradeOverlay.getInstance();
        const parts = overlay.getLayoutChildren()[13].getLayoutChildren()[1].getLayout()._getLayoutChildren();
        const container = parts[3];
        return container && typeof container.add === "function" ? { overlay, container } : null;
      } catch {
        return null;
      }
    }
    _install() {
      if (this._widgets || !this.running) return !!this._widgets;
      const found = _TransferAll.findContainer();
      if (!found) return false;
      const { overlay, container } = found;
      const button = new webfrontend.ui.SoundButton(t("transferAllButton")).set({
        width: 90,
        enabled: false,
        toolTipText: t("transferAllTooltip")
      });
      const check = new qx.ui.form.CheckBox("");
      check.setToolTipText(t("transferAllCheckTooltip"));
      const cost = new qx.ui.basic.Label("").set({ textColor: COST_OK });
      const on = (widget, type, fn) => this._listeners.push({ widget, id: widget.addListener(type, fn, this) });
      on(check, "changeValue", () => this._onCheck());
      on(button, "click", () => this.transfer());
      on(overlay, "appear", () => check.setValue(false));
      container.add(button, { right: 2, top: 100 });
      container.add(check, { right: 96, top: 104 });
      container.add(cost, { right: 2, top: 126 });
      this._widgets = { container, button, check, cost };
      return true;
    }
    /** Checkbox: show the cost of transferring everything, arm the button. */
    _onCheck() {
      const { button, check, cost } = this._widgets;
      const armed = !!check.getValue();
      button.setEnabled(armed && !this.busy);
      if (!armed) {
        cost.setValue("");
        return;
      }
      try {
        const { target, all } = ownCities();
        const plan = planTransfers(target, all, Infinity);
        cost.setValue(t("transferAllCost", { cost: fmt4(plan.cost) }));
        cost.setTextColor(plan.cost > credits() ? COST_TOO_HIGH : COST_OK);
      } catch (e) {
        cost.setValue("");
        console.warn("[ST] TransferAll: cost calculation failed", e && e.message);
      }
    }
    /** Send the plan's SelfTrade commands one by one. */
    async transfer() {
      if (this.busy) return;
      let target;
      let plan;
      try {
        const c = ownCities();
        target = c.target;
        plan = planTransfers(target, c.all, credits());
      } catch (e) {
        console.warn("[ST] TransferAll: transfer failed", e && e.message);
        return;
      }
      this.busy = true;
      if (this._widgets) {
        this._widgets.check.setValue(false);
        this._widgets.button.setEnabled(false);
      }
      const done = { tib: 0, cry: 0 };
      let failed = 0;
      for (const item of plan.items) {
        let ok = await this._send(target, item);
        if (!ok) ok = await this._send(target, item);
        if (ok) done[item.key] += item.amount;
        else failed++;
      }
      this.busy = false;
      const name = String(target.get_Name());
      const skipped = [
        ...plan.skippedFull.map((k) => t("transferAllSkippedFull", { res: t(`poiShort_${k}`) })),
        ...plan.skippedCredits ? [t("transferAllSkippedCredits", { n: plan.skippedCredits })] : [],
        ...failed ? [t("transferAllFailed", { n: failed })] : []
      ];
      if (done.tib || done.cry) {
        console.log(`[ST] Transferred all resources to ${name} (tib ${fmtNumber(done.tib)}, cry ${fmtNumber(done.cry)})` + (skipped.length ? ` \u2014 ${skipped.join(", ")}` : ""));
      } else {
        console.log(`[ST] TransferAll: nothing transferred to ${name}` + (skipped.length ? ` \u2014 ${skipped.join(", ")}` : ""));
      }
      return { done, failed, skippedFull: plan.skippedFull, skippedCredits: plan.skippedCredits };
    }
    /** One SelfTrade; resolves true when the server answered 0 (ok). */
    _send(target, item) {
      return new Promise((resolve) => {
        try {
          ClientLib.Net.CommunicationManager.GetInstance().SendCommand("SelfTrade", {
            targetCityId: target.get_Id(),
            sourceCityId: item.source.get_Id(),
            resourceType: item.type,
            amount: item.amount
          }, phe.cnc.Util.createEventDelegate(
            ClientLib.Net.CommandResult,
            this,
            (ctx, result) => resolve(Number(result) === 0)
          ), null, true);
        } catch (e) {
          console.warn("[ST] TransferAll: SelfTrade failed", e && e.message);
          resolve(false);
        }
      });
    }
  };

  // plugins/loot-summary.js
  var STATUS_INFOS2 = ["RegionNPCBaseStatusInfo", "RegionNPCCampStatusInfo"];
  var HISTORY_MAX = 30;
  var RETRY_MS = 500;
  var RETRY_MAX = 20;
  var COLORS2 = { high: "#8bc34a", low: "#ef5350", mid: "#ffffff", muted: "#bdbdbd" };
  var LOOT_TYPES = { 1: "tib", 2: "cry", 3: "cred", 6: "rp" };
  var COLUMNS = [
    { key: "rp", icon: "ui/common/icn_res_tiberium.png" },
    { key: "tib", icon: "ui/common/icn_res_chrystal.png" },
    { key: "cry", icon: "ui/common/icn_res_dollar.png" },
    { key: "cred", icon: "ui/common/icn_res_research_mission.png" },
    { key: "total", icon: "ui/common/icn_build_slots.png" }
  ];
  function getLoots(ul, r = {}) {
    for (const j in ul.d) {
      const u = ul.d[j];
      const p = u.get_HitpointsPercent();
      const cl = u.get_UnitLevelRepairRequirements();
      for (const i in cl) {
        const c = cl[i];
        if (typeof c !== "object") continue;
        const k = LOOT_TYPES[c.Type] === void 0 ? c.Type : LOOT_TYPES[c.Type];
        if (r[k] === void 0) r[k] = 0;
        r[k] += p * c.Count;
      }
    }
    return r;
  }
  function calcLoot(buildings, defences) {
    const loot = { rp: 0, tib: 0, cry: 0, cred: 0 };
    if (buildings) getLoots(buildings, loot);
    if (defences) getLoots(defences, loot);
    loot.total = loot.rp + loot.tib + loot.cry + loot.cred;
    return loot;
  }
  function lootRows(cp) {
    const rows = [["lootLootable", 1, true]];
    if (cp > 0) {
      rows.push(["lootPerCpRow", cp, cp <= 1], ["loot2nd", 2 * cp, false], ["loot3rd", 3 * cp, false]);
    }
    return rows;
  }
  function possibleAttacks(available, cp) {
    return cp > 0 && Number.isFinite(available) ? Math.floor(available / cp) : null;
  }
  function defenceUnits(city) {
    const ud = city.get_CityUnitsData();
    if (!ud) return null;
    try {
      if (typeof ud.get_DefenseUnits === "function") {
        const d = ud.get_DefenseUnits();
        if (d && d.d) return d;
      }
    } catch {
    }
    return ud.$DefenseUnits && ud.$DefenseUnits.d ? ud.$DefenseUnits : null;
  }
  function isBuildingList(o) {
    if (o === null || typeof o !== "object") return false;
    if (typeof o.c === "undefined" || o.c === 0 || typeof o.d === "undefined") return false;
    const ks = Object.keys(o.d);
    if (ks.length !== o.c) return false;
    const u = o.d[ks[0]];
    return typeof u === "object" && u !== null && typeof u.get_UnitLevelRepairRequirements === "function" && typeof u.GetUnitGroupType === "undefined";
  }
  function buildingList(city) {
    try {
      if (typeof city.get_Buildings === "function") {
        const b = city.get_Buildings();
        if (isBuildingList(b)) return b;
      }
    } catch {
    }
    let bd = null;
    try {
      bd = city.get_CityBuildingsData();
    } catch {
    }
    for (const src of [city, bd]) {
      if (!src) continue;
      for (const k in src) {
        let o;
        try {
          o = src[k];
        } catch {
          continue;
        }
        if (isBuildingList(o)) return o;
      }
    }
    return null;
  }
  function rankColor(value, history) {
    if (value === null || history.length < 3) return "mid";
    const below = history.filter((v) => v < value).length;
    const share = below / (history.length - 1 || 1);
    if (share >= 2 / 3) return "high";
    if (share <= 1 / 3) return "low";
    return "mid";
  }
  function compact(v) {
    try {
      return webfrontend.phe.cnc.gui.util.Numbers.formatNumbersCompact(v);
    } catch {
    }
    try {
      return webfrontend.gui.Util.formatNumbersCompact(v);
    } catch {
    }
    return fmtNumber(v);
  }
  var LootSummary = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descLootSummary");
    }
    constructor(config) {
      this.name = "LootSummary";
      this.config = config;
      this.running = false;
      this._listeners = [];
      this._citiesHooked = false;
      this._grid = null;
      this._icons = null;
      this._timer = null;
      this._shown = null;
      this._history = { total: [], ratio: [] };
      this._seen = /* @__PURE__ */ new Set();
      this._warned = false;
      this._mtNoted = false;
    }
    async start() {
      this.running = true;
      this._hookPanels();
      try {
        webfrontend.phe.cnc.Util.attachNetEvent(
          ClientLib.Data.MainData.GetInstance().get_Cities(),
          "Change",
          ClientLib.Data.CitiesChange,
          this,
          this._onCitiesChange
        );
        this._citiesHooked = true;
      } catch (e) {
        this._warn("could not listen to city changes", e);
      }
      console.log("[ST] LootSummary: started");
    }
    stop() {
      this.running = false;
      if (this._citiesHooked) {
        try {
          webfrontend.phe.cnc.Util.detachNetEvent(
            ClientLib.Data.MainData.GetInstance().get_Cities(),
            "Change",
            ClientLib.Data.CitiesChange,
            this,
            this._onCitiesChange
          );
        } catch {
        }
        this._citiesHooked = false;
      }
      for (const { widget, id } of this._listeners) {
        try {
          widget.removeListenerById(id);
        } catch {
        }
      }
      this._listeners = [];
      if (this._grid) {
        try {
          const parent = this._grid.getLayoutParent();
          if (parent) parent.remove(this._grid);
          this._grid.dispose();
        } catch {
        }
        this._grid = null;
      }
      this._shown = null;
      this._clearTimer();
    }
    _clearTimer() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }
    /** One-line status for `/st status`. */
    statusText() {
      return t("lootStatus", { n: this._seen.size });
    }
    _warn(msg, e) {
      if (this._warned) return;
      this._warned = true;
      console.warn(`[ST] LootSummary: ${msg}`, e && e.message ? e.message : "");
    }
    // ─── Info panel ──────────────────────────────────────────────────
    _hookPanels() {
      let region;
      try {
        region = webfrontend.gui.region;
      } catch (e) {
        this._warn("region info widgets not available \u2014 panel disabled", e);
        return;
      }
      for (const name of STATUS_INFOS2) {
        try {
          const cls = region && region[name];
          if (!cls || typeof cls.getInstance !== "function") continue;
          const widget = cls.getInstance();
          const appear = widget.addListener("appear", () => this._onAppear(widget), this);
          const disappear = widget.addListener("disappear", () => this._onDisappear(widget), this);
          this._listeners.push({ widget, id: appear }, { widget, id: disappear });
        } catch (e) {
          this._warn(`could not hook ${name}`, e);
        }
      }
    }
    /** MaelstromTools' loot widget: Composite with Grid(5, 5), white text. */
    _ensureGrid() {
      if (this._grid) return this._grid;
      try {
        this._grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(5, 5)).set({ marginTop: 6 });
        this._grid.setTextColor("white");
      } catch (e) {
        this._warn("could not build the panel", e);
      }
      return this._grid;
    }
    /** MaelstromTools Util.addLabel. */
    _label(grid, row, column, value, { width, align, bold, color, colSpan } = {}) {
      const label = new qx.ui.basic.Label().set({ value: String(value) });
      if (width) label.setWidth(width);
      if (align) label.setTextAlign(align);
      if (color) label.setTextColor(color);
      if (bold) label.setFont("bold");
      grid.add(label, { row, column, colSpan: colSpan || 1 });
      return label;
    }
    /** MaelstromTools Util.getImage + addImage: 20x20, scaled. */
    _image(grid, row, column, key) {
      if (!this._icons) {
        this._icons = {};
        try {
          const fm = ClientLib.File.FileManager.GetInstance();
          for (const c of COLUMNS) this._icons[c.key] = fm.GetPhysicalPath(c.icon);
        } catch {
        }
      }
      if (!this._icons[key]) return;
      const image = new qx.ui.basic.Image(this._icons[key]);
      image.setScale(true);
      image.setWidth(20);
      image.setHeight(20);
      grid.add(image, { row, column });
    }
    /** The selected vis object's position, or null. */
    _selected() {
      try {
        const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
        if (sel && typeof sel.get_RawX === "function") return { x: sel.get_RawX(), y: sel.get_RawY() };
      } catch {
      }
      return null;
    }
    /**
     * MaelstromTools with "Show lootable resources" wraps onCitiesChange of
     * these widgets (__MTCity_NPCCamp / __MTCity_NPCBase) and draws the same
     * table in the same panel - ours would show it twice, so we step aside.
     */
    _maelstromLoot() {
      try {
        const region = webfrontend.gui.region;
        return !!(region.RegionNPCBaseStatusInfo.prototype.__MTCity_NPCBase || region.RegionNPCCampStatusInfo.prototype.__MTCity_NPCCamp);
      } catch {
        return false;
      }
    }
    _onAppear(widget) {
      if (!this.running) return;
      if (this._maelstromLoot()) {
        if (!this._mtNoted) {
          this._mtNoted = true;
          console.log('[ST] LootSummary: MaelstromTools loot table active \u2014 Shockr panel skipped (turn off "Show lootable resources" in MaelstromTools to use this one)');
        }
        if (this._grid && this._grid.getLayoutParent()) this._grid.getLayoutParent().remove(this._grid);
        this._shown = null;
        this._clearTimer();
        return;
      }
      const sel = this._selected();
      this._shown = sel ? { widget, sel, tries: 0 } : null;
      if (sel) this._render();
    }
    _onDisappear(widget) {
      if (this._shown && this._shown.widget === widget) {
        this._shown = null;
        this._clearTimer();
      }
    }
    /** MHTools recomputes on every city change; the target's data arrives that way. */
    _onCitiesChange() {
      if (this.running && this._shown) this._render();
    }
    _render() {
      this._clearTimer();
      const shown = this._shown;
      const { widget, sel } = shown;
      try {
        const grid = this._ensureGrid();
        if (!grid) return;
        grid.removeAll();
        const own = this._ownCity();
        if (own && !this._inRange(own, sel)) {
          this._label(grid, 1, 1, t("lootOutOfRange"), { bold: true, colSpan: 11 });
        } else {
          const target = this._target(sel);
          if (target) {
            this._fill(grid, sel, target, own);
          } else {
            this._label(grid, 1, 1, t("lootCalculating"), { bold: true, colSpan: 11 });
            if (shown.tries++ < RETRY_MAX) {
              this._timer = setTimeout(() => {
                this._timer = null;
                if (this.running && this._shown === shown) this._render();
              }, RETRY_MS);
            }
          }
        }
        widget.add(grid);
      } catch (e) {
        this._warn("panel update failed", e);
      }
    }
    _ownCity() {
      try {
        return ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity() || null;
      } catch {
        return null;
      }
    }
    /** MaelstromTools: distance from the current own base <= get_MaxAttackDistance(). */
    _inRange(own, sel) {
      try {
        const dist = Math.hypot(own.get_PosX() - sel.x, own.get_PosY() - sel.y);
        return dist <= Number(ClientLib.Data.MainData.GetInstance().get_Server().get_MaxAttackDistance());
      } catch {
        return true;
      }
    }
    /** Loot of the selected target, or null while it is not loaded. */
    _target(sel) {
      const ec = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentCity();
      if (!ec) return null;
      try {
        if (ec.get_PosX() !== sel.x || ec.get_PosY() !== sel.y) return null;
      } catch {
      }
      if (!ec.get_CityBuildingsData() || !ec.get_CityUnitsData()) return null;
      const buildings = buildingList(ec);
      const defences = defenceUnits(ec);
      if (!buildings && !defences) return null;
      const loot = calcLoot(buildings, defences);
      return loot.total > 0 ? loot : null;
    }
    _fill(grid, sel, loot, own) {
      let cp = null;
      try {
        cp = Number(own.CalculateAttackCommandPointCostToCoord(sel.x, sel.y));
        if (!Number.isFinite(cp)) cp = null;
      } catch {
        cp = null;
      }
      const ratio = cp > 0 ? loot.total / cp : null;
      const key = `${sel.x}:${sel.y}`;
      if (!this._seen.has(key)) {
        this._seen.add(key);
        this._history.total.push(loot.total);
        if (ratio !== null) this._history.ratio.push(ratio);
        for (const k of ["total", "ratio"]) {
          if (this._history[k].length > HISTORY_MAX) this._history[k].shift();
        }
      }
      let row = 1;
      let available = NaN;
      try {
        available = Number(ClientLib.Data.MainData.GetInstance().get_Player().GetCommandPointCount());
      } catch {
      }
      const attacks = possibleAttacks(available, cp);
      if (attacks !== null) {
        this._label(grid, ++row, 1, `${t("lootPossibleAttacks")}: ${attacks}`, { align: "left", bold: true, colSpan: 9 });
      }
      for (const [labelKey, div, bold] of lootRows(cp)) {
        row++;
        let col = 1;
        this._label(grid, row, col++, `${t(labelKey)}:`, { bold });
        for (const c of COLUMNS) {
          this._image(grid, row, col++, c.key);
          let color;
          if (c.key === "total" && div === 1) color = COLORS2[rankColor(loot.total, this._history.total)];
          if (c.key === "total" && div === cp) color = COLORS2[rankColor(ratio, this._history.ratio)];
          this._label(grid, row, col++, compact(loot[c.key] / div), { width: 50, align: "right", bold, color });
        }
      }
      if (cp !== null) {
        let base = "";
        try {
          base = own.get_Name();
        } catch {
        }
        this._label(grid, ++row, 1, t("lootCpFrom", { cp, base }), { color: COLORS2.muted, colSpan: 11 });
      }
    }
  };

  // plugins/chat-helper.js
  var STORAGE_KEY2 = "chatHelper";
  var LEGACY_KEY = "myContacts";
  var SAVE_VERSION = "3.2.0";
  var KEYUP_DELAY_MS = 50;
  var WHISPER = "/whisper ";
  var ST_PREFIX = "/st";
  var VALID_CHAR = /[-\w.]/;
  var LINE_TYPES = /* @__PURE__ */ new Set(["text", "search", ""]);
  var DIAG_AFTER = 5;
  function autoTag(text) {
    let s = String(text);
    s = s.replace(/(\[coords\])*([0-9]{3,4})[:|.]([0-9]{3,4})([:|.]\w+)?(\[\/coords\])*/gi, (...a) => {
      const whole = a[7];
      if (whole.startsWith("http://cnc-map") || whole.startsWith("[url]")) return a[0];
      return "[coords]" + a[2] + ":" + a[3] + (a[4] !== void 0 ? a[4].replace(".", ":") : "") + "[/coords]";
    });
    s = s.replace(/(\[url\])*(https?:\/\/)?([\da-z.-]+)(\.[a-z]{2,6})([/\w.\-=?&:+%#|~]*)*\/?(\[\/url\])*/gi, (...a) => {
      if (a[2] && a[3]) return "[url]" + a[2] + a[3] + a[4] + (a[5] === void 0 ? "" : a[5]) + "[/url]";
      return a[0];
    });
    s = s.replace(/\[p\]([a-z0-9_\-\s]+)\[\/p\]/gi, "[player]$1[/player]");
    s = s.replace(/\[a\]([a-z0-9_\-\s]+)\[\/a\]/gi, "[alliance]$1[/alliance]");
    return s;
  }
  function clearTags(text) {
    return String(text).replace(/\[\/?(coords|url|player|alliance|b|i|u|s)\]/gi, "");
  }
  function wordAt(text, pos) {
    if (!VALID_CHAR.test(text.charAt(pos - 1))) return null;
    let s = pos;
    let e = pos;
    while (s > 0 && VALID_CHAR.test(text.charAt(s - 1))) s--;
    while (e < text.length && VALID_CHAR.test(text.charAt(e))) e++;
    return [s, e];
  }
  function wrapTag(tag, text, selStart, selEnd) {
    const eTag = tag.replace("[", "[/");
    if (selStart !== selEnd) {
      const mid = text.slice(selStart, selEnd);
      return { value: text.slice(0, selStart) + tag + mid + eTag + text.slice(selEnd), caret: selStart + tag.length + eTag.length + mid.length };
    }
    const pos = selStart;
    if ((text === "" || text.charAt(pos - 1) === " ") && text.charAt(pos) !== "[") {
      return { value: text.slice(0, pos) + tag + eTag + text.slice(pos), caret: pos + tag.length };
    }
    const w = wordAt(text, pos);
    if (w) {
      const [s, e] = w;
      return { value: text.slice(0, s) + tag + text.slice(s, e) + eTag + text.slice(e), caret: e + tag.length + eTag.length };
    }
    return null;
  }
  function completeWhisper(text, contacts) {
    if (!text.startsWith(WHISPER) || text.length < WHISPER.length + 1) return null;
    const typed = text.slice(WHISPER.length);
    if (/\s/.test(typed)) return null;
    let hit = null;
    for (const c of contacts) if (c.startsWith(typed)) hit = c;
    if (!hit) return null;
    return { value: WHISPER + hit + " ", selStart: WHISPER.length + typed.length, selEnd: WHISPER.length + hit.length };
  }
  function parseCommand(text) {
    const s = String(text);
    if (/^\/chelp\s*$/.test(s)) return { cmd: "help" };
    if (/^\/(list|contacts)\s*$/.test(s)) return { cmd: "list" };
    let m = s.match(/^\/(add|del) +(\S+)\s*$/);
    if (m) return { cmd: m[1], name: m[2] };
    m = s.match(/^\/whisper (\w+)\s/);
    if (m) return { cmd: "whisper", name: m[1] };
    return null;
  }
  function loadContacts() {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.removeItem(LEGACY_KEY);
        const list = legacy.split(",").filter(Boolean);
        saveContacts(list);
        return list;
      }
      const raw = localStorage.getItem(STORAGE_KEY2);
      const obj = raw ? JSON.parse(raw) : null;
      return obj && Array.isArray(obj.contacts) ? obj.contacts.filter((c) => typeof c === "string" && c) : [];
    } catch {
      return [];
    }
  }
  function saveContacts(contacts) {
    try {
      localStorage.setItem(STORAGE_KEY2, JSON.stringify({ saveObjVer: SAVE_VERSION, contacts }));
    } catch {
    }
  }
  function sortContacts(contacts) {
    return [...contacts].sort((a, b) => {
      a = a.toLowerCase();
      b = b.toLowerCase();
      return a > b ? 1 : a < b ? -1 : 0;
    });
  }
  function isLineInput(el) {
    return !!el && String(el.tagName).toUpperCase() === "INPUT" && LINE_TYPES.has(String(el.type || "text").toLowerCase());
  }
  function isTextInput(el) {
    return isLineInput(el) || !!el && (el.type === "textarea" || String(el.tagName).toUpperCase() === "TEXTAREA");
  }
  function eventTarget(e) {
    try {
      const path = typeof e.composedPath === "function" ? e.composedPath() : null;
      if (path && path.length && path[0] && path[0].tagName) return path[0];
    } catch {
    }
    return e.target;
  }
  function isSpace(e) {
    return e.keyCode === 32 || e.key === " ";
  }
  function isEnter(e) {
    return e.keyCode === 13 || e.key === "Enter";
  }
  function widgetDom(w, which) {
    try {
      const h = typeof w[which] === "function" ? w[which]() : null;
      return h && typeof h.getDomElement === "function" ? h.getDomElement() : null;
    } catch {
      return null;
    }
  }
  function textBoxIn(el) {
    if (!el) return null;
    if (isTextInput(el)) return el;
    try {
      const all = el.querySelectorAll ? el.querySelectorAll("input, textarea") : [];
      for (const c of all) if (isLineInput(c)) return c;
      for (const c of all) if (isTextInput(c)) return c;
    } catch {
    }
    return null;
  }
  function chatWidget() {
    try {
      return qx.core.Init.getApplication().getChat().getChatWidget() || null;
    } catch {
      return null;
    }
  }
  function findChatInput() {
    const chat = chatWidget();
    if (!chat) return null;
    let widget = null;
    try {
      widget = typeof chat.getEditable === "function" ? chat.getEditable() : null;
    } catch {
      widget = null;
    }
    if (widget) {
      const el2 = textBoxIn(widgetDom(widget, "getContentElement")) || textBoxIn(widgetDom(widget, "getContainerElement"));
      if (el2) return { widget, el: el2 };
    }
    const el = textBoxIn(widgetDom(chat, "getContentElement")) || textBoxIn(widgetDom(chat, "getContainerElement"));
    return el ? { widget: null, el } : null;
  }
  function inChatWidget(el) {
    const chat = chatWidget();
    if (!chat || !el) return false;
    for (const root of [widgetDom(chat, "getContainerElement"), widgetDom(chat, "getContentElement")]) {
      try {
        if (root && root !== el && root.contains(el)) return true;
      } catch {
      }
    }
    return false;
  }
  function describeChatRoute() {
    const tag = (el) => el ? `<${String(el.tagName).toLowerCase()}${el.type ? " type=" + el.type : ""}>` : "null";
    const out = [];
    let app = null;
    try {
      app = qx.core.Init.getApplication();
    } catch (e) {
      return `qx app: ${e && e.message}`;
    }
    let chat = null;
    try {
      chat = app.getChat();
      out.push(`getChat: ${chat ? "ok" : "null"}`);
    } catch (e) {
      out.push(`getChat: ${e && e.message}`);
    }
    try {
      chat = chat && chat.getChatWidget();
      out.push(`getChatWidget: ${chat ? chat.classname || "ok" : "null"}`);
    } catch (e) {
      out.push(`getChatWidget: ${e && e.message}`);
      chat = null;
    }
    if (!chat) return out.join(" \xB7 ");
    let ed = null;
    try {
      ed = typeof chat.getEditable === "function" ? chat.getEditable() : void 0;
      out.push(`getEditable: ${ed === void 0 ? "no such method" : ed ? ed.classname || "ok" : "null"}`);
    } catch (e) {
      out.push(`getEditable: ${e && e.message}`);
    }
    if (ed) out.push(`editable content ${tag(widgetDom(ed, "getContentElement"))}, container ${tag(widgetDom(ed, "getContainerElement"))}`);
    out.push(`chat widget content ${tag(widgetDom(chat, "getContentElement"))}, container ${tag(widgetDom(chat, "getContainerElement"))}`);
    return out.join(" \xB7 ");
  }
  function setFieldValue(el, value, widget) {
    let w = widget || null;
    if (!w) {
      try {
        w = qx.ui.core.Widget.getWidgetByElement(el);
      } catch {
        w = null;
      }
    }
    if (w && typeof w.setValue === "function") {
      try {
        const own = w.getContentElement && w.getContentElement().getDomElement();
        if (own === el) {
          w.setValue(value);
          if (el.value !== value) el.value = value;
          return;
        }
      } catch {
      }
    }
    el.value = value;
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
    }
  }
  var ChatHelper = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descChatHelper");
    }
    constructor(config) {
      this.name = "ChatHelper";
      this.config = config;
      this.running = false;
      this.contacts = [];
      this._declined = /* @__PURE__ */ new Set();
      this._timer = null;
      this._chat = null;
      this._hookTimer = null;
      this._warned = false;
      this._misses = 0;
      this._loggedTarget = false;
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onEnterCapture = this._onEnterCapture.bind(this);
      this._onWinKeyUp = (e) => {
        const el = eventTarget(e);
        if (this._isChat(el)) return;
        this._logUnhookedTarget(el);
        this._onKeyUp(e);
      };
      this._onWinKeyDown = (e) => {
        if (this._isChat(eventTarget(e))) return;
        this._onEnterCapture(e);
        this._onKeyDown(e);
      };
      this._onFocusIn = (e) => {
        const el = eventTarget(e);
        if (this._isChat(el) || !isLineInput(el) || !inChatWidget(el)) return;
        let widget = null;
        try {
          widget = qx.ui.core.Widget.getWidgetByElement(el);
        } catch {
          widget = null;
        }
        this._attach({ widget, el }, "focus");
      };
    }
    async start() {
      this.contacts = loadContacts();
      this.running = true;
      window.addEventListener("keyup", this._onWinKeyUp, true);
      window.addEventListener("keydown", this._onWinKeyDown, true);
      window.addEventListener("focusin", this._onFocusIn, true);
      this._hookChat();
      this._hookTimer = setInterval(() => this._hookChat(), 2e3);
    }
    stop() {
      window.removeEventListener("keyup", this._onWinKeyUp, true);
      window.removeEventListener("keydown", this._onWinKeyDown, true);
      window.removeEventListener("focusin", this._onFocusIn, true);
      this._unhookChat();
      clearInterval(this._hookTimer);
      this._hookTimer = null;
      clearTimeout(this._timer);
      this._timer = null;
      this.running = false;
    }
    statusText() {
      const hook = t(this._chat ? "chatHelperHooked" : "chatHelperNotHooked");
      return `${t("chatHelperStatus", { n: this.contacts.length })} \xB7 ${hook}`;
    }
    _isChat(el) {
      return !!this._chat && el === this._chat.el;
    }
    _hookChat() {
      if (!this.running) return;
      const found = findChatInput();
      if (found && this._chat && found.el === this._chat.el) return;
      if (!found) {
        if (this._chat && this._chat.el.isConnected !== false) return;
        this._unhookChat();
        this._misses++;
        if (!this._warned) {
          this._warned = true;
          console.warn("[ST] ChatHelper: chat input not found yet \u2014 retrying every 2 s");
        }
        if (this._misses === DIAG_AFTER) console.warn(`[ST] ChatHelper: chat route - ${describeChatRoute()}`);
        return;
      }
      this._attach(found, "qx");
    }
    _attach(found, how) {
      this._unhookChat();
      const { el } = found;
      el.addEventListener("keyup", this._onKeyUp);
      el.addEventListener("keydown", this._onEnterCapture);
      el.addEventListener("keydown", this._onKeyDown);
      try {
        el.setAttribute("data-st-chathelper", "chat");
      } catch {
      }
      this._chat = found;
      this._misses = 0;
      console.log(`[ST] ChatHelper: chat input hooked via ${how} (<${String(el.tagName).toLowerCase()} type=${el.type}>)`);
    }
    /** Once, while the chat is not hooked: what the first key was typed in (diagnostics). */
    _logUnhookedTarget(el) {
      if (this._chat || this._loggedTarget || !el) return;
      this._loggedTarget = true;
      const cls = el.className ? ` class="${String(el.className).slice(0, 60)}"` : "";
      console.warn(`[ST] ChatHelper: key in <${String(el.tagName).toLowerCase()}${el.type ? " type=" + el.type : ""}${cls}> while the chat is not hooked (in chat widget: ${inChatWidget(el)}) - ${describeChatRoute()}`);
    }
    _unhookChat() {
      if (!this._chat) return;
      const { el } = this._chat;
      el.removeEventListener("keyup", this._onKeyUp);
      el.removeEventListener("keydown", this._onEnterCapture);
      el.removeEventListener("keydown", this._onKeyDown);
      try {
        el.removeAttribute("data-st-chathelper");
      } catch {
      }
      this._chat = null;
    }
    _set(el, value) {
      setFieldValue(el, value, this._isChat(el) ? this._chat.widget : null);
    }
    // ── keyboard ──
    _onKeyUp(e) {
      const el = eventTarget(e);
      if (!isTextInput(el) || el.value === "" || el.value.startsWith(ST_PREFIX)) return;
      if (isSpace(e)) {
        if (this._runCommand(el, el.value)) return;
        this._applyAutoTag(el);
      }
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._whisperComplete(e, el), KEYUP_DELAY_MS);
    }
    /** Enter on a chat line with a chat-helper command: handle it, never send it. */
    _onEnterCapture(e) {
      if (!isEnter(e)) return;
      const el = eventTarget(e);
      if (!isLineInput(el) || !el.value || el.value.startsWith(ST_PREFIX)) return;
      const c = parseCommand(el.value);
      if (!c || c.cmd === "whisper") return;
      if (this._runCommand(el, el.value)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    _onKeyDown(e) {
      const el = eventTarget(e);
      if (!isTextInput(el)) return;
      if (isEnter(e)) {
        if (el.type === "textarea" && el.value !== "") this._applyAutoTag(el);
        return;
      }
      if (!e.altKey || e.shiftKey || e.ctrlKey || e.altGraphKey) return;
      const kc = e.keyCode;
      const suppress = this.config.get("ChatHelper.suppressAltKeys", true);
      const wrap = (tag) => {
        this._wrap(el, tag);
        if (suppress) e.preventDefault();
      };
      if (kc === 49 && el.type === "textarea") {
        const st = el.scrollTop;
        this._set(el, autoTag(el.value));
        el.scrollTop = st;
        this._caret(el, 0);
      } else if (kc === 50) {
        const url = prompt(t("chatHelperUrlPrompt"), "");
        if (url !== null) this._set(el, el.value + "[url]" + url + "[/url]");
      } else if (kc === 80 || kc === 51) {
        wrap("[player]");
      } else if (kc === 65 || kc === 52) {
        wrap("[alliance]");
      } else if (kc === 48) {
        const st = el.scrollTop;
        this._set(el, clearTags(el.value));
        el.scrollTop = st;
      } else if (kc === 66) {
        wrap("[b]");
      } else if (kc === 73) {
        wrap("[i]");
      } else if (kc === 85) {
        wrap("[u]");
      } else if (kc === 83) {
        wrap("[s]");
      }
    }
    _applyAutoTag(el) {
      const tagged = autoTag(el.value);
      if (tagged !== el.value) this._set(el, tagged);
    }
    _wrap(el, tag) {
      const st = el.scrollTop;
      const r = wrapTag(tag, el.value, el.selectionStart, el.selectionEnd);
      if (!r) return;
      this._set(el, r.value);
      this._caret(el, r.caret);
      if (el.type === "textarea") el.scrollTop = st;
    }
    _caret(el, pos) {
      try {
        el.setSelectionRange(pos, pos);
        el.focus();
      } catch {
      }
    }
    _whisperComplete(e, el) {
      if (!isLineInput(el) || !el.value) return;
      if (e.altGraphKey || e.ctrlKey || e.altKey || !(e.keyCode > 47 && e.keyCode < 91)) return;
      const r = completeWhisper(el.value, this.contacts);
      if (!r) return;
      this._set(el, r.value);
      try {
        el.setSelectionRange(r.selStart, r.selEnd, "forward");
      } catch {
      }
    }
    // ── commands ──
    /** Runs a chat-helper command; true if the line was one (and is consumed). */
    _runCommand(el, text) {
      const c = parseCommand(text);
      if (!c) return false;
      if (c.cmd === "whisper") {
        if (!this.contacts.includes(c.name) && !this._declined.has(c.name)) {
          const name = c.name;
          this._declined.add(name);
          setTimeout(() => {
            if (confirm(t("chatHelperAddConfirm", { name }))) this._add(name);
          }, 500);
        }
        return false;
      }
      this._set(el, "");
      if (c.cmd === "help") this._showHelp();
      else if (c.cmd === "list") this._list();
      else if (c.cmd === "add") {
        if (this.contacts.includes(c.name)) chatMessage(`[ST] ${escapeHtml(t("chatHelperAlready", { name: c.name }))}`);
        else if (confirm(t("chatHelperAddConfirm", { name: c.name }))) this._add(c.name);
      } else if (c.cmd === "del") {
        if (c.name !== "all" && !this.contacts.includes(c.name)) {
          chatMessage(`[ST] ${escapeHtml(t("chatHelperNotInList", { name: c.name }))}`);
        } else if (confirm(t(c.name === "all" ? "chatHelperDelAllConfirm" : "chatHelperDelConfirm", { name: c.name }))) {
          this.contacts = c.name === "all" ? [] : this.contacts.filter((x) => x !== c.name);
          saveContacts(this.contacts);
          chatMessage(`[ST] ${escapeHtml(t(c.name === "all" ? "chatHelperDeletedAll" : "chatHelperDeleted", { name: c.name }))}`);
        }
      }
      setTimeout(() => {
        try {
          el.focus();
        } catch {
        }
      }, 5);
      return true;
    }
    _add(name) {
      if (this.contacts.includes(name)) return;
      this.contacts.push(name);
      saveContacts(this.contacts);
      chatMessage(`[ST] ${escapeHtml(t("chatHelperAdded", { name }))}`);
    }
    _list() {
      if (this.contacts.length === 0) {
        const p = prompt(t("chatHelperEmptyPrompt"), "");
        if (p && p.trim()) this._add(p.trim());
        return;
      }
      const sorted = sortContacts(this.contacts);
      chatMessage(`[ST] ${escapeHtml(t("chatHelperListHeader", { n: sorted.length }))}`);
      chatMessage(`[ST] ${escapeHtml(sorted.join(", "))}`);
    }
    _showHelp() {
      for (const key of ["chatHelperHelp1", "chatHelperHelp2", "chatHelperHelp3", "chatHelperHelp4", "chatHelperHelp5", "chatHelperHelp6"]) {
        chatMessage(`[ST] ${escapeHtml(t(key))}`);
      }
    }
  };

  // plugins/pvp-alert-assets.js
  var ALERT_FAVICON = "data:image/gif;base64,R0lGODlhEAAQAPf/AFFJSaM3NFAvLkVFRW1mZ0I6O5k8PGI2OlMzNFY5OkpKSjQvL005OlJSUldXV25TVD09PU5GRkozNGw2Ons3Nj4uLl5eXkg6O2VGRmlfYVRJSmNaWltQUWFXWGZmZltbWzU1NUBAQCYmJjMzMywsLC4uLi8vLy0tLTExMSsrKx0dHTIyMjAwMIRHR4ZLTKlFRdFDQ2pOT9JHSllSUmdKSlVOTqpIS6hCQIJEQ/9GS9FBPv9DQ01NTbFcaHVbXXJXWdJKUYg4NmJDQnxlaI1XW5JfZq1QVo5bYY9aYNRUZGhhYtNRXtNPV21tbYhPUXA6Oac/PKtXYq9XYatMUNVZbYFBP85VZls7OnhfYnlgY65TXGNdXUo8PItTVtA9OV5XWHJsbP9APK1HUGQ9Pr1ETHRaXVFIR1lPUFg3Ol8+PUUzNHc8O79QYP9RY29UV/9KU6FSXf89Nm09Q4JRVpZCRG9papJETzYwMF9GRzguLmA/Q2RFRHBITXxMT2pMTv9ZdEMwLzs7O4VPU01CQYM9PnRaXE5CQ39ERKNNUqVLWI1GTG1DR3o+PKRERIBCQZ9CQoJGRqRETcNBQctDQ8xJT3BVVppOV/VUbP9UalVBQ/9OW6dKT482Nb42MmdBRLM5NntPVbs7N0JCQl1VVUtAQE1CRNRYaV1SU7RAQ2NMTmdMTWhoaLBZZYBKTMpAPVA4O2pPUW1QUmAzMsVKU81NVY9MVnQ7PWA/P2c5OHpiZVlCRV1AQYlWW4hWXKNBP2ZHR2wyMqhOVDk0NDwwMD8zND41NbZLWG4/P1Y+P3tERX5BRmdISFVMTIhRVWxTVsZQXpFdZKVSXHU/Q3o8Q5E/R4BGTnR0dEowL201N5Q6OGNjY4ZNUE1AQJNJT4Q5PYU+Q51HS3hJTaVDUr5JW3o1OYk6RFgvMNVKXOA6NPVIUfVMWOpKVupAQNU/Q7E6PUMtLepPY8lGU5c4PaU+SOBETPVCQvU/O9U4M+BPZVRUVHoxMFBQUP9XcJc8RHFxcf///yH/C05FVFNDQVBFMi4wAwEAAAAh/wtYTVAgRGF0YVhNUDw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NDE1Q0JCRjUwOTExMTFFNDgxNDE4ODcwNUYwQjFDNTciIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NDE1Q0JCRjYwOTExMTFFNDgxNDE4ODcwNUYwQjFDNTciPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo0MTVDQkJGMzA5MTExMUU0ODE0MTg4NzA1RjBCMUM1NyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo0MTVDQkJGNDA5MTExMUU0ODE0MTg4NzA1RjBCMUM1NyIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PgH//v38+/r5+Pf29fTz8vHw7+7t7Ovq6ejn5uXk4+Lh4N/e3dzb2tnY19bV1NPS0dDPzs3My8rJyMfGxcTDwsHAv769vLu6ubi3trW0s7KxsK+urayrqqmop6alpKOioaCfnp2cm5qZmJeWlZSTkpGQj46NjIuKiYiHhoWEg4KBgH9+fXx7enl4d3Z1dHNycXBvbm1sa2ppaGdmZWRjYmFgX15dXFtaWVhXVlVUU1JRUE9OTUxLSklIR0ZFRENCQUA/Pj08Ozo5ODc2NTQz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";
  var NORMAL_FAVICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAArZJREFUOI19k8FrHHUUxz/vN7/57cx2u1VaSWw0KLTaQokUQU9CoPoHSPQUIhIoErx4yx4MPerNk15ysdBDaKmSEsSTJ/HgQVA8REFL0UgMTdhtdnZmdmbe62HX6sU++F4efL9833vfJ2aWbm1tXdvc3Hy7LMsTzjnlMaWqLo7j0crKyherq6vXZGdn56P19fVeCAEReRz3UZkZZVnS6/U+kcXFxXuDwWDeOYeIoDVU4wZtDLMJQQTECT52+FgwDDMjTdM9XxRFSxAMGD0YEzoVMxdiuqcjQuLAoCyVrN/Q3x9zfABpuwUCVVV5b2YKMDouuXgl4s0PznFmLiE94fnvQHnekPUrvr29z9efDkjTBEA9QF0Z6emGt3rn6D6VcnRQ8OtX9xke1gCEtuP8K6d45oWTvH51nu/v/MyDPcV7w5sZZVHx/OVA6AZGRcOtj+/yw5cZIZ24qMbKs5cPeOO9OVQNNcVMMZsKmBpxO6JSocxrDn4f0zmVECfu0RIPf2u4/v4fACSdmDjIvwKY0TTGuIZaBQRMJ/3J2QSspjMriAh1XqPqMDOcmQFGkTUUlaFRxOylNkU5IhvmZMOcweGQmZci3v38Aqs3LjL3cqAYVqjqxEEUOw7vlWRZQ0g8r119jhevnGHUr1CFOHHMnu8QTgaiWMj6DSLTEVQV8TD8S/nms7u8+s487W7g7MITSDQ9pEFVKlnW8OOdPfZ/KmglCWaGLCws7FdVNSMIeTam9aTRfbpF6ESI++cBoKmM4f0xx3/WJGkCzohc9LeP47gsyxLnHEknYCPj6JcGtGGa5EmgBFzkSNvJJMpq+OBrt7a2drMoClQVU4XI8C3Bp0I8hU8FnwguBjVFVcnznOXl5dvR9vb2d3meJ7u7u2dVtYyi6Ng5N/w/AKMQwtHS0tL1jY2NDx8CqX1qY1ia7UwAAAAASUVORK5CYII=";
  var SIREN_SOUND = "data:audio/ogg;base64,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";

  // plugins/pvp-alert.js
  var CHECK_INTERVAL_MS = 5e3;
  var PvpAlert = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descPvpAlert");
    }
    constructor(config) {
      this.name = "PvpAlert";
      this.config = config;
      this.running = false;
      this._timer = null;
      this._siren = null;
      this._alarmed = false;
      this._victim = null;
      this._savedTitle = null;
      this._savedIcons = null;
      this._iconLink = null;
      this._alerted = /* @__PURE__ */ new Set();
    }
    async start() {
      this.running = true;
      this._timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
      console.log("[ST] PvpAlert: started");
    }
    stop() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      if (this._alarmed) this._relax();
      this._alerted.clear();
      this.running = false;
      console.log("[ST] PvpAlert: stopped");
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (this._alarmed) return t("pvpAlertStatusAlarm", { base: this._victim });
      const sound = t(this._soundOn() ? "pvpAlertSoundOn" : "pvpAlertSoundOff");
      return t("pvpAlertStatusWatching", { sound });
    }
    /** One poll: the original checkAlert(). */
    check() {
      const inBackground = !document.hasFocus();
      const alerted = alertedBases();
      this._logNew(alerted);
      if (inBackground && alerted.length && !this._alarmed) {
        this._alarm(alerted[alerted.length - 1]);
      } else if (this._alarmed && !inBackground) {
        this._relax();
      }
    }
    _alarm(victim) {
      this._alarmed = true;
      this._victim = victim;
      this._savedTitle = document.title;
      document.title = t("pvpAlertTitle", { base: victim });
      this._setFavicon(ALERT_FAVICON, "image/gif");
      if (this._soundOn()) {
        try {
          if (!this._siren) this._siren = new Audio(SIREN_SOUND);
          const p = this._siren.play();
          if (p && typeof p.catch === "function") p.catch(() => {
          });
        } catch {
        }
      }
    }
    _relax() {
      if (this._savedTitle !== null) document.title = this._savedTitle;
      this._savedTitle = null;
      this._restoreFavicon();
      if (this._siren) {
        try {
          this._siren.pause();
          this._siren.currentTime = 0;
        } catch {
        }
      }
      this._alarmed = false;
      this._victim = null;
    }
    _soundOn() {
      return this.config.get("PvpAlert.sound", true) !== false;
    }
    /** `[ST] PvP Alert: ... attacks <base>` once per base when its alert flag goes up. */
    _logNew(alerted) {
      const now = new Set(alerted);
      for (const base of now) {
        if (!this._alerted.has(base)) console.log(`[ST] PvP Alert: (unknown) attacks ${base}`);
      }
      this._alerted = now;
    }
    _setFavicon(href, type) {
      const head = document.getElementsByTagName("head")[0];
      if (!head) return;
      if (!this._savedIcons) {
        this._savedIcons = [...document.querySelectorAll('link[rel~="icon"]')].filter((el) => el !== this._iconLink).map((el) => ({ el, href: el.getAttribute("href") }));
      }
      for (const { el } of this._savedIcons) el.removeAttribute("href");
      if (!this._iconLink) {
        this._iconLink = document.createElement("link");
        this._iconLink.rel = "shortcut icon";
      }
      if (type) this._iconLink.type = type;
      else this._iconLink.removeAttribute("type");
      this._iconLink.href = href;
      if (!this._iconLink.parentNode) head.appendChild(this._iconLink);
    }
    _restoreFavicon() {
      const saved = (this._savedIcons || []).filter((s) => s.href);
      if (saved.length) {
        for (const { el, href } of saved) el.setAttribute("href", href);
        if (this._iconLink && this._iconLink.parentNode) this._iconLink.parentNode.removeChild(this._iconLink);
      } else if (this._iconLink) {
        this._setFavicon(NORMAL_FAVICON, null);
      }
      this._savedIcons = null;
    }
  };
  function alertedBases() {
    const names2 = [];
    let all;
    try {
      all = ClientLib.Data.MainData.GetInstance().get_Cities().get_AllCities().d;
    } catch {
      return names2;
    }
    for (const key in all) {
      const city = all[key];
      try {
        if (city && city.get_isAlerted()) names2.push(city.get_Name());
      } catch {
      }
    }
    return names2;
  }

  // lib/main.js
  var ST_VERSION = "5.23.2";
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
      const names2 = failed.map((r) => r.name).join(", ");
      console.warn(`[ST] Patch failures: ${names2}`);
      chatMessage(`[ST] ${t("patchFailed", { names: names2 })}`);
    }
    const cli = new Cli(config);
    const idle = new IdleDetect();
    const online = new OnlineStateWatch();
    const api = new ApiClient(config);
    api.setSendGate(() => online.isPaused);
    online.on("resume", () => api.resumeQueue());
    online.start();
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
      new PoiAnalyser(config),
      new SectorHud(config),
      new MovableMenu(config),
      new TransferAll(config),
      new LootSummary(config),
      new ChatHelper(config),
      new PvpAlert(config)
    ];
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
        chatMessage(`[ST] ${t("pluginStartFailed", { name: plugin.name, error: err.message })}`);
      }
    }
    cli.register("plugin", (args) => {
      const [action, name] = args;
      const norm = (s) => (s || "").toLowerCase().replace(/[-_]/g, "");
      if (action === "list") {
        for (const p of plugins) {
          chatMessage(`[ST] ${kebab(p.name)}: ${t(p.running ? "pluginEnabled" : "pluginDisabled")}`);
        }
        return;
      }
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
      const pause = { paused: "scannerPausePaused", active: "scannerPauseActive", unknown: "scannerPauseUnknown", stopped: "scannerPauseStopped" };
      chatMessage(`[ST] ${t(pause[online.describe()])}`);
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
