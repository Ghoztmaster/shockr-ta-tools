// ==UserScript==
// @name            Shockr - Tiberium Alliances Tools
// @author          Ghozt [SoO] (original: Shockr, fixed by NetquiK [SoO])
// @license         GPL-3.0-or-later
// @description     Camp tracker, kill info, player status, alliance recon, upgrade calculator, target watcher, attack tracker, watchlist, base info, attack range, map labels, tunnel info, formation saver, wavy, loot summary, chat helper & PvP alert for C&C Tiberium Alliances
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @grant           GM_getValue
// @grant           GM_setValue
// @version         5.27.1
// @homepage        https://github.com/Ghoztmaster/shockr-ta-tools
// @updateURL       https://raw.githubusercontent.com/Ghoztmaster/shockr-ta-tools/main/dist/shockr-ta-tools.user.js
// @downloadURL     https://raw.githubusercontent.com/Ghoztmaster/shockr-ta-tools/main/dist/shockr-ta-tools.user.js
// ==/UserScript==

/*
A note on licensing and attribution

Shockr Alliance Tools started as a rebuild of community scripts for Tiberium
Alliances, many of which were abandoned years ago. We have put considerable
effort into tracing the origin of every piece of code, identifying the
original authors and their licenses, and either rewriting code where the
license did not allow reuse or crediting it properly where it did. The full
inventory is in docs/LICENTIES_DERDEN.md.

We may still have missed something. If you are the author of code or assets
used here and believe we have not credited you correctly, or if you object to
the way your work is used, please open an issue or contact Ghozt on the TA
forum. We will work with you to resolve it properly — whether that means
adding attribution, changing the license note, or replacing the code.

------------------------------------------------------------------------------

Shockr TA Tools
Copyright (C) 2026 Ghozt [SoO]
Licensed under the GNU General Public License v3 or later (see LICENSE).

This project is a rebuild of Shockr Tools by Blayne Chard
(https://github.com/blacha/st, archived 2020). Parts of the following files
are derived from that MIT-licensed code (ported from TypeScript to JavaScript
and modified); those parts remain available under the MIT license below:

  lib/packer.js                <- packages/clientlib-util/src/util/base.n.ts, base.62.ts, pack/*.packer.ts
  lib/clientlib-patch.js       <- packages/clientlib-util/src/patch/patch.data.ts, client.patcher.ts
  lib/city-util.js             <- packages/clientlib-util/src/util/city.ts
  lib/scanner-util.js          <- packages/clientlib-util/src/util/city.scan.ts
  lib/cli.js                   <- packages/st-extension/src/st.cli.ts
  plugins/camp-tracker.js      <- packages/st-extension/src/plugins/camp.tracker/camp.tracker.ts
  plugins/player-status.js     <- packages/st-extension/src/plugins/player.status/player.status.ts
  plugins/alliance-scanner.js  <- packages/st-extension/src/plugins/alliance.scanner/alliance.scanner.ts
  plugins/layout-scanner.js    <- packages/st-extension/src/plugins/layout/layout.ts

------------------------------------------------------------------------------

MIT License

Copyright (c) 2020 Blayne Chard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function () {
function __stBundle() {
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
  var SYNC_SUFFIX = "-gm-sync";
  var gmConfig = null;
  var CONFIG_LOST_MESSAGE = '[ST] Config niet gevonden in localStorage en GM-storage. Als je het script via "Importeren" hebt bijgewerkt, is je config gewist. Gebruik /st config import met je export-code, of /st register.';
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("st-gm-config", (e) => {
      try {
        const parsed = JSON.parse(e.detail);
        const cfg = parsed && parsed.config;
        gmConfig = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
      } catch {
        gmConfig = null;
      }
    });
    try {
      window.dispatchEvent(new CustomEvent("st-gm-request"));
    } catch {
    }
  }
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeWithGm(local, gm, base) {
    const merged = { ...local };
    for (const [k, v] of Object.entries(gm || {})) {
      if (v === void 0 || v === null) continue;
      if (!(k in merged)) {
        merged[k] = v;
      } else if (base && k in base && same(merged[k], base[k]) && !same(merged[k], v)) {
        merged[k] = v;
      }
    }
    return merged;
  }
  var Config = class {
    /**
     * @param {string} storageKey — localStorage key for all config
     * @param {object|null} [gm] — GM mirror config; defaults to what the bootstrapper sent
     */
    constructor(storageKey = "st-config", gm = gmConfig) {
      this.storageKey = storageKey;
      this.data = {};
      this.isNew = true;
      this.configLost = false;
      this._gm = gm && typeof gm === "object" ? gm : null;
      this._synced = null;
      this.load();
    }
    load() {
      let raw = null;
      try {
        raw = localStorage.getItem(this.storageKey);
        if (raw) this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
      this.isNew = !raw;
      if (!this._gm) return;
      const base = this._readSync();
      this.configLost = !raw && base !== null && Object.keys(this._gm).length === 0;
      if (this.configLost) console.warn(CONFIG_LOST_MESSAGE);
      const before = JSON.stringify(this.data);
      this.data = mergeWithGm(this.data, this._gm, base);
      if (Object.keys(this._gm).length) this.isNew = false;
      this._synced = { ...this._gm };
      this.save(JSON.stringify(this.data) !== before);
      this._writeSync();
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
    /** @param {boolean} [writeLocal=true] — false: only mirror, localStorage is already current */
    save(writeLocal = true) {
      if (writeLocal) {
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        } catch (e) {
          console.warn("[ST] Config save failed:", e);
        }
      }
      this._mirror();
    }
    /** Send every key that differs from what GM holds (also catches direct `data` writes, e.g. import). */
    _mirror() {
      if (!this._synced) return;
      const keys = /* @__PURE__ */ new Set([...Object.keys(this.data), ...Object.keys(this._synced)]);
      let changed = false;
      for (const k of keys) {
        const v = this.data[k];
        if (same(v, this._synced[k])) continue;
        const detail = v === void 0 ? { key: k } : { key: k, value: v };
        try {
          window.dispatchEvent(new CustomEvent("st-config-changed", { detail: JSON.stringify(detail) }));
        } catch {
        }
        if (v === void 0) delete this._synced[k];
        else this._synced[k] = v;
        changed = true;
      }
      if (changed) this._writeSync();
    }
    _readSync() {
      try {
        const raw = localStorage.getItem(this.storageKey + SYNC_SUFFIX);
        const v = raw ? JSON.parse(raw) : null;
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    }
    _writeSync() {
      try {
        localStorage.setItem(this.storageKey + SYNC_SUFFIX, JSON.stringify(this._synced));
      } catch {
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
      configUsage: "Usage: /st config set|get|list <key> [value] \u2014 /st config export|import",
      configExportTitle: "Export Shockr config",
      configExportIntro: "Copy this text and on the other world type /st config import (paste field) or /st config import <text>.",
      configExportSecret: "\u26A0 Contains your personal API key \u2014 never share this text.",
      configExportChat: "Config export opened \u2014 copy the text in the panel.",
      configImportTitle: "Import Shockr config",
      configImportIntro: "Paste the text from /st config export. Imported settings overwrite the ones here; other settings stay.",
      configImportButton: "Import",
      configImportInvalid: "\u274C That is not a Shockr config export \u2014 copy the whole text from /st config export.",
      configImportDone: "\u2705 Config imported: {n} settings. Reload the game (F5) so every plugin uses them.",
      registerAlreadyHasKey: "You already have a key. Registering again makes the old one invalid. Continue?",
      registerContinue: "Continue",
      cancel: "Cancel",
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
      helpConfigExport: "Copy all settings (incl. your key) as text \u2014 for another world/browser",
      helpConfigImport: "Put settings from /st config export back",
      helpRegister: "Register with the alliance server (personal key)",
      helpStatus: "Show plugin & registration status",
      helpVersion: "Show script version",
      helpUsefulSettings: "Useful settings:",
      helpSetLanguage: "en / de / nl (default: en)",
      helpSetColors: "shockr / maelstrom (default: shockr)",
      helpSetApiUrl: "Server URL for scanners/watcher (default https://packetlab.nl/shockr)",
      helpSetApiKey: "Shared alliance key (transition \u2014 use /st register)",
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
      descTargetBoard: "In-game overview of alliance targets \u2014 who is watching and who is attacking",
      descStabs: "STABS battle simulator (replaces TABS): simulate an attack and see HP, repair and loot",
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
      // 5.25.0: key restore + export prompt in the register popup, update notice, wiped-config notice
      registerHaveKey: "I still have my key",
      registerRestoreIntro: "Paste the key from an earlier /st config export (or from the register popup). It stays the same key \u2014 other browsers keep working.",
      registerRestoreLabel: "Your key",
      registerRestoreButton: "Restore key",
      registerRestoreBusy: "Checking key...",
      registerRestored: "\u2705 Key restored \u2014 your personal key is active again.",
      registerRestoredChat: "\u2705 Key restored",
      registerRestoreInvalid: "\u274C Key not valid",
      registerExportTitle: "Your backup code",
      registerExportNotice: "Keep this code somewhere safe. If you ever have to reinstall the script, it puts your settings and key back via /st config import.",
      updateAvailable: 'New version {version} available. Tampermonkey menu \u2192 "Check for userscript updates" (your settings are kept).',
      configLost: '\u26A0\uFE0F Config not found in localStorage or GM storage. If you updated the script via "Import", your config was wiped. Use /st config import with your export code, or /st register.',
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
      upgradeCalcStatusButton: "in the Shockr toolbar (own base)",
      upgradeCalcStatusOpen: "in the Shockr toolbar, panel open",
      upgradeCalcOwnBaseOnly: "Upgrade Calculator: open one of your own bases first",
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
      helpCmdTargets: "Open/close the Target Watch panel",
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
      sectorHudReserveNote: "\u{1F4CC} = your reservation marker (no marker: the view centre)",
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
      watchAgoHours: "{n} hours ago",
      // ── Toolbar (5.26.0) ──
      toolbarConfig: "Config",
      toolbarConfigHint: "Export / import your Shockr settings",
      toolbarHelp: "Help",
      toolbarUpgradeCalc: "Upgrade Calculator",
      toolbarTargetBoard: "Target Watch",
      toolbarStabs: "Battle Simulator",
      configMenuTitle: "Shockr config",
      configMenuIntro: "Export: take all settings incl. your key to another world or browser. Import: paste an export.",
      configMenuExport: "Export",
      configMenuImport: "Import",
      // ── TargetBoard ──
      targetBoardNoServer: "Target Watch needs the alliance server \u2014 type /st register",
      targetBoardStatusOpen: "panel open",
      targetBoardStatusClosed: "panel closed (/st targets)",
      targetBoardLoading: "loading\u2026",
      targetBoardFailed: "Could not load the targets \u2014 see the console (F12)",
      targetBoardRefreshFailed: "refresh failed",
      targetBoardEmpty: "Nobody in the alliance is watching a target right now",
      targetBoardUpdated: "refreshed at {time}",
      targetBoardAgoNow: "now",
      targetBoardAgoMin: "{n} min",
      targetBoardAgoHour: "{n} h",
      targetBoardColTarget: "Target",
      targetBoardColLevel: "Level",
      targetBoardColWatchers: "Watchers",
      targetBoardColSeen: "Last seen",
      targetBoardCenterHint: "Click: centre the map on this target",
      // ── STABS ──
      stabsTitle: "STABS: Statistic",
      stabsSimulate: "Simulate battle [NUM 0]",
      stabsPreset: "Preset",
      stabsPresetLive: "live",
      stabsPresetLiveDesc: "Shows the current army formation.",
      stabsPresetCyDesc: "Best cached simulation for the construction yard (and everything in front of it); then the whole base, your repair time, your losses and the battle duration.",
      stabsEnemy: "Defender",
      stabsLoadSimulate: "Load this formation and simulate",
      stabsViewSimulation: "View simulation",
      stabsReplayBack: "Back to the attack setup",
      stabsOutcome: "Combat report",
      stabsDuration: "Battle duration",
      stabsBase: "Base",
      stabsMorale: "Morale",
      stabsMoraleWarning: "Morale reduced by {v}%",
      stabsMoraleError: "Morale strongly reduced by {v}%",
      stabsTotalDefeat: "Total defeat",
      stabsTotalVictory: "Total victory",
      stabsVictory: "Victory",
      stabsTotal: "Total",
      stabsDefense: "Defense",
      stabsStructure: "Base",
      stabsSupport: "Support",
      stabsRepair: "Own repair costs",
      stabsRepairStorage: "Offense repair time",
      stabsRepairPoints: "Repair points",
      stabsCrystal: "Crystal",
      stabsRepairInf: "Infantry repair",
      stabsRepairVeh: "Vehicle repair",
      stabsRepairAir: "Aircraft repair",
      stabsLoot: "Loot",
      stabsTiberium: "Tiberium",
      stabsCredits: "Credits",
      stabsResearch: "Research points",
      stabsLootTotal: "Total loot",
      stabsCacheCount: "{n} simulations in cache",
      stabsReset: "Reset",
      stabsStatus: "{n} simulations in cache for this target",
      stabsStatusTabs: "turn one off: /st plugin disable stabs, or disable TABS in Tampermonkey",
      stabsInactiveTabs: "inactive \u2014 TABS detected",
      stabsTabsDetected: "TABS is loaded, so STABS stays inactive. Two simulators side by side get confusing \u2014 turn one off (/st plugin disable stabs, or TABS in Tampermonkey)."
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
      configUsage: "Verwendung: /st config set|get|list <key> [value] \u2014 /st config export|import",
      configExportTitle: "Shockr-Einstellungen exportieren",
      configExportIntro: "Kopiere diesen Text und tippe in der anderen Welt /st config import (Einf\xFCgefeld) oder /st config import <Text>.",
      configExportSecret: "\u26A0 Enth\xE4lt deinen pers\xF6nlichen API-Key \u2014 gib diesen Text nie weiter.",
      configExportChat: "Export der Einstellungen ge\xF6ffnet \u2014 kopiere den Text im Fenster.",
      configImportTitle: "Shockr-Einstellungen importieren",
      configImportIntro: "F\xFCge den Text aus /st config export ein. Importierte Einstellungen \xFCberschreiben die hiesigen; andere bleiben.",
      configImportButton: "Importieren",
      configImportInvalid: "\u274C Das ist kein Shockr-Export \u2014 kopiere den ganzen Text aus /st config export.",
      configImportDone: "\u2705 Einstellungen importiert: {n}. Lade das Spiel neu (F5), damit jedes Plugin sie verwendet.",
      registerAlreadyHasKey: "Du hast schon einen Key. Erneutes Registrieren macht den alten ung\xFCltig. Fortfahren?",
      registerContinue: "Fortfahren",
      cancel: "Abbrechen",
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
      helpConfigExport: "Alle Einstellungen (inkl. Key) als Text kopieren \u2014 f\xFCr eine andere Welt/Browser",
      helpConfigImport: "Einstellungen aus /st config export zur\xFCckholen",
      helpRegister: "Beim Allianz-Server registrieren (pers\xF6nlicher Key)",
      helpStatus: "Plugin- & Registrierungsstatus anzeigen",
      helpVersion: "Script-Version anzeigen",
      helpUsefulSettings: "N\xFCtzliche Einstellungen:",
      helpSetLanguage: "en / de / nl (Standard: en)",
      helpSetColors: "shockr / maelstrom (Standard: shockr)",
      helpSetApiUrl: "Server-URL f\xFCr Scanner/Watcher (Standard https://packetlab.nl/shockr)",
      helpSetApiKey: "Gemeinsamer Allianz-Key (\xDCbergang \u2014 nutze /st register)",
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
      descTargetBoard: "In-Game-\xDCbersicht der Allianz-Ziele \u2014 wer schaut und wer greift an",
      descStabs: "STABS-Kampfsimulator (ersetzt TABS): Angriff simulieren, HP, Reparatur und Beute sehen",
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
      registerHaveKey: "Ich habe meinen Key noch",
      registerRestoreIntro: "F\xFCge den Key aus einem fr\xFCheren /st config export (oder aus dem Registrierungsfenster) ein. Es bleibt derselbe Key \u2014 andere Browser funktionieren weiter.",
      registerRestoreLabel: "Dein Key",
      registerRestoreButton: "Key wiederherstellen",
      registerRestoreBusy: "Pr\xFCfe Key...",
      registerRestored: "\u2705 Key wiederhergestellt \u2014 dein pers\xF6nlicher Key ist wieder aktiv.",
      registerRestoredChat: "\u2705 Key wiederhergestellt",
      registerRestoreInvalid: "\u274C Key nicht g\xFCltig",
      registerExportTitle: "Dein Sicherungscode",
      registerExportNotice: "Bewahre diesen Code sicher auf. Falls du das Script jemals neu installieren musst, setzt er deine Einstellungen und deinen Key \xFCber /st config import zur\xFCck.",
      updateAvailable: 'Neue Version {version} verf\xFCgbar. Tampermonkey-Men\xFC \u2192 "Nach Userscript-Updates suchen" (deine Einstellungen bleiben erhalten).',
      configLost: '\u26A0\uFE0F Konfiguration weder im localStorage noch im GM-Speicher gefunden. Wenn du das Script \xFCber "Importieren" aktualisiert hast, wurde sie gel\xF6scht. Nutze /st config import mit deinem Export-Code oder /st register.',
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
      upgradeCalcStatusButton: "in der Shockr-Leiste (eigene Basis)",
      upgradeCalcStatusOpen: "in der Shockr-Leiste, Panel offen",
      upgradeCalcOwnBaseOnly: "Upgrade Calculator: \xF6ffne zuerst eine deiner eigenen Basen",
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
      helpCmdTargets: "Target-Watch-Panel \xF6ffnen/schlie\xDFen",
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
      sectorHudReserveNote: "\u{1F4CC} = deine Reservierungsmarkierung (keine Markierung: die Ansichtsmitte)",
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
      watchAgoHours: "vor {n} Stunden",
      // ── Toolbar (5.26.0) ──
      toolbarConfig: "Config",
      toolbarConfigHint: "Shockr-Einstellungen exportieren / importieren",
      toolbarHelp: "Hilfe",
      toolbarUpgradeCalc: "Upgrade Calculator",
      toolbarTargetBoard: "Target Watch",
      toolbarStabs: "Kampfsimulator",
      configMenuTitle: "Shockr-Einstellungen",
      configMenuIntro: "Exportieren: alle Einstellungen inkl. Key in eine andere Welt oder einen anderen Browser mitnehmen. Importieren: einen Export einf\xFCgen.",
      configMenuExport: "Exportieren",
      configMenuImport: "Importieren",
      // ── TargetBoard ──
      targetBoardNoServer: "Target Watch braucht den Allianz-Server \u2014 tippe /st register",
      targetBoardStatusOpen: "Panel offen",
      targetBoardStatusClosed: "Panel geschlossen (/st targets)",
      targetBoardLoading: "l\xE4dt\u2026",
      targetBoardFailed: "Ziele konnten nicht geladen werden \u2014 siehe Konsole (F12)",
      targetBoardRefreshFailed: "Aktualisierung fehlgeschlagen",
      targetBoardEmpty: "Gerade schaut niemand aus der Allianz ein Ziel an",
      targetBoardUpdated: "aktualisiert um {time}",
      targetBoardAgoNow: "jetzt",
      targetBoardAgoMin: "{n} Min",
      targetBoardAgoHour: "{n} Std",
      targetBoardColTarget: "Ziel",
      targetBoardColLevel: "Level",
      targetBoardColWatchers: "Beobachter",
      targetBoardColSeen: "Zuletzt",
      targetBoardCenterHint: "Klick: Karte auf dieses Ziel zentrieren",
      // ── STABS ──
      stabsTitle: "STABS: Statistik",
      stabsSimulate: "Kampf simulieren [NUM 0]",
      stabsPreset: "Vorgabe",
      stabsPresetLive: "live",
      stabsPresetLiveDesc: "Zeigt die aktuelle Armee-Formation.",
      stabsPresetCyDesc: "Beste gespeicherte Simulation f\xFCr den Bauhof (und alles davor); danach die ganze Basis, deine Reparaturzeit, deine Verluste und die Kampfdauer.",
      stabsEnemy: "Verteidiger",
      stabsLoadSimulate: "Diese Formation laden und simulieren",
      stabsViewSimulation: "Simulation ansehen",
      stabsReplayBack: "Zur\xFCck zur Angriffsaufstellung",
      stabsOutcome: "Kampfbericht",
      stabsDuration: "Kampfdauer",
      stabsBase: "Basis",
      stabsMorale: "Moral",
      stabsMoraleWarning: "Moral um {v}% reduziert",
      stabsMoraleError: "Moral stark um {v}% reduziert",
      stabsTotalDefeat: "Totale Niederlage",
      stabsTotalVictory: "Totaler Sieg",
      stabsVictory: "Sieg",
      stabsTotal: "Gesamt",
      stabsDefense: "Verteidigung",
      stabsStructure: "Basis",
      stabsSupport: "Unterst\xFCtzung",
      stabsRepair: "Eigene Reparaturkosten",
      stabsRepairStorage: "Reparaturzeit Offensive",
      stabsRepairPoints: "Reparaturpunkte",
      stabsCrystal: "Kristall",
      stabsRepairInf: "Reparatur Infanterie",
      stabsRepairVeh: "Reparatur Fahrzeuge",
      stabsRepairAir: "Reparatur Flugzeuge",
      stabsLoot: "Beute",
      stabsTiberium: "Tiberium",
      stabsCredits: "Credits",
      stabsResearch: "Forschungspunkte",
      stabsLootTotal: "Beute gesamt",
      stabsCacheCount: "{n} Simulationen im Cache",
      stabsReset: "Zur\xFCcksetzen",
      stabsStatus: "{n} Simulationen im Cache f\xFCr dieses Ziel",
      stabsStatusTabs: "schalte eines ab: /st plugin disable stabs, oder TABS in Tampermonkey deaktivieren",
      stabsInactiveTabs: "inaktiv \u2014 TABS erkannt",
      stabsTabsDetected: "TABS ist geladen, deshalb bleibt STABS inaktiv. Zwei Simulatoren nebeneinander verwirren \u2014 schalte einen ab (/st plugin disable stabs, oder TABS in Tampermonkey)."
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
      configUsage: "Gebruik: /st config set|get|list <key> [waarde] \u2014 /st config export|import",
      configExportTitle: "Shockr-config exporteren",
      configExportIntro: "Kopieer deze tekst en typ op de andere wereld /st config import (plakveld) of /st config import <tekst>.",
      configExportSecret: "\u26A0 Bevat je persoonlijke API-key \u2014 deel deze tekst nooit.",
      configExportChat: "Config-export geopend \u2014 kopieer de tekst in het venster.",
      configImportTitle: "Shockr-config importeren",
      configImportIntro: "Plak de tekst van /st config export. Ge\xEFmporteerde instellingen overschrijven die van hier; andere blijven staan.",
      configImportButton: "Importeren",
      configImportInvalid: "\u274C Dat is geen Shockr-config-export \u2014 kopieer de hele tekst van /st config export.",
      configImportDone: "\u2705 Config ge\xEFmporteerd: {n} instellingen. Herlaad de game (F5) zodat elke plugin ze gebruikt.",
      registerAlreadyHasKey: "Je hebt al een key. Opnieuw registreren maakt de oude ongeldig. Doorgaan?",
      registerContinue: "Doorgaan",
      cancel: "Annuleren",
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
      helpConfigExport: "Alle instellingen (incl. je key) als tekst kopi\xEBren \u2014 voor een andere wereld/browser",
      helpConfigImport: "Instellingen uit /st config export terugzetten",
      helpRegister: "Registreren bij de alliance-server (persoonlijke key)",
      helpStatus: "Plugin- & registratiestatus tonen",
      helpVersion: "Script-versie tonen",
      helpUsefulSettings: "Handige instellingen:",
      helpSetLanguage: "en / de / nl (standaard: en)",
      helpSetColors: "shockr / maelstrom (standaard: shockr)",
      helpSetApiUrl: "Server-URL voor scanners/watcher (standaard https://packetlab.nl/shockr)",
      helpSetApiKey: "Gedeelde alliance-key (overgang \u2014 gebruik /st register)",
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
      descTargetBoard: "In-game overzicht van alliance-targets \u2014 wie kijkt en wie valt aan",
      descStabs: "STABS-gevechtssimulator (vervangt TABS): simuleer een aanval en zie HP, repair en loot",
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
      registerHaveKey: "Ik heb mijn key nog",
      registerRestoreIntro: "Plak de key uit een eerdere /st config export (of uit het registratievenster). Het blijft dezelfde key \u2014 andere browsers blijven werken.",
      registerRestoreLabel: "Je key",
      registerRestoreButton: "Key terugzetten",
      registerRestoreBusy: "Key controleren...",
      registerRestored: "\u2705 Key hersteld \u2014 je persoonlijke key is weer actief.",
      registerRestoredChat: "\u2705 Key hersteld",
      registerRestoreInvalid: "\u274C Key niet geldig",
      registerExportTitle: "Je back-upcode",
      registerExportNotice: "Bewaar deze code ergens veilig. Als je het script ooit opnieuw moet installeren, kun je hiermee je instellingen en key terugzetten via /st config import.",
      updateAvailable: 'Nieuwe versie {version} beschikbaar. Tampermonkey-menu \u2192 "Controleren op updates" (je instellingen blijven behouden).',
      configLost: '\u26A0\uFE0F Config niet gevonden in localStorage en GM-storage. Als je het script via "Importeren" hebt bijgewerkt, is je config gewist. Gebruik /st config import met je export-code, of /st register.',
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
      upgradeCalcStatusButton: "in de Shockr-knop (eigen basis)",
      upgradeCalcStatusOpen: "in de Shockr-knop, paneel open",
      upgradeCalcOwnBaseOnly: "Upgrade Calculator: open eerst een van je eigen bases",
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
      helpCmdTargets: "Target Watch-paneel openen/sluiten",
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
      sectorHudReserveNote: "\u{1F4CC} = je reserveringsmarker (geen marker: het midden van het beeld)",
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
      watchAgoHours: "{n} uur geleden",
      // ── Toolbar (5.26.0) ──
      toolbarConfig: "Config",
      toolbarConfigHint: "Shockr-instellingen exporteren / importeren",
      toolbarHelp: "Help",
      toolbarUpgradeCalc: "Upgrade Calculator",
      toolbarTargetBoard: "Target Watch",
      toolbarStabs: "Gevechtssimulator",
      configMenuTitle: "Shockr-config",
      configMenuIntro: "Exporteren: neem alle instellingen incl. je key mee naar een andere wereld of browser. Importeren: plak een export.",
      configMenuExport: "Exporteren",
      configMenuImport: "Importeren",
      // ── TargetBoard ──
      targetBoardNoServer: "Target Watch heeft de alliance-server nodig \u2014 typ /st register",
      targetBoardStatusOpen: "paneel open",
      targetBoardStatusClosed: "paneel dicht (/st targets)",
      targetBoardLoading: "laden\u2026",
      targetBoardFailed: "Targets konden niet geladen worden \u2014 zie de console (F12)",
      targetBoardRefreshFailed: "verversen mislukt",
      targetBoardEmpty: "Niemand in de alliance kijkt nu naar een target",
      targetBoardUpdated: "ververst om {time}",
      targetBoardAgoNow: "nu",
      targetBoardAgoMin: "{n} min",
      targetBoardAgoHour: "{n} u",
      targetBoardColTarget: "Target",
      targetBoardColLevel: "Level",
      targetBoardColWatchers: "Kijkers",
      targetBoardColSeen: "Laatst gezien",
      targetBoardCenterHint: "Klik: centreer de kaart op dit target",
      // ── STABS ──
      stabsTitle: "STABS: Statistiek",
      stabsSimulate: "Gevecht simuleren [NUM 0]",
      stabsPreset: "Preset",
      stabsPresetLive: "live",
      stabsPresetLiveDesc: "Toont de huidige legerformatie.",
      stabsPresetCyDesc: "Beste opgeslagen simulatie voor de construction yard (en alles ervoor); daarna de hele base, je reparatietijd, je verliezen en de gevechtsduur.",
      stabsEnemy: "Verdediger",
      stabsLoadSimulate: "Deze formatie laden en simuleren",
      stabsViewSimulation: "Simulatie bekijken",
      stabsReplayBack: "Terug naar de aanvalsopstelling",
      stabsOutcome: "Gevechtsrapport",
      stabsDuration: "Gevechtsduur",
      stabsBase: "Base",
      stabsMorale: "Moraal",
      stabsMoraleWarning: "Moraal {v}% lager",
      stabsMoraleError: "Moraal sterk verlaagd, {v}% lager",
      stabsTotalDefeat: "Totale nederlaag",
      stabsTotalVictory: "Totale overwinning",
      stabsVictory: "Overwinning",
      stabsTotal: "Totaal",
      stabsDefense: "Verdediging",
      stabsStructure: "Base",
      stabsSupport: "Support",
      stabsRepair: "Eigen reparatiekosten",
      stabsRepairStorage: "Repairtijd offense",
      stabsRepairPoints: "Repairpunten",
      stabsCrystal: "Crystal",
      stabsRepairInf: "Repair infanterie",
      stabsRepairVeh: "Repair voertuigen",
      stabsRepairAir: "Repair vliegtuigen",
      stabsLoot: "Buit",
      stabsTiberium: "Tiberium",
      stabsCredits: "Credits",
      stabsResearch: "Researchpunten",
      stabsLootTotal: "Totale loot",
      stabsCacheCount: "{n} simulaties in cache",
      stabsReset: "Reset",
      stabsStatus: "{n} simulaties in cache voor dit target",
      stabsStatusTabs: "zet er \xE9\xE9n uit: /st plugin disable stabs, of TABS uitschakelen in Tampermonkey",
      stabsInactiveTabs: "inactief \u2014 TABS gedetecteerd",
      stabsTabsDetected: "TABS is geladen, dus STABS blijft inactief. Twee simulators naast elkaar is verwarrend \u2014 zet er \xE9\xE9n uit (/st plugin disable stabs, of TABS in Tampermonkey)."
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

  // lib/register-panel.js
  var PANEL_ID = "st-register-panel";
  var FOCUS_DELAY_MS = 50;
  var BTN_PRIMARY = "padding:5px 12px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;";
  var BTN_GREY = "padding:5px 12px;background:#444;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;font-size:12px;";
  var FIELD = "width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;font-size:12px;";
  var MONO_FIELD = "flex:1;min-width:0;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:12px;";
  var RegisterPanel = class {
    /**
     * @param {(code: string, replace: boolean) => Promise<{ok: boolean, message: string, vars?: object, confirm?: boolean, playerKey?: string}>} onSubmit
     *        — performs the enrollment; message is an i18n key, confirm = ask before replacing a key
     * @param {{onRestore?: (key: string) => Promise<{ok: boolean, message: string, vars?: object}>, getExport?: () => string}} [hooks]
     *        — onRestore: check + store an existing key (absent = no restore option);
     *          getExport: the /st config export text, shown after a success (absent = no export block)
     */
    constructor(onSubmit, hooks = {}) {
      this.onSubmit = onSubmit;
      this.onRestore = typeof hooks.onRestore === "function" ? hooks.onRestore : null;
      this.getExport = typeof hooks.getExport === "function" ? hooks.getExport : null;
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
      this._restoreInput = null;
      this._restoreBlock = null;
      this._confirm = null;
    }
    async _submit(form, button, status, replace = false) {
      const code = this._input.value.trim();
      if (!code) {
        this._input.focus();
        return;
      }
      button.disabled = true;
      this._input.disabled = true;
      this._showStatus(status, t("registerBusy"), "#ccc");
      const panel = this._panel;
      const result = await this.onSubmit(code, replace);
      if (panel !== this._panel) return;
      if (result.confirm) {
        this._showStatus(status, t(result.message, result.vars), "#fb5");
        panel.appendChild(this._buildConfirm(form, button, status));
      } else if (result.ok) {
        this._finish(panel, form, status, result, result.playerKey ? this._buildKeyBlock(result.playerKey) : null);
      } else {
        this._showStatus(status, t(result.message, result.vars), "#f77");
        button.disabled = false;
        this._input.disabled = false;
        this._input.select();
        this._input.focus();
      }
    }
    /** "I still have my key" → check it with the server and store it. */
    async _submitRestore(form, button, status) {
      const key = this._restoreInput.value.trim();
      if (!key) {
        this._restoreInput.focus();
        return;
      }
      button.disabled = true;
      this._restoreInput.disabled = true;
      this._showStatus(status, t("registerRestoreBusy"), "#ccc");
      const panel = this._panel;
      const result = await this.onRestore(key);
      if (panel !== this._panel) return;
      if (result.ok) {
        this._finish(panel, form, status, result, null);
      } else {
        this._showStatus(status, t(result.message, result.vars), "#f77");
        button.disabled = false;
        this._restoreInput.disabled = false;
        this._restoreInput.select();
        this._restoreInput.focus();
      }
    }
    /** Success (new key or restored): form away, green status, key block, export block, Close. */
    _finish(panel, form, status, result, keyBlock) {
      form.style.display = "none";
      if (this._restoreBlock) this._restoreBlock.style.display = "none";
      this._showStatus(status, t(result.message, result.vars), "#7c7");
      if (keyBlock) panel.appendChild(keyBlock);
      const exportText = this._exportText();
      if (exportText) panel.appendChild(this._buildExportBlock(exportText));
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = t("close");
      close.style.cssText = BTN_GREY + "margin-top:10px;";
      close.addEventListener("click", () => this.hide());
      panel.appendChild(close);
      if (!keyBlock) setTimeout(() => close.focus(), FOCUS_DELAY_MS);
    }
    /** The export text AFTER the key was stored (so it contains the key); '' when unavailable. */
    _exportText() {
      if (!this.getExport) return "";
      try {
        return String(this.getExport() || "");
      } catch (e) {
        console.warn("[ST] Register: export text failed:", e);
        return "";
      }
    }
    /** "You already have a key …": Continue (send again with replace) or Cancel (form back). */
    _buildConfirm(form, button, status) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;margin-top:8px;";
      const go = document.createElement("button");
      go.type = "button";
      go.textContent = t("registerContinue");
      go.style.cssText = BTN_PRIMARY + "background:#8a4a1a;border-color:#b8662a;";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("cancel");
      cancel.style.cssText = BTN_GREY;
      go.addEventListener("click", () => {
        row.remove();
        this._confirm = null;
        this._submit(form, button, status, true);
      });
      cancel.addEventListener("click", () => {
        row.remove();
        this._confirm = null;
        status.style.display = "none";
        button.disabled = false;
        this._input.disabled = false;
        this._input.focus();
      });
      this._confirm = row;
      setTimeout(() => cancel.focus(), FOCUS_DELAY_MS);
      row.append(go, cancel);
      return row;
    }
    /** The new key: notice, read-only field + Copy. */
    _buildKeyBlock(key) {
      const block = document.createElement("div");
      block.style.marginTop = "10px";
      const notice = document.createElement("div");
      notice.textContent = t("registerKeyNotice");
      notice.style.cssText = "color:#ddd;margin-bottom:8px;line-height:1.4;";
      const field = document.createElement("input");
      field.type = "text";
      field.readOnly = true;
      field.value = key;
      field.spellcheck = false;
      field.style.cssText = MONO_FIELD;
      field.addEventListener("focus", () => field.select());
      const { row, feedback } = this._copyRow(field, key);
      block.append(notice, row, feedback);
      setTimeout(() => {
        field.focus();
        field.select();
      }, FOCUS_DELAY_MS);
      return block;
    }
    /** The /st config export text (incl. the key) as a backup, with Copy. */
    _buildExportBlock(text) {
      const block = document.createElement("div");
      block.style.cssText = "margin-top:12px;padding-top:10px;border-top:1px solid #444;";
      const title = document.createElement("div");
      title.innerHTML = `<b style="color:#8cf">${escapeHtml(t("registerExportTitle"))}</b>`;
      title.style.marginBottom = "4px";
      const notice = document.createElement("div");
      notice.textContent = t("registerExportNotice");
      notice.style.cssText = "color:#ddd;margin-bottom:8px;line-height:1.4;";
      const area = document.createElement("textarea");
      area.value = text;
      area.readOnly = true;
      area.spellcheck = false;
      area.rows = 4;
      area.style.cssText = "flex:1;min-width:0;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:11px;resize:vertical;word-break:break-all;";
      area.addEventListener("focus", () => area.select());
      const { row, feedback } = this._copyRow(area, text);
      block.append(title, notice, row, feedback);
      return block;
    }
    /** field + Copy button side by side, with a feedback line underneath. */
    _copyRow(field, text) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:flex-start;";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = t("copy");
      copy.style.cssText = BTN_PRIMARY;
      const feedback = document.createElement("div");
      feedback.style.cssText = "min-height:16px;margin-top:4px;font-size:11px;";
      copy.addEventListener("click", async () => {
        const ok = await copyText(text, field);
        feedback.textContent = t(ok ? "copied" : "copyFailed");
        feedback.style.color = ok ? "#7c7" : "#f77";
        if (!ok) field.select();
      });
      row.append(field, copy);
      return { row, feedback };
    }
    /** "I still have my key": a link that opens the restore field + button. */
    _buildRestoreBlock(status) {
      const block = document.createElement("div");
      block.style.cssText = "margin-top:12px;padding-top:8px;border-top:1px solid #444;";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = t("registerHaveKey");
      toggle.style.cssText = "padding:0;background:none;border:none;color:#8cf;cursor:pointer;font-size:12px;text-decoration:underline;";
      const section = document.createElement("form");
      section.autocomplete = "off";
      section.style.cssText = "display:none;margin-top:8px;";
      const intro = document.createElement("div");
      intro.textContent = t("registerRestoreIntro");
      intro.style.cssText = "color:#aaa;margin-bottom:8px;line-height:1.4;";
      const label = document.createElement("label");
      label.textContent = t("registerRestoreLabel");
      label.style.cssText = "display:block;margin-bottom:4px;";
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 100;
      input.style.cssText = FIELD + "font-family:Consolas,monospace;";
      label.htmlFor = input.id = `${PANEL_ID}-restore-key`;
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = t("registerRestoreButton");
      button.style.cssText = BTN_PRIMARY + "margin-top:10px;";
      section.append(intro, label, input, button);
      section.addEventListener("submit", (e) => {
        e.preventDefault();
        this._submitRestore(section, button, status);
      });
      toggle.addEventListener("click", () => {
        const open = section.style.display === "none";
        section.style.display = open ? "block" : "none";
        if (open) setTimeout(() => input.focus(), FOCUS_DELAY_MS);
      });
      block.append(toggle, section);
      this._restoreInput = input;
      return block;
    }
    _showStatus(el, text, color) {
      el.textContent = text;
      el.style.color = color;
      el.style.display = "block";
    }
    _build() {
      const panel = document.createElement("div");
      panel.id = PANEL_ID;
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
      input.style.cssText = FIELD;
      label.htmlFor = input.id = `${PANEL_ID}-code`;
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = t("registerButton");
      button.style.cssText = BTN_PRIMARY + "margin-top:10px;";
      const status = document.createElement("div");
      status.style.cssText = "display:none;margin-top:10px;font-weight:bold;";
      form.append(intro, label, input, button);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this._submit(form, button, status);
      });
      panel.append(close, title, form, status);
      this._restoreBlock = this.onRestore ? this._buildRestoreBlock(status) : null;
      if (this._restoreBlock) panel.appendChild(this._restoreBlock);
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

  // lib/config-transfer.js
  var PANEL_ID2 = "st-config-transfer-panel";
  var FORMAT_KEY = "st-config";
  var FOCUS_DELAY_MS2 = 50;
  function exportConfig(data) {
    return JSON.stringify({ [FORMAT_KEY]: data || {} });
  }
  function parseImport(text) {
    let obj;
    try {
      obj = JSON.parse(String(text || "").trim());
    } catch {
      return { ok: false };
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj) && FORMAT_KEY in obj) obj = obj[FORMAT_KEY];
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false };
    const data = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === void 0 || v === null) continue;
      data[k.toLowerCase()] = v;
    }
    return Object.keys(data).length ? { ok: true, data } : { ok: false };
  }
  function applyImport(config, data) {
    for (const [k, v] of Object.entries(data)) config.data[k] = v;
    config.save();
    return Object.keys(data).length;
  }
  var ConfigTransferPanel = class {
    constructor() {
      this._panel = null;
    }
    hide() {
      if (this._panel) this._panel.remove();
      this._panel = null;
    }
    /** 5.26.0: the toolbar's "Config" button - choose Export or Import. */
    openMenu({ onExport, onImport }) {
      const { panel, body } = this._open(t("configMenuTitle"));
      body.append(this._note(t("configMenuIntro")));
      const exp = this._button(t("configMenuExport"));
      exp.addEventListener("click", () => onExport());
      const imp = this._button(t("configMenuImport"));
      imp.addEventListener("click", () => onImport());
      body.append(this._row(exp, imp, this._closeButton()));
      return panel;
    }
    /** Read-only text of the config + Copy. */
    openExport(text) {
      const { panel, body } = this._open(t("configExportTitle"));
      body.append(this._note(t("configExportIntro")), this._note(t("configExportSecret"), "#fb5"));
      const area = this._area(text, true);
      const feedback = this._feedback();
      const copy = this._button(t("copy"));
      copy.addEventListener("click", async () => {
        const ok = await copyText(text, area);
        feedback.textContent = t(ok ? "copied" : "copyFailed");
        feedback.style.color = ok ? "#7c7" : "#f77";
        if (!ok) area.select();
      });
      body.append(area, this._row(copy, this._closeButton()), feedback);
      setTimeout(() => {
        area.focus();
        area.select();
      }, FOCUS_DELAY_MS2);
      return panel;
    }
    /**
     * Empty text field + Import. onImport(text) returns the chat/panel result:
     * {ok: boolean, message: string} (message already translated).
     */
    openImport(onImport) {
      const { panel, body } = this._open(t("configImportTitle"));
      body.append(this._note(t("configImportIntro")));
      const area = this._area("", false);
      const feedback = this._feedback();
      const go = this._button(t("configImportButton"));
      go.addEventListener("click", () => {
        const result = onImport(area.value);
        feedback.textContent = result.message;
        feedback.style.color = result.ok ? "#7c7" : "#f77";
        if (result.ok) {
          area.disabled = true;
          go.disabled = true;
        }
      });
      body.append(area, this._row(go, this._closeButton()), feedback);
      setTimeout(() => area.focus(), FOCUS_DELAY_MS2);
      return panel;
    }
    _open(titleText) {
      this.hide();
      const panel = document.createElement("div");
      panel.id = PANEL_ID2;
      panel.style.cssText = `
            position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
            z-index: 10000; width: 440px; max-width: calc(100vw - 16px); box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92); color: #ddd; border: 1px solid #444; border-radius: 4px;
            padding: 10px 14px 14px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px;
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
      const title = document.createElement("div");
      title.innerHTML = `<b style="color:#8cf;font-size:13px">${escapeHtml(titleText)}</b>`;
      title.style.marginBottom = "8px";
      const body = document.createElement("div");
      panel.append(close, title, body);
      document.body.appendChild(panel);
      this._panel = panel;
      return { panel, body };
    }
    _note(text, color = "#aaa") {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `color:${color};margin-bottom:8px;line-height:1.4;`;
      return el;
    }
    _area(value, readOnly) {
      const area = document.createElement("textarea");
      area.value = value;
      area.readOnly = readOnly;
      area.spellcheck = false;
      area.rows = 6;
      area.style.cssText = "width:100%;box-sizing:border-box;padding:5px 6px;background:#111;color:#fd8;border:1px solid #555;border-radius:3px;font-family:Consolas,monospace;font-size:11px;resize:vertical;word-break:break-all;";
      if (readOnly) area.addEventListener("focus", () => area.select());
      return area;
    }
    _button(text) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.style.cssText = "padding:5px 12px;background:#2a5a8a;color:#fff;border:1px solid #3a7ab8;border-radius:3px;cursor:pointer;font-size:12px;";
      return b;
    }
    _closeButton() {
      const b = this._button(t("close"));
      b.style.background = "#444";
      b.style.borderColor = "#666";
      b.addEventListener("click", () => this.hide());
      return b;
    }
    _row(...buttons) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;margin-top:8px;";
      row.append(...buttons);
      return row;
    }
    _feedback() {
      const el = document.createElement("div");
      el.style.cssText = "min-height:16px;margin-top:6px;font-size:12px;font-weight:bold;";
      return el;
    }
  };

  // lib/cli.js
  var SECRET_KEYS = ["api.playerkey"];
  var Cli = class {
    constructor(config) {
      this.config = config;
      this.commands = {};
      this._setHooks = {};
      this.PREFIX = "/st";
      this._handleKeyDown = this._handleKeyDown.bind(this);
      this._transferPanel = new ConfigTransferPanel();
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
      this.register("config", (args, rawArgs = "") => {
        const [action, ...rest] = args;
        if (action === "export") {
          this.openExport();
        } else if (action === "import") {
          const text = rawArgs.replace(/^import\s*/i, "");
          if (text) {
            chatMessage(`[ST] ${escapeHtml(this._importConfig(text).message)}`);
          } else {
            this.openImport();
          }
        } else if (action === "set" && rest.length >= 2) {
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
    /** 5.26.0: the toolbar's "Config" button. */
    openConfigMenu() {
      this._transferPanel.openMenu({ onExport: () => this.openExport(), onImport: () => this.openImport() });
    }
    openExport() {
      this._transferPanel.openExport(exportConfig(this.config.data));
      chatMessage(`[ST] ${t("configExportChat")}`);
    }
    /** Paste field; the result goes to the panel and the chat. */
    openImport() {
      this._transferPanel.openImport((pasted) => {
        const result = this._importConfig(pasted);
        chatMessage(`[ST] ${escapeHtml(result.message)}`);
        return result;
      });
    }
    /** Import an export text; @returns {{ok: boolean, message: string}} (translated). */
    _importConfig(text) {
      const parsed = parseImport(text);
      if (!parsed.ok) return { ok: false, message: t("configImportInvalid") };
      const n = applyImport(this.config, parsed.data);
      return { ok: true, message: t("configImportDone", { n }) };
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
      const line = el.value.trim();
      const parts = line.split(/\s+/);
      const cmd = (parts[1] || "").toLowerCase();
      const args = parts.slice(2);
      const raw = line.match(/^\S+\s+\S+\s*([\s\S]*)$/);
      const handler = this.commands[cmd];
      if (handler) {
        try {
          handler(args, raw ? raw[1] : "");
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
  var DEFAULT_API_URL = "https://packetlab.nl/shockr";
  var ALREADY_REGISTERED = "Already registered";
  var ENROLL_ERRORS = {
    "Invalid enrollment code": "registerInvalidCode",
    "Alliance not authorized": "registerNotAuthorized"
  };
  var KEY_NOT_VALID = "Key not valid";
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
      return this.config.get("api.url", "") || DEFAULT_API_URL;
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
     *
     * Re-register guard (5.24.0): a new key invalidates the old one, also in
     * other browsers / game servers. Without `replace` the call stops with
     * `confirm: true` when this browser holds the player's key, or when the
     * server answers 409 (the player has a key elsewhere); the popup asks and
     * calls again with replace = true.
     * @param {string} code
     * @param {boolean} [replace] — the player confirmed replacing an existing key
     * @returns {Promise<{ok: boolean, message: string, vars?: object, playerKey?: string, confirm?: boolean}>} message = i18n key
     */
    async enroll(code, replace = false) {
      if (!this._url) return { ok: false, message: "registerNoServer" };
      const player = readPlayer();
      if (!player || !player.id || !player.name || !player.worldId) {
        return { ok: false, message: "registerNoGameData" };
      }
      if (!player.allianceId) return { ok: false, message: "registerNoAlliance" };
      if (!replace && this._playerKey) return { ok: false, message: "registerAlreadyHasKey", confirm: true };
      try {
        const resp = await fetch(this._url.replace(/\/$/, "") + "/api/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: player.id,
            playerName: player.name,
            allianceId: player.allianceId,
            worldId: player.worldId,
            enrollmentCode: code,
            replace
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
        if (resp.status === 409 && data.detail === ALREADY_REGISTERED) {
          return { ok: false, message: "registerAlreadyHasKey", confirm: true };
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
    /**
     * POST /api/enroll/restore (5.25.0): put a key the player still has (from
     * /st config export) back after the browser lost it. The server only checks
     * it against the stored hash - nothing new is issued, so other browsers /
     * game servers that still hold the key keep working. On success the key is
     * stored like after an enrollment (api.playerKey + api.playerKeyId).
     * @param {string} key
     * @returns {Promise<{ok: boolean, message: string, vars?: object, playerKey?: string}>} message = i18n key
     */
    async restoreKey(key) {
      if (!this._url) return { ok: false, message: "registerNoServer" };
      const player = readPlayer();
      if (!player || !player.id) return { ok: false, message: "registerNoGameData" };
      const raw = String(key || "").trim();
      if (!raw) return { ok: false, message: "registerRestoreInvalid" };
      try {
        const resp = await fetch(this._url.replace(/\/$/, "") + "/api/enroll/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: player.id, key: raw })
        });
        let data = {};
        try {
          data = await resp.json();
        } catch {
        }
        if (resp.ok && data.status === "ok") {
          this.config.set("api.playerKey", raw);
          this.config.set("api.playerKeyId", player.id);
          return { ok: true, message: "registerRestored", playerKey: raw };
        }
        if (resp.status === 403 && data.detail === KEY_NOT_VALID) {
          return { ok: false, message: "registerRestoreInvalid" };
        }
        if (resp.status === 429) return { ok: false, message: "registerRateLimited" };
        return { ok: false, message: "registerFailed", vars: { error: `HTTP ${resp.status}` } };
      } catch (e) {
        console.warn("[ST] API: key restore network error", e.message);
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
    { cmd: "formation", usage: "/st formation save|load|list|delete [name]", key: "helpCmdFormation" },
    { cmd: "targets", usage: "/st targets", key: "helpCmdTargets" }
  ];
  var USEFUL_SETTINGS = [
    ["language", "helpSetLanguage"],
    ["colors", "helpSetColors"],
    ["api.url", "helpSetApiUrl"],
    ["api.key", "helpSetApiKey"],
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
        rows: plugins.filter((p) => !p.parked).map((p) => [kebab(p.name), p.description || ""])
        // parked = built, off, not offered
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
        ["/st config export", t("helpConfigExport")],
        ["/st config import [text]", t("helpConfigImport")],
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
  var PANEL_ID3 = "st-help-panel";
  var PANEL_CSS = `
#${PANEL_ID3} td.st-cmd { width: 230px; }
#${PANEL_ID3} table.st-sub { margin-left: 10px; }
#${PANEL_ID3} table.st-sub td.st-cmd { width: 220px; }
@media (max-width: 600px) {
    #${PANEL_ID3} tr, #${PANEL_ID3} td { display: block; }
    #${PANEL_ID3} td.st-cmd, #${PANEL_ID3} table.st-sub td.st-cmd { width: auto; padding-top: 4px; }
    #${PANEL_ID3} td.st-cmd + td { padding-left: 12px; }
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
      panel.id = PANEL_ID3;
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

  // lib/update-check.js
  var VERSION_PATH = "/api/version";
  var FETCH_TIMEOUT_MS = 8e3;
  function compareVersions(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  function parse(v) {
    return String(v || "").trim().replace(/^v/i, "").split(".").map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
  }
  async function checkForUpdate(baseUrl, current, fetchFn = globalThis.fetch) {
    const base = String(baseUrl || "").trim().replace(/\/$/, "");
    if (!base || typeof fetchFn !== "function") return { newer: false, version: null };
    let timer = null;
    try {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      if (ctrl) timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const resp = await fetchFn(base + VERSION_PATH, { method: "GET", signal: ctrl ? ctrl.signal : void 0 });
      if (!resp || !resp.ok) return { newer: false, version: null };
      const data = await resp.json();
      const version = data && typeof data.version === "string" ? data.version.trim() : "";
      if (!version) return { newer: false, version: null };
      return { newer: compareVersions(version, current) > 0, version };
    } catch {
      return { newer: false, version: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  var announced = false;
  async function announceUpdateOnce({ url, current, notify, fetchFn }) {
    if (announced) return null;
    const result = await checkForUpdate(url, current, fetchFn);
    if (!result.newer || announced) return null;
    announced = true;
    try {
      notify(result.version);
    } catch (e) {
      console.warn("[ST] Update notice failed:", e);
    }
    return result.version;
  }

  // lib/drag.js
  var DRAG_THRESHOLD_PX = 4;
  var MIN_VISIBLE_PX = 24;
  function loadPosition(config, prefix, fallback) {
    const x = Number(config.get(`${prefix}.x`));
    const y = Number(config.get(`${prefix}.y`));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
  }
  function clampPosition(pos, size, viewport) {
    const maxX = Math.max(0, viewport.w - Math.min(size.w, MIN_VISIBLE_PX));
    const maxY = Math.max(0, viewport.h - Math.min(size.h, MIN_VISIBLE_PX));
    return {
      x: Math.round(Math.min(Math.max(0, pos.x), maxX)),
      y: Math.round(Math.min(Math.max(0, pos.y), maxY))
    };
  }
  function makeDraggable(el, handle, { config, prefix, onClick, onMove }) {
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = el.getBoundingClientRect();
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        const pos = clampPosition(
          { x: rect.left + dx, y: rect.top + dy },
          { w: rect.width, h: rect.height },
          { w: window.innerWidth, h: window.innerHeight }
        );
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        if (onMove) onMove();
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (dragging) {
          config.set(`${prefix}.x`, parseInt(el.style.left, 10));
          config.set(`${prefix}.y`, parseInt(el.style.top, 10));
        } else if (onClick) {
          onClick();
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    });
  }

  // lib/toolbar.js
  var BUTTON_ID = "st-toolbar-button";
  var GRID_ID = "st-toolbar-grid";
  var DEFAULT_POSITION = { x: 80, y: 46 };
  var BUTTON_SIZE = 40;
  var ITEM_SIZE = 40;
  var GAP = 4;
  var COLUMNS = 2;
  var ICON_COLOR = "#4fc3f7";
  var BUTTON_CSS = `
    box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(to bottom, #1a4a6e, #0d2a40);
    color: ${ICON_COLOR};
    border: 1px solid #5f8fb4;
    border-radius: 4px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 1px 3px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
`;
  var ICONS = {
    shield: '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10.5-4.6-1.7-8-5.5-8-10.5v-6z"/><path d="M13.2 6.5L9 13h3l-1.2 4.8L15 11h-3z" fill="currentColor" stroke="none"/></svg>',
    calc: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="4" rx="0.5"/><path d="M8.5 13h1M12 13h0M15.5 13h0M8.5 16.5h0M12 16.5h0M15.5 16.5h0" stroke-width="2.4" stroke-linecap="round"/></svg>',
    help: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.2"/><circle cx="12" cy="17.6" r="0.6" fill="currentColor"/></svg>',
    sim: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5l9.5 9.5M3.5 3.5h3l9 9M20 3.5L10.5 13M20.5 3.5h-3l-9 9"/><path d="M6.5 15.5l2 2M15.5 15.5l-2 2M4.5 19.5l3-3M19.5 19.5l-3-3"/></svg>',
    radar: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>'
  };
  var Toolbar = class {
    /**
     * @param {object} config
     * @param {object} opts
     * @param {Function} opts.onConfig — the "Config" button (export/import panel)
     */
    constructor(config, { onConfig }) {
      this.config = config;
      this._onConfig = onConfig;
      this._items = [];
      this._button = null;
      this._grid = null;
      this._onDocDown = (e) => {
        if (this._grid && this._grid.contains(e.target)) return;
        if (this._button && this._button.contains(e.target)) return;
        this.close();
      };
      this._onKeyDown = (e) => {
        if (e.key === "Escape") this.close();
      };
    }
    /** Add a grid item; the same id again replaces it in place. */
    register(item) {
      const i = this._items.findIndex((x) => x.id === item.id);
      if (i >= 0) this._items[i] = item;
      else this._items.push(item);
      if (this.isOpen()) this._renderGrid();
    }
    unregister(id) {
      this._items = this._items.filter((i) => i.id !== id);
      if (this.isOpen()) this._renderGrid();
    }
    /** Items the grid shows now (isAvailable() false → hidden). */
    visibleItems() {
      return this._items.filter((i) => {
        try {
          return !i.isAvailable || i.isAvailable();
        } catch {
          return false;
        }
      });
    }
    /** Create the main button (once the game UI is up). */
    start() {
      if (this._button && document.body.contains(this._button)) return;
      const pos = clampPosition(
        loadPosition(this.config, "toolbar", DEFAULT_POSITION),
        { w: BUTTON_SIZE, h: BUTTON_SIZE },
        { w: window.innerWidth, h: window.innerHeight }
      );
      const btn = document.createElement("div");
      btn.id = BUTTON_ID;
      btn.title = "Shockr TA Tools";
      btn.innerHTML = ICONS.shield;
      btn.style.cssText = `${BUTTON_CSS}
            position: fixed; left: ${pos.x}px; top: ${pos.y}px; z-index: 9999;
            width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px;`;
      hover(btn);
      document.body.appendChild(btn);
      this._button = btn;
      makeDraggable(btn, btn, {
        config: this.config,
        prefix: "toolbar",
        onClick: () => this.toggle(),
        onMove: () => {
          if (this.isOpen()) this._placeGrid();
        }
      });
    }
    isOpen() {
      return !!this._grid && this._grid.style.display !== "none";
    }
    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    }
    open() {
      if (!this._grid || !document.body.contains(this._grid)) {
        const grid = document.createElement("div");
        grid.id = GRID_ID;
        grid.style.cssText = `
                position: fixed; z-index: 10001; box-sizing: border-box;
                padding: ${GAP}px; background: rgba(10, 25, 38, 0.92);
                border: 1px solid #3d6a8c; border-radius: 4px; pointer-events: auto;`;
        document.body.appendChild(grid);
        this._grid = grid;
      }
      this._renderGrid();
      this._grid.style.display = "block";
      this._placeGrid();
      document.addEventListener("mousedown", this._onDocDown, true);
      document.addEventListener("keydown", this._onKeyDown);
    }
    close() {
      document.removeEventListener("mousedown", this._onDocDown, true);
      document.removeEventListener("keydown", this._onKeyDown);
      if (this._grid) this._grid.style.display = "none";
    }
    _renderGrid() {
      const grid = this._grid;
      grid.innerHTML = "";
      const cells = document.createElement("div");
      cells.style.cssText = `display: grid; grid-template-columns: repeat(${COLUMNS}, ${ITEM_SIZE}px); gap: ${GAP}px;`;
      for (const item of this.visibleItems()) {
        const cell = document.createElement("div");
        cell.innerHTML = item.icon;
        cell.title = typeof item.label === "function" ? item.label() : item.label;
        cell.style.cssText = `${BUTTON_CSS} width: ${ITEM_SIZE}px; height: ${ITEM_SIZE}px;`;
        hover(cell);
        cell.addEventListener("click", () => this._run(item.onClick));
        cells.appendChild(cell);
      }
      if (cells.childElementCount) grid.appendChild(cells);
      const config = document.createElement("div");
      config.textContent = t("toolbarConfig");
      config.title = t("toolbarConfigHint");
      config.style.cssText = `${BUTTON_CSS}
            width: ${COLUMNS * ITEM_SIZE + (COLUMNS - 1) * GAP}px; height: 24px;
            margin-top: ${cells.childElementCount ? GAP : 0}px;
            font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12px; font-weight: bold;`;
      hover(config);
      config.addEventListener("click", () => this._run(this._onConfig));
      grid.appendChild(config);
    }
    /** Below the button, or above it when there is no room; kept inside the viewport. */
    _placeGrid() {
      const b = this._button.getBoundingClientRect();
      const g = this._grid.getBoundingClientRect();
      let top = b.bottom + GAP;
      if (top + g.height > window.innerHeight) top = Math.max(0, b.top - GAP - g.height);
      const left = Math.min(Math.max(0, b.left), Math.max(0, window.innerWidth - g.width));
      this._grid.style.left = `${Math.round(left)}px`;
      this._grid.style.top = `${Math.round(top)}px`;
    }
    _run(fn) {
      this.close();
      try {
        if (fn) fn();
      } catch (err) {
        console.error("[ST] Toolbar: item failed", err);
      }
    }
  };
  function hover(el) {
    el.addEventListener("mouseenter", () => {
      el.style.borderColor = "#9fd4f5";
      el.style.color = "#b3e5fc";
    });
    el.addEventListener("mouseleave", () => {
      el.style.borderColor = "#5f8fb4";
      el.style.color = ICON_COLOR;
    });
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
    const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
    for (let i = 0; i < maxAttempts; i++) {
      const city = cities2.GetCity(cityId);
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
  var PANEL_ID4 = "mehrstrom-killinfo-panel";
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
      panel.id = PANEL_ID4;
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
    const cities2 = md.get_Cities();
    let city = null;
    try {
      const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
      if (sel && typeof sel.get_Id === "function") city = cities2.GetCity(sel.get_Id());
    } catch {
    }
    if (!city) {
      try {
        city = cities2.get_CurrentCity();
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
  var MAX_CACHED_VERSIONS = 500;
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
        const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
        originalCityId = cities2.get_CurrentCityId();
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
          const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
          cities2.set_CurrentCityId(cityId);
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
          if (scannedVersions.size > MAX_CACHED_VERSIONS) {
            const excess = scannedVersions.size - MAX_CACHED_VERSIONS;
            let i = 0;
            for (const key of scannedVersions.keys()) {
              if (i++ >= excess) break;
              scannedVersions.delete(key);
            }
          }
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
  var MAX_CACHED_VERSIONS2 = 500;
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
        const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
        for (const cityId of cityIds) {
          if (!manual && (!this.idle.isIdle || this.online.isPaused)) {
            aborted = this.online.isPaused ? "player online" : "player active";
            break;
          }
          try {
            const existingCity = cities2.GetCity(cityId);
            if (existingCity && scannedVersions2.get(cityId) === existingCity.get_Version()) {
              skipped++;
              continue;
            }
          } catch {
          }
          cities2.set_CurrentCityId(cityId);
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
          if (scannedVersions2.size > MAX_CACHED_VERSIONS2) {
            const excess = scannedVersions2.size - MAX_CACHED_VERSIONS2;
            let i = 0;
            for (const key of scannedVersions2.keys()) {
              if (i++ >= excess) break;
              scannedVersions2.delete(key);
            }
          }
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
  var PANEL_ID5 = "st-upgradecalc-panel";
  var TOOLBAR_ID = "upgradecalc";
  var RES_TIB2 = 1;
  var RES_POWER = 5;
  var VIEW_CHECK_INTERVAL_MS = 1e3;
  var REFRESH_INTERVAL_MS = 3e4;
  var UpgradeCalc = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descUpgradeCalc");
    }
    constructor(config, toolbar) {
      this.name = "UpgradeCalc";
      this.defaultEnabled = false;
      this.config = config;
      this.toolbar = toolbar;
      this.running = false;
      this._panel = null;
      this._content = null;
      this._viewTimer = null;
      this._refreshTimer = null;
      this._viewKey = null;
    }
    async start() {
      this.running = true;
      this.toolbar.register({
        id: TOOLBAR_ID,
        icon: ICONS.calc,
        label: () => t("toolbarUpgradeCalc"),
        onClick: () => this.toggle()
      });
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
      this.toolbar.unregister(TOOLBAR_ID);
      if (this._panel) this._panel.remove();
      this._panel = null;
      this._content = null;
      this._viewKey = null;
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return "/st plugin enable upgradecalc";
      return t(this._isOpen() ? "upgradeCalcStatusOpen" : "upgradeCalcStatusButton");
    }
    /** Toolbar item: close the panel if open, otherwise show it for the current own city. */
    toggle() {
      if (this._isOpen()) {
        this._hide();
        return;
      }
      const city = getViewedOwnCity();
      if (!city) {
        chatMessage(`[ST] ${t("upgradeCalcOwnBaseOnly")}`);
        return;
      }
      this._ensurePanel();
      this._render(city);
      this._panel.style.display = "block";
      this._refreshTimer = setInterval(() => {
        const current = getViewedOwnCity();
        if (current) this._render(current);
      }, REFRESH_INTERVAL_MS);
    }
    /** Close the panel when the view/base changes. */
    _checkView() {
      const city = getViewedOwnCity();
      const key = city ? String(city.get_Id()) : null;
      if (key !== this._viewKey) {
        this._viewKey = key;
        this._hide();
      }
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
    _ensurePanel() {
      if (this._panel && document.body.contains(this._panel)) return this._panel;
      const panel = document.createElement("div");
      panel.id = PANEL_ID5;
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
      const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
      const own = cities2.get_CurrentOwnCity();
      const viewed = cities2.get_CurrentCity();
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
  function roundLevel(level) {
    return Math.round(Number(level) * 10) / 10;
  }
  function formatLevel(level) {
    const l = roundLevel(level);
    if (!Number.isFinite(l)) return "0";
    return Number.isInteger(l) ? String(l) : l.toFixed(1);
  }
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
      const level = roundLevel(city.get_LvlBase());
      const type = getTargetType(x, y, faction);
      const label = { camp: "Camp", outpost: "Outpost", base: "FG Base", player: "Base" }[type];
      return {
        playerId,
        playerName: clip(playerName),
        targetId: Number(city.get_Id()),
        targetName: clip(city.get_Name() || `${label} L${formatLevel(level)}`),
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
      const cities2 = md.get_Cities();
      const cityType = cityObjectType();
      let ownPlayerId2 = null;
      try {
        ownPlayerId2 = md.get_Player().id;
      } catch {
      }
      let ownIds = [];
      try {
        ownIds = Object.values(cities2.get_AllCities().d).map((c) => c.get_Id());
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
        this._readLevels(cities2, base.id);
        base.levels = this.levels.get(base.id) || null;
      }
      return found;
    }
    _readLevels(cities2, id) {
      try {
        const city = cities2.GetCity(id);
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
    const add2 = (entry, status) => {
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
      add2(w, "viewing");
    }
    for (const c of data.claims || []) add2(c, "claimed");
    for (const a of data.attacks || []) add2(a, "attacked");
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
  var REFRESH_MS3 = 5e3;
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
    const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
    const own = cities2.get_CurrentOwnCity();
    let targetId = 0;
    try {
      targetId = cities2.get_CurrentForeignCityId();
    } catch {
    }
    if (!targetId) {
      try {
        targetId = cities2.get_CurrentCity().get_Id();
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
  function sectorNo(x, y, worldWidth, worldHeight, count) {
    const dx = x - Math.floor(worldWidth / 2);
    const dy = y - Math.floor(worldHeight / 2);
    const turn = Math.atan2(-dx, dy) / (2 * Math.PI);
    const slice = Math.round(turn * count);
    return (slice % count + count) % count;
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
    const zoom = region.get_ZoomFactor() || 1;
    const midX = region.get_PosX() + region.get_ViewWidth() / (2 * zoom);
    const midY = region.get_PosY() + region.get_ViewHeight() / (2 * zoom);
    return { x: Math.floor(midX / region.get_GridWidth()), y: Math.floor(midY / region.get_GridHeight()) };
  }
  var RESERVE_MARKER_TYPE = 5;
  function ownReserveMarker(markers, playerName) {
    if (!playerName) return null;
    for (const m of markers || []) {
      if (m.get_Type() === RESERVE_MARKER_TYPE && m.get_NamePlayerCreated() === playerName) {
        return { x: m.get_CoordX(), y: m.get_CoordY() };
      }
    }
    return null;
  }
  function parseCoords(text) {
    const nums = String(text || "").match(/\d+/g);
    if (!nums || nums.length < 2) return null;
    return { x: Number(nums[0]), y: Number(nums[1]) };
  }
  function insertAt(value, from, to, tag) {
    const before = value.slice(0, from);
    const gap = before && !/\s$/.test(before) ? " " : "";
    return before + gap + tag + value.slice(to);
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
      this.reserve = null;
      this._markerEvent = null;
    }
    async start() {
      this.running = true;
      this._watchMarkers();
      this._timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
      console.log("[ST] SectorHud: started");
    }
    stop() {
      this.running = false;
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      if (this._markerEvent) {
        const ev = this._markerEvent;
        try {
          webfrontend.phe.cnc.Util.detachNetEvent(ev.source, "AllianceMarkerChange", ev.type, this, this._onMarkersChange);
        } catch {
        }
        this._markerEvent = null;
      }
      if (this.el) {
        this.el.remove();
        this.el = null;
      }
    }
    /**
     * Own reservation marker, refreshed on the alliance's AllianceMarkerChange
     * event instead of every tick. ClientLib.Data.AllianceMarkerChange is the
     * delegate name by the game's naming pattern (AllianceChange, CitiesChange).
     */
    _watchMarkers() {
      try {
        const source = ClientLib.Data.MainData.GetInstance().get_Alliance();
        const type = ClientLib.Data.AllianceMarkerChange;
        webfrontend.phe.cnc.Util.attachNetEvent(source, "AllianceMarkerChange", type, this, this._onMarkersChange);
        this._markerEvent = { source, type };
      } catch (e) {
        console.warn("[ST] SectorHud: marker event not available", e && e.message);
      }
      this._onMarkersChange();
    }
    _onMarkersChange() {
      try {
        const md = ClientLib.Data.MainData.GetInstance();
        this.reserve = ownReserveMarker(md.get_Alliance().get_Markers().l, md.get_Player().get_Name());
      } catch {
        this.reserve = null;
      }
      if (this.running && this.el && this.el.style.display !== "none") this.render();
    }
    /** Cell shown in the HUD: the own reservation marker, else the view centre. */
    focus() {
      if (this.reserve) return { ...this.reserve, reserve: true };
      return viewCenter(ClientLib.Vis.VisMain.GetInstance().get_Region());
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
      const c = this.focus();
      const here = sectorNo(c.x, c.y, geo.width, geo.height, geo.count);
      const own = ownAlliance();
      const summary = sectorSummary(this.knownPois(own && own.id), own && own.id, geo);
      const cur = summary[here];
      const el = this._ensureElement();
      el.style.display = "";
      el.textContent = "";
      const line1 = document.createElement("div");
      const coords = document.createElement("span");
      coords.textContent = `${c.reserve ? "\u{1F4CC} " : ""}${c.x}:${c.y} `;
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
        ...c.reserve ? [t("sectorHudReserveNote")] : [],
        t("sectorHudSeenNote"),
        t("sectorHudClickNote")
      ].join("\n");
    }
    _ensureElement() {
      if (this.el) return this.el;
      const el = document.createElement("div");
      Object.assign(el.style, {
        // top-left, right of the game's own corner menu
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
    /** Left click: "[coords]x:y[/coords]" into the chat input at the cursor. */
    _pasteCoords() {
      try {
        const c = this.focus();
        const input = qx.core.Init.getApplication().getChat().getChatWidget().getEditable();
        const dom = input.getContentElement().getDomElement();
        const value = dom.value || "";
        const from = typeof dom.selectionStart === "number" ? dom.selectionStart : value.length;
        const to = typeof dom.selectionEnd === "number" ? dom.selectionEnd : from;
        input.setValue(insertAt(value, from, to, `[coords]${c.x}:${c.y}[/coords]`));
      } catch (e) {
        console.warn("[ST] SectorHud: paste coords failed", e && e.message);
      }
    }
    /** Right click: ask for coordinates and centre the map there. */
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
  var DRAG_THRESHOLD_PX2 = 4;
  var MIN_VISIBLE_PX2 = 80;
  var MAX_ENTRIES = 60;
  var STORE_KEY = "MovableMenu.positions";
  function clampPosition2(left, top, w, vw, vh) {
    const minLeft = -Math.max(0, w - MIN_VISIBLE_PX2);
    const maxLeft = Math.max(0, vw - MIN_VISIBLE_PX2);
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
      const c = clampPosition2(pos.left, pos.top, b.width || 0, vw, vh);
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
      const c = clampPosition2(baseLeft + dx, baseTop + dy, r.width, vw, vh);
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
          if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX2 && Math.abs(dy) < DRAG_THRESHOLD_PX2) return;
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
    const cities2 = ClientLib.Data.MainData.GetInstance().get_Cities();
    return { target: cities2.get_CurrentOwnCity(), all: Object.values(cities2.get_AllCities().d) };
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
  var COLUMNS2 = [
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
          for (const c of COLUMNS2) this._icons[c.key] = fm.GetPhysicalPath(c.icon);
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
        for (const c of COLUMNS2) {
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
  var WORD_CHAR = /[A-Za-z0-9_.-]/;
  var LINE_TYPES = /* @__PURE__ */ new Set(["text", "search", ""]);
  var DIAG_AFTER = 5;
  var TAGGED_BLOCK = /\[(coords|url|player|alliance)\][\s\S]*?\[\/\1\]/gi;
  var SHORTHAND = /\[(p|a)\]([^[\]]+?)\[\/\1\]/gi;
  var URL = /https?:\/\/[^\s[\]]+/gi;
  var COORDS = /(^|[^\d])(\d{3,4})[:.](\d{3,4})([:.]\w+)?(?!\d)/g;
  var NO_COORDS_LINE = /^(http:\/\/cnc-map|\[url\])/i;
  var CLEARABLE = /* @__PURE__ */ new Set(["coords", "url", "player", "alliance", "b", "i", "u", "s"]);
  function outsideTags(text, fn) {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(TAGGED_BLOCK)) {
      out += fn(text.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    return out + fn(text.slice(last));
  }
  function autoTag(text) {
    let s = String(text);
    const keepCoords = NO_COORDS_LINE.test(s);
    s = outsideTags(s, (part) => part.replace(SHORTHAND, (m, kind, name) => {
      const tag = kind.toLowerCase() === "p" ? "player" : "alliance";
      return `[${tag}]${name}[/${tag}]`;
    }));
    s = outsideTags(s, (part) => part.replace(URL, (url) => `[url]${url}[/url]`));
    if (!keepCoords) {
      s = outsideTags(s, (part) => part.replace(COORDS, (m, before, x, y, extra) => `${before}[coords]${x}:${y}${extra ? ":" + extra.slice(1) : ""}[/coords]`));
    }
    return s;
  }
  function clearTags(text) {
    return String(text).replace(/\[\/?([a-z]+)\]/gi, (m, name) => CLEARABLE.has(name.toLowerCase()) ? "" : m);
  }
  function wordAt(text, pos) {
    if (!WORD_CHAR.test(text.charAt(pos - 1))) return null;
    let s = pos;
    let e = pos;
    while (s > 0 && WORD_CHAR.test(text.charAt(s - 1))) s--;
    while (e < text.length && WORD_CHAR.test(text.charAt(e))) e++;
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
  var ALERT_FAVICON = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="%23e53935"/><rect x="6.75" y="3" width="2.5" height="6.5" rx="1" fill="%23fff"/><circle cx="8" cy="12.25" r="1.4" fill="%23fff"/></svg>';
  var ALERT_FAVICON_TYPE = "image/svg+xml";
  var NORMAL_FAVICON = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 .8 14.2 3v4.6c0 3.7-2.6 6.6-6.2 7.6C4.4 14.2 1.8 11.3 1.8 7.6V3z" fill="%23546e7a"/><path d="M8 3 12 4.4v3.2c0 2.5-1.7 4.5-4 5.3z" fill="%2390a4ae"/></svg>';
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
      this._setFavicon(ALERT_FAVICON, ALERT_FAVICON_TYPE);
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

  // plugins/target-board.js
  var PANEL_ID6 = "st-targetboard-panel";
  var TOOLBAR_ID2 = "targetboard";
  var REFRESH_INTERVAL_MS2 = 2e4;
  var PANEL_WIDTH = 400;
  var DEFAULT_POSITION2 = { x: 130, y: 46 };
  var DOUBLE_WATCHERS = 2;
  var TargetBoard = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descTargetBoard");
    }
    constructor(config, api, toolbar, cli) {
      this.name = "TargetBoard";
      this.config = config;
      this.api = api;
      this.toolbar = toolbar;
      this.cli = cli;
      this.running = false;
      this._panel = null;
      this._title = null;
      this._content = null;
      this._timer = null;
      this._targets = null;
      this._updatedAt = null;
      this._error = false;
      this._loading = false;
      this._onKeyDown = (e) => {
        if (e.key === "Escape") this.close();
      };
    }
    async start() {
      this.running = true;
      this.toolbar.register({
        id: TOOLBAR_ID2,
        icon: ICONS.radar,
        label: () => t("toolbarTargetBoard"),
        onClick: () => this.toggle(),
        isAvailable: () => this.api.isConfigured
      });
      this.cli.register("targets", () => this.toggle());
    }
    stop() {
      this.running = false;
      this.close();
      this.toolbar.unregister(TOOLBAR_ID2);
      delete this.cli.commands.targets;
      if (this._panel) this._panel.remove();
      this._panel = null;
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return "/st plugin enable target-board";
      if (!this.api.isConfigured) return t("targetBoardNoServer");
      return t(this.isOpen() ? "targetBoardStatusOpen" : "targetBoardStatusClosed");
    }
    isOpen() {
      return !!this._panel && this._panel.style.display !== "none";
    }
    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    }
    open() {
      if (!this.api.isConfigured) {
        chatMessage(`[ST] ${t("targetBoardNoServer")}`);
        return;
      }
      this._ensurePanel();
      this._targets = null;
      this._error = false;
      this._render();
      this._panel.style.display = "block";
      document.addEventListener("keydown", this._onKeyDown);
      this._load();
      this._timer = setInterval(() => this._load(), REFRESH_INTERVAL_MS2);
    }
    close() {
      document.removeEventListener("keydown", this._onKeyDown);
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      if (this._panel) this._panel.style.display = "none";
    }
    async _load() {
      if (this._loading) return;
      const worldId3 = currentWorldId2();
      if (worldId3 === null) return;
      this._loading = true;
      let data = null;
      try {
        data = await this.api.request("GET", `/api/target-watch/${worldId3}`);
      } finally {
        this._loading = false;
      }
      if (!this.isOpen()) return;
      if (data && Array.isArray(data.targets)) {
        this._targets = data.targets;
        this._updatedAt = /* @__PURE__ */ new Date();
        this._error = false;
      } else {
        this._error = true;
      }
      this._render();
    }
    _render() {
      const rows = this._targets ? sortTargets(this._targets) : null;
      this._title.innerHTML = renderTitle(rows, this._updatedAt, this._error);
      if (!rows) {
        this._content.innerHTML = `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t(this._error ? "targetBoardFailed" : "targetBoardLoading"))}</div>`;
        return;
      }
      this._content.innerHTML = renderTable(rows, Date.now());
      this._content.querySelectorAll("tr[data-x]").forEach((tr2) => {
        tr2.addEventListener("click", () => centerMap(Number(tr2.dataset.x), Number(tr2.dataset.y)));
      });
    }
    _ensurePanel() {
      if (this._panel && document.body.contains(this._panel)) return;
      const pos = clampPosition(
        loadPosition(this.config, "TargetBoard", DEFAULT_POSITION2),
        { w: PANEL_WIDTH, h: 40 },
        { w: window.innerWidth, h: window.innerHeight }
      );
      const panel = document.createElement("div");
      panel.id = PANEL_ID6;
      panel.style.cssText = `
            display: none;
            position: fixed;
            left: ${pos.x}px;
            top: ${pos.y}px;
            z-index: 10000;
            width: ${PANEL_WIDTH}px;
            max-width: calc(100vw - 16px);
            box-sizing: border-box;
            background: rgba(20, 20, 20, 0.92);
            color: #ddd;
            border: 1px solid #444;
            border-radius: 4px;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            font-size: 12px;
            pointer-events: auto;
        `;
      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:baseline;gap:8px;padding:8px 10px 6px;cursor:move;user-select:none;border-bottom:1px solid #333;";
      const title = document.createElement("div");
      title.style.cssText = "flex:1;min-width:0;";
      const close = document.createElement("div");
      close.textContent = "\u2715";
      close.title = t("close");
      close.style.cssText = "cursor:pointer;color:#999;font-size:14px;line-height:1;";
      close.addEventListener("mousedown", (e) => e.stopPropagation());
      close.addEventListener("click", () => this.close());
      close.addEventListener("mouseenter", () => {
        close.style.color = "#fff";
      });
      close.addEventListener("mouseleave", () => {
        close.style.color = "#999";
      });
      header.append(title, close);
      const content = document.createElement("div");
      content.style.cssText = "max-height:60vh;overflow-y:auto;padding:4px 10px 8px;";
      panel.append(header, content);
      document.body.appendChild(panel);
      makeDraggable(panel, header, { config: this.config, prefix: "TargetBoard" });
      this._panel = panel;
      this._title = title;
      this._content = content;
    }
  };
  function sortTargets(targets) {
    return targets.filter((tg) => tg && Array.isArray(tg.watchers) && tg.watchers.length).sort((a, b) => b.watchers.length - a.watchers.length || latest(b) - latest(a));
  }
  function latest(target) {
    return Math.max(...target.watchers.map((w) => toMs(w.timestamp)));
  }
  function toMs(ts) {
    const n = Number(ts) || 0;
    return n < 1e12 ? n * 1e3 : n;
  }
  function relativeTime(ms, now) {
    const min = Math.floor(Math.max(0, now - ms) / 6e4);
    if (min < 1) return t("targetBoardAgoNow");
    if (min < 60) return t("targetBoardAgoMin", { n: min });
    return t("targetBoardAgoHour", { n: Math.floor(min / 60) });
  }
  function renderTitle(rows, updatedAt, error) {
    let html = `<b style="color:#fff;">\u{1F3AF} Target Watch</b>`;
    if (rows) html += ` <span style="color:#aaa;">(${rows.length})</span>`;
    if (updatedAt) {
      const time = updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      html += ` <span style="color:#777;font-size:11px;">\xB7 ${escapeHtml(t("targetBoardUpdated", { time }))}</span>`;
    }
    if (error && rows) html += ` <span style="color:#e57373;font-size:11px;">\xB7 ${escapeHtml(t("targetBoardRefreshFailed"))}</span>`;
    return html;
  }
  function renderTable(rows, now) {
    if (!rows.length) {
      return `<div style="color:#999;padding:12px 0;text-align:center;">${escapeHtml(t("targetBoardEmpty"))}</div>`;
    }
    const th = "padding:3px 4px;text-align:left;font-weight:normal;color:#999;border-bottom:1px solid #444;";
    const td = "padding:3px 4px;vertical-align:top;";
    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += `<tr><th style="${th}">${escapeHtml(t("targetBoardColTarget"))}</th><th style="${th}">${escapeHtml(t("targetBoardColLevel"))}</th><th style="${th}">${escapeHtml(t("targetBoardColWatchers"))}</th><th style="${th}white-space:nowrap;">${escapeHtml(t("targetBoardColSeen"))}</th></tr>`;
    for (const tg of rows) {
      const double = tg.watchers.length >= DOUBLE_WATCHERS;
      const rowStyle = double ? "background:#3a2e14;box-shadow:inset 3px 0 0 #ff9800;" : "box-shadow:inset 3px 0 0 #555;";
      const x = Number(tg.targetX);
      const y = Number(tg.targetY);
      const names2 = tg.watchers.map((w) => escapeHtml(w.playerName || "?")).join(", ");
      html += `<tr data-x="${x}" data-y="${y}" title="${escapeHtml(t("targetBoardCenterHint"))}" style="${rowStyle}cursor:pointer;border-bottom:1px solid #2a2a2a;"><td style="${td}padding-left:8px;"><div style="color:#e0e0e0;">${escapeHtml(tg.targetName || "?")}</div><div style="color:#4fc3f7;">${x}:${y}</div></td><td style="${td}white-space:nowrap;">L${formatLevel(tg.targetLevel)}</td><td style="${td}"><span style="color:${double ? "#ffb74d" : "#aaa"};font-weight:${double ? "bold" : "normal"};">${tg.watchers.length}</span> \xB7 ${names2}</td><td style="${td}white-space:nowrap;color:#888;">${escapeHtml(relativeTime(latest(tg), now))}</td></tr>`;
    }
    return html + "</table>";
  }
  function currentWorldId2() {
    try {
      return Number(ClientLib.Data.MainData.GetInstance().get_Server().get_WorldId());
    } catch {
      return null;
    }
  }
  function centerMap(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
      const vis = ClientLib.Vis.VisMain.GetInstance();
      if (vis.get_Mode() !== ClientLib.Vis.Mode.Region) {
        qx.core.Init.getApplication().getPlayArea().setView(ClientLib.Data.PlayerAreaViewMode.pavmNone, -1, 0, 0);
      }
      vis.CenterGridPosition(x, y);
    } catch (e) {
      console.warn("[ST] TargetBoard: centre map failed", e && e.message);
    }
  }

  // plugins/stabs-stats.js
  var RES = { TIB: 1, CRY: 2, CREDITS: 3, RP: 6, RC_BASE: 7, RC_AIR: 8, RC_INF: 9, RC_VEH: 10 };
  var RES_KEYS = Object.values(RES);
  var DECAYING = /* @__PURE__ */ new Set([RES.TIB, RES.CRY, RES.CREDITS, RES.RP]);
  var ENEMY_KEYS = [
    "overall",
    "structure",
    "cy",
    "cc",
    "barracks",
    "factory",
    "airport",
    "df",
    "dhq",
    "support",
    "defense",
    "defenseArmored",
    "defenseNonArmored"
  ];
  var OFFENSE_KEYS = ["overall", "infantry", "vehicle", "aircraft"];
  var FRONT_KEYS = ["cy", "cc", "barracks", "factory", "airport", "df", "dhq", "support"];
  function emptyHp() {
    return { max: 0, start: 0, end: 0, rep: 0, maxFront: 0, startFront: 0, endFront: 0 };
  }
  function emptyRes() {
    const r = {};
    for (const k of RES_KEYS) r[k] = 0;
    return r;
  }
  function emptyEntity() {
    return { hp: emptyHp(), res: emptyRes() };
  }
  function emptyStats() {
    const stats = { battleDuration: 0, enemy: {}, offense: {} };
    for (const k of ENEMY_KEYS) stats.enemy[k] = emptyEntity();
    for (const k of OFFENSE_KEYS) stats.offense[k] = emptyEntity();
    return stats;
  }
  function add(entity, hp, res) {
    for (const k of ["max", "start", "end", "rep"]) entity.hp[k] += hp[k];
    for (const k of RES_KEYS) entity.res[k] += res[k];
  }
  function addFront(entity, hp) {
    entity.hp.maxFront += hp.max;
    entity.hp.startFront += hp.start;
    entity.hp.endFront += hp.end;
  }
  function battleDuration(cs, md) {
    return cs * 100 + (cs < md * 10 ? 3e3 : 0);
  }
  function repairCost(getCosts, hp, attackCounter = 0) {
    const res = emptyRes();
    let ratio;
    if (hp.start !== hp.end) {
      ratio = (hp.start - hp.end) / hp.max;
      const costs = getCosts(ratio);
      for (const c of costs || []) {
        if (!(c.Type in res)) continue;
        res[c.Type] = DECAYING.has(c.Type) ? c.Count * Math.pow(0.7, attackCounter) : c.Count;
      }
    }
    if (res[RES.RP] > 0) res[RES.RP] = Math.max(1, Math.floor(res[RES.RP] * ratio));
    return res;
  }
  function computeStats(data, env) {
    const { E } = env;
    const d = data.d;
    const stats = emptyStats();
    const enemy = stats.enemy;
    const offense = stats.offense;
    const sim = {};
    for (const e of data.e) sim[e.Key] = e.Value;
    const playerBase = d.df === E.GDI || d.df === E.NOD;
    const info = env.buildingInfo;
    const hasInfo = info.cy !== void 0;
    const costsFor = (unit, u) => (ratio) => env.repairCosts(unit, u.i, u.l, ratio);
    stats.battleDuration = battleDuration(d.cs, d.md);
    let efficiency = 0;
    let dfLevel = 1;
    for (const b of d.s) {
      const unit = env.unit(b.i);
      const hp = emptyHp();
      if (playerBase) {
        hp.max = sim[b.ci].mh;
        hp.start = sim[b.ci].h;
      } else {
        hp.max = Math.max(env.maxHealth(b.l, unit, false, d.dm), b.h * 16);
        hp.start = b.h * 16;
      }
      hp.end = sim[b.ci].h;
      const res = repairCost(costsFor(unit, b), hp);
      add(enemy.overall, hp, res);
      add(enemy.structure, hp, res);
      const kind = buildingKind(env.techName(unit), E.tech);
      if (kind) add(enemy[kind], hp, res);
      if (kind === "df") {
        efficiency = 0.7 * (hp.end / hp.max);
        dfLevel = b.l;
      }
      if (hasInfo) {
        for (const k of FRONT_KEYS) {
          const pos = info[k];
          if (pos && pos.x === b.x && pos.y < b.y) addFront(enemy[k], hp);
        }
      }
    }
    for (const u of d.d) {
      const unit = env.unit(u.i);
      const hp = emptyHp();
      hp.max = Math.max(env.maxHealth(u.l, unit, playerBase, d.dm), u.h * 16);
      hp.start = u.h * 16;
      hp.end = sim[u.ci].h;
      hp.rep = (u.h * 16 - sim[u.ci].h) * efficiency * dfLevel / Math.max(dfLevel, u.l);
      const res = repairCost(costsFor(unit, u), hp, u.ac);
      add(enemy.overall, hp, res);
      add(enemy.defense, hp, res);
      add(unit.ptt === E.ArmorNone ? enemy.defenseNonArmored : enemy.defenseArmored, hp, res);
      if (hasInfo && unit.mt === E.Structure) {
        for (const k of FRONT_KEYS) {
          const pos = info[k];
          if (pos && pos.x === u.x) addFront(enemy[k], hp);
        }
      }
    }
    env.asAttacker(() => {
      for (const u of d.a) {
        const unit = env.unit(u.i);
        const hp = emptyHp();
        hp.max = Math.max(env.maxHealth(u.l, unit, false, d.am), u.h * 16);
        hp.start = u.h * 16;
        hp.end = sim[u.ci] !== void 0 ? sim[u.ci].h : u.h * 16;
        const res = repairCost(costsFor(unit, u), hp);
        add(offense.overall, hp, res);
        const group = offenseGroup(unit.mt, E);
        if (group) add(offense[group], hp, res);
      }
    });
    return stats;
  }
  function buildingKind(techName2, tech) {
    if (techName2 === tech.cy) return "cy";
    if (techName2 === tech.cc) return "cc";
    if (techName2 === tech.barracks) return "barracks";
    if (techName2 === tech.factory) return "factory";
    if (techName2 === tech.airport) return "airport";
    if (techName2 === tech.df) return "df";
    if (techName2 === tech.dhq) return "dhq";
    if (tech.support.includes(techName2)) return "support";
    return null;
  }
  function offenseGroup(mt, E) {
    if (mt === E.Feet) return "infantry";
    if (mt === E.Wheel || mt === E.Track) return "vehicle";
    if (mt === E.Air || mt === E.Air2) return "aircraft";
    return null;
  }
  function formationKey(units, ownId) {
    const parts = units.filter((u) => u.enabled && u.h > 0).map((u) => [u.x, u.y, u.i, u.l]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]).map((p) => p.join(","));
    return `${ownId}|${parts.join(";")}`;
  }
  function mergeFormation(formation, attackers) {
    for (const f of formation) {
      for (const a of attackers) {
        if (f.gs === a.gs && f.i === a.i && f.l === a.l && f.x === a.x && f.y === a.y) Object.assign(f, a);
      }
    }
    return formation;
  }
  var SimCache = class {
    constructor() {
      this.cities = {};
    }
    city(targetId) {
      if (!this.cities[targetId]) this.cities[targetId] = { data: {}, entries: {} };
      return this.cities[targetId];
    }
    /**
     * Re-validate against the current game state, then the valid entry for `key`.
     * @param {object} state — { version: target version (-1 unknown), own: null | { version, recovery, poi: {air, inf, veh} | null } }
     */
    check(targetId, key, state) {
      this._validate(targetId, key, state);
      return this.get(targetId, key);
    }
    get(targetId, key) {
      const entry = this.city(targetId).entries[key];
      return entry && entry.valid ? entry : null;
    }
    add(targetId, key, entry) {
      this.city(targetId).entries[key] = { ...entry, valid: true };
    }
    /** Entries for the target, valid or not (the panel's count). */
    count(targetId) {
      const c = this.cities[targetId];
      return c ? Object.keys(c.entries).length : 0;
    }
    clear(targetId) {
      delete this.cities[targetId];
    }
    /** All entries for the target, valid or not. */
    entries(targetId) {
      const c = this.cities[targetId];
      return c ? Object.entries(c.entries).map(([key, entry]) => ({ key, entry })) : [];
    }
    /** The preset column's pick: see bestEntry. */
    best(targetId, criteria) {
      return bestEntry(this.entries(targetId), criteria);
    }
    _validate(targetId, key, state) {
      const c = this.city(targetId);
      const invalidateAll = () => {
        for (const k in c.entries) c.entries[k].valid = false;
      };
      if (state.version !== -1 && c.data.version !== state.version) {
        c.data.version = state.version;
        invalidateAll();
      }
      const own = state.own;
      if (!own || own.version === -1) return;
      const entry = c.entries[key];
      if (entry && entry.recovery !== own.recovery) entry.valid = false;
      const poi = own.poi;
      if (poi && own.recovery === false && (c.data.air !== poi.air || c.data.inf !== poi.inf || c.data.veh !== poi.veh)) {
        c.data.air = poi.air;
        c.data.inf = poi.inf;
        c.data.veh = poi.veh;
        if (state.version !== -1) c.data.version = state.version;
        invalidateAll();
      }
    }
  };
  var MAX_DURATION_MS = 12e4;
  function hpWithFront(hp) {
    return Math.min(Math.max(hp.end + hp.endFront, 0), hp.max + hp.maxFront);
  }
  var CRITERIA = {
    /** Enemy group (cy, overall, …) left standing, its front included. */
    enemyLeft: (group) => (s) => hpWithFront(s.enemy[group].hp),
    /** The slowest of the three offense repair times. */
    offenseRepair: (s) => {
      const r = s.offense.overall.res;
      return Math.max(r[RES.RC_AIR], r[RES.RC_INF], r[RES.RC_VEH]);
    },
    /** Own units left - more is better, hence negative. */
    offenseLost: (s) => -hpWithFront(s.offense.overall.hp),
    duration: (s) => Math.min(Math.max(s.battleDuration, 0), MAX_DURATION_MS)
  };
  var PRESETS = {
    live: { id: "live", name: "live", criteria: null },
    cy: {
      id: "cy",
      name: "CY",
      criteria: [
        CRITERIA.enemyLeft("cy"),
        CRITERIA.enemyLeft("overall"),
        CRITERIA.offenseRepair,
        CRITERIA.offenseLost,
        CRITERIA.duration
      ]
    }
  };
  function compareByCriteria(a, b, criteria) {
    for (const c of criteria) {
      const d = c(a) - c(b);
      if (d) return d;
    }
    return 0;
  }
  function bestEntry(list, criteria) {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => compareByCriteria(a.entry.stats, b.entry.stats, criteria));
    return sorted.find((x) => x.entry.valid) || sorted[0];
  }
  function formatPercent(part, whole) {
    const percent = part / whole * 100;
    const digits = percent <= 0 || percent >= 100 ? 0 : percent >= 10 ? 1 : 2;
    const rounded = Math.round(percent * Math.pow(10, digits)) / Math.pow(10, digits);
    return `${rounded.toFixed(digits)} %`;
  }
  function colorFromRatio(value) {
    if (!Number.isFinite(value)) return null;
    const hue = 120 * (1 - value);
    const light = 25 + Math.round((Math.max(value - 0.4, 0) * 2 + Math.max(0.4 - value, 0)) * 25);
    return `hsl(${hue}, 100%, ${light}%)`;
  }
  function battleOutcome(stats) {
    if (stats.offense.overall.hp.end <= 0) return "total-defeat";
    if (stats.enemy.overall.hp.end <= 0) return "total-victory";
    return "victory";
  }
  var ENEMY_ROWS = ["overall", "defense", "structure", "cy", "df", "cc", "barracks", "factory", "airport", "support"];
  var ALWAYS_SHOWN = /* @__PURE__ */ new Set(["overall", "structure", "cy"]);
  var REPAIR_ROWS = ["storage", "overall", "crystal", "infantry", "vehicle", "aircraft"];
  var LOOT_ROWS = ["tiberium", "crystal", "credits", "research", "total"];
  var LOOT_TYPES2 = {
    tiberium: [RES.TIB],
    crystal: [RES.CRY],
    credits: [RES.CREDITS],
    research: [RES.RP],
    total: [RES.TIB, RES.CRY, RES.CREDITS, RES.RP]
  };
  var EMPTY = { text: "-", color: null };
  function visibleEnemyRows(liveStats) {
    return ENEMY_ROWS.filter((k) => ALWAYS_SHOWN.has(k) || liveStats && liveStats.enemy[k].hp.max > 0);
  }
  function hpCell(entity) {
    const hp = entity && entity.hp;
    if (!hp || hp.max <= 0) return EMPTY;
    return { text: formatPercent(hp.end, hp.max), color: colorFromRatio(hp.end / hp.max) };
  }
  function repairCell(entity, seconds, fmt5) {
    const hp = entity && entity.hp;
    if (!hp || hp.max <= 0) return EMPTY;
    return { text: fmt5.time(seconds), color: colorFromRatio(1 - hp.end / hp.max) };
  }
  function lootCell(stats, loot, types, fmt5) {
    if (!stats || stats.enemy.overall.hp.max <= 0 || !loot) return EMPTY;
    const got = types.reduce((s, k) => s + stats.enemy.overall.res[k], 0);
    const all = types.reduce((s, k) => s + (loot[k] || 0), 0);
    return { text: fmt5.number(got), color: colorFromRatio(1 - got / all) };
  }
  function columnCells(view, fmt5) {
    const s = view && view.stats;
    const e = s ? s.enemy : null;
    const o = s ? s.offense : null;
    const rc = o ? o.overall.res : null;
    const battle = {
      outcome: s ? battleOutcome(s) : null,
      duration: { text: s && s.battleDuration > 0 ? fmt5.time(s.battleDuration / 1e3) : "-:--", color: null },
      base: { text: view && view.base ? view.base : "-", color: null },
      morale: view && view.morale ? {
        text: view.morale.text,
        color: view.morale.level === 2 ? "#ff4d4d" : view.morale.level === 1 ? "#ff9a3c" : null
      } : EMPTY
    };
    const enemy = {};
    for (const k of ENEMY_ROWS) enemy[k] = hpCell(e && e[k]);
    const has = o && o.overall.hp.max > 0;
    const repair = {
      storage: { text: view && view.storage !== null && view.storage !== void 0 ? fmt5.time(view.storage) : "-", color: null },
      // the slowest repair type: TABS' "repair points" row, the bottleneck, glows
      overall: { ...repairCell(o && o.overall, rc ? Math.max(rc[RES.RC_BASE], rc[RES.RC_AIR], rc[RES.RC_INF], rc[RES.RC_VEH]) : 0, fmt5), glow: true },
      crystal: has ? { text: fmt5.number(rc[RES.CRY]), color: colorFromRatio(1) } : EMPTY,
      infantry: repairCell(o && o.infantry, rc ? rc[RES.RC_INF] : 0, fmt5),
      vehicle: repairCell(o && o.vehicle, rc ? rc[RES.RC_VEH] : 0, fmt5),
      aircraft: repairCell(o && o.aircraft, rc ? rc[RES.RC_AIR] : 0, fmt5)
    };
    const loot = {};
    for (const k of LOOT_ROWS) loot[k] = lootCell(s, view && view.loot, LOOT_TYPES2[k], fmt5);
    return { battle, enemy, repair, loot };
  }

  // plugins/stabs-window.js
  var IMG = {
    stats: "FactionUI/icons/icn_build_slots.png",
    simulate: "FactionUI/icons/icon_attack_simulate_combat.png",
    play: "webfrontend/theme/arrows/right.png",
    back: "FactionUI/icons/icon_return.png",
    "total-defeat": "FactionUI/icons/icon_reports_total_defeat.png",
    victory: "FactionUI/icons/icon_reports_victory.png",
    "total-victory": "FactionUI/icons/icon_reports_total_victory.png",
    enemyAll: "FactionUI/icons/icon_arsnl_show_all.png",
    enemyBase: "FactionUI/icons/icon_arsnl_base_buildings.png",
    enemyDefense: "FactionUI/icons/icon_def_army_points.png",
    infantry: "FactionUI/icons/icon_arsnl_off_squad.png",
    vehicle: "FactionUI/icons/icon_arsnl_off_vehicle.png",
    aircraft: "FactionUI/icons/icon_arsnl_off_plane.png",
    rcBase: "webfrontend/ui/icons/icn_repair_points.png",
    rcOffense: "webfrontend/ui/icons/icn_repair_off_points.png",
    rcInf: "webfrontend/ui/icons/icon_res_repair_inf.png",
    rcVeh: "webfrontend/ui/icons/icon_res_repair_tnk.png",
    rcAir: "webfrontend/ui/icons/icon_res_repair_air.png",
    tiberium: "webfrontend/ui/common/icn_res_tiberium.png",
    crystal: "webfrontend/ui/common/icn_res_chrystal.png",
    credits: "webfrontend/ui/common/icn_res_dollar.png",
    research: "webfrontend/ui/common/icn_res_research_mission.png",
    transfer: "FactionUI/icons/icon_transfer_resource.png"
  };
  var WIDTH = 201;
  var ROW_HEIGHT = 18;
  var LABEL_COLUMN = 29;
  var DIM_OPACITY = 0.7;
  var SECTIONS = ["enemy", "repair", "loot"];
  function gameText(id, fallback) {
    try {
      const s = String(qx.locale.Manager.tr(id));
      return s && s !== id ? s.replace(/:\s*$/, "") : fallback;
    } catch {
      return fallback;
    }
  }
  function techName(name, fallback) {
    try {
      const tech = ClientLib.Base.Tech;
      return tech.GetTechDisplayNameFromTechId(tech.GetTechIdFromTechNameAndFaction(name, ClientLib.Base.EFactionType.GDIFaction)) || fallback;
    } catch {
      return fallback;
    }
  }
  function rowLabel(text, icon, tip) {
    const atom = new qx.ui.basic.Atom(icon ? null : text, icon || null).set({
      alignX: "center",
      alignY: "middle",
      gap: 0,
      iconPosition: "top",
      minHeight: ROW_HEIGHT,
      show: icon ? "icon" : "label",
      toolTipText: tip || text
    });
    if (icon) {
      atom.setToolTipIcon(icon);
      atom.getChildControl("icon").set({ width: 18, height: 18, scale: true, alignY: "middle" });
    }
    return atom;
  }
  function valueLabel(align) {
    return new qx.ui.basic.Label("-").set({ alignX: align, alignY: "middle", minHeight: ROW_HEIGHT });
  }
  function iconButton(icon, tip, onClick) {
    const btn = new qx.ui.form.Button(null, icon).set({
      maxHeight: 22,
      minWidth: 22,
      toolTipText: tip,
      show: "icon",
      iconPosition: "top",
      appearance: "button-addpoints"
    });
    btn.getChildControl("icon").set({ maxWidth: 16, maxHeight: 16, scale: true });
    btn.addListener("click", onClick);
    return btn;
  }
  var StatsWindow = class {
    /**
     * @param {object} opts
     * @param {object} opts.config
     * @param {Array<{id, name, description}>} opts.presets — the columns
     * @param {() => void} opts.onUserClose
     * @param {(columnId) => void} opts.onSimulate — load the column's formation and simulate
     * @param {(columnId) => void} opts.onReplay
     * @param {(columnId) => void} opts.onLoad — double click: load the column's formation
     * @param {() => void} opts.onReset
     */
    constructor(opts) {
      this.opts = opts;
      this.win = null;
      this.rows = {};
      this.columns = [];
      this.sections = {};
    }
    isOpen() {
      return !!this.win && this.win.isVisible();
    }
    open() {
      this._ensure();
      if (!this.win.isVisible()) this.win.open();
    }
    close() {
      if (this.win && this.win.isVisible()) this.win.close();
    }
    dispose() {
      if (!this.win) return;
      try {
        this.win.close();
        this.win.destroy();
      } catch {
      }
      this.win = null;
      this.columns = [];
      this.rows = {};
      this.sections = {};
    }
    _ensure() {
      if (this.win) return;
      const { config, presets } = this.opts;
      const win = new qx.ui.window.Window(t("stabsTitle"), IMG.stats).set({
        layout: new qx.ui.layout.VBox(),
        contentPadding: 4,
        contentPaddingTop: 0,
        contentPaddingBottom: 3,
        width: WIDTH,
        allowMaximize: false,
        showMaximize: false,
        allowMinimize: false,
        showMinimize: false,
        resizable: false
      });
      win.getChildControl("icon").set({ width: 20, height: 20, scale: true, alignY: "middle" });
      const x = Number(config.get("stabs.panel.x"));
      const y = Number(config.get("stabs.panel.y"));
      win.moveTo(Number.isFinite(x) ? x : 124, Number.isFinite(y) ? y : 31);
      win.addListener("move", () => {
        const b = win.getBounds();
        if (b) {
          config.set("stabs.panel.x", b.left);
          config.set("stabs.panel.y", b.top);
        }
      });
      win.getChildControl("close-button").addListener("execute", () => this.opts.onUserClose());
      this.columns = presets.map(() => ({ boxes: [], cells: {}, outcome: null }));
      win.add(this._section("battle", null, [
        ["preset", rowLabel("P", null, t("stabsPreset"))],
        ["outcome", rowLabel("O", null, gameText("tnf:combat report", t("stabsOutcome")))],
        ["duration", rowLabel("D", null, t("stabsDuration"))],
        ["base", rowLabel("B", null, gameText("tnf:base", t("stabsBase")))],
        ["morale", rowLabel("M", null, t("stabsMorale"))]
      ]));
      const T = ClientLib.Base.ETechName;
      const enemyLabels = {
        overall: rowLabel(null, IMG.enemyAll, gameText("tnf:total", t("stabsTotal"))),
        defense: rowLabel(null, IMG.enemyDefense, gameText("tnf:defense", t("stabsDefense"))),
        structure: rowLabel(null, IMG.enemyBase, gameText("tnf:base", t("stabsStructure"))),
        cy: rowLabel("CY", null, techName(T.Construction_Yard, "CY")),
        df: rowLabel("DF", null, techName(T.Defense_Facility, "DF")),
        cc: rowLabel("CC", null, techName(T.Command_Center, "CC")),
        barracks: rowLabel("B", IMG.infantry, techName(T.Barracks, "B")),
        factory: rowLabel("F", IMG.vehicle, techName(T.Factory, "F")),
        airport: rowLabel("A", IMG.aircraft, techName(T.Airport, "A")),
        support: rowLabel("S", null, gameText("tnf:support", t("stabsSupport")))
      };
      this._header(win, "enemy", gameText("tnf:combat target", t("stabsEnemy")));
      win.add(this._section("enemy", true, ENEMY_ROWS.map((k) => [k, enemyLabels[k]])));
      const repairLabels = {
        storage: rowLabel(null, IMG.rcBase, gameText("tnf:offense repair time", t("stabsRepairStorage"))),
        overall: rowLabel(null, IMG.rcOffense, gameText("tnf:repair points", t("stabsRepairPoints"))),
        crystal: rowLabel(null, IMG.crystal, gameText("tnf:crystals", t("stabsCrystal"))),
        infantry: rowLabel(null, IMG.rcInf, gameText("tnf:infantry repair title", t("stabsRepairInf"))),
        vehicle: rowLabel(null, IMG.rcVeh, gameText("tnf:vehicle repair title", t("stabsRepairVeh"))),
        aircraft: rowLabel(null, IMG.rcAir, gameText("tnf:aircraft repair title", t("stabsRepairAir")))
      };
      this._header(win, "repair", gameText("tnf:own repair cost", t("stabsRepair")));
      win.add(this._section("repair", true, REPAIR_ROWS.map((k) => [k, repairLabels[k]])));
      const lootLabels = {
        tiberium: rowLabel(null, IMG.tiberium, gameText("tnf:tiberium", t("stabsTiberium"))),
        crystal: rowLabel(null, IMG.crystal, gameText("tnf:crystals", t("stabsCrystal"))),
        credits: rowLabel(null, IMG.credits, gameText("tnf:credits", t("stabsCredits"))),
        research: rowLabel(null, IMG.research, gameText("tnf:research points", t("stabsResearch"))),
        total: rowLabel(null, IMG.transfer, t("stabsLootTotal"))
      };
      this._header(win, "loot", gameText("tnf:lootable resources:", t("stabsLoot")));
      win.add(this._section("loot", true, LOOT_ROWS.map((k) => [k, lootLabels[k]])));
      win.add(this._buttons());
      win.setShowStatusbar(true);
      const bar = win.getChildControl("statusbar").set({ paddingBottom: 6, paddingTop: 4 });
      win.add(bar);
      win.getChildControl("statusbar-text").set({ textColor: "#BBBBBB" });
      bar.add(new qx.ui.core.Spacer(), { flex: 1 });
      const reset = new qx.ui.basic.Label(t("stabsReset")).set({ textColor: "#115274" });
      reset.getContentElement().setStyle("text-decoration", "underline");
      reset.addListener("click", () => this.opts.onReset());
      bar.add(reset);
      for (const key of SECTIONS) {
        if (config.get(`stabs.section.${key}`, true) === false) this.sections[key].exclude();
      }
      this.win = win;
    }
    /** Section header over the section box; a click folds the section. */
    _header(win, key, text) {
      const header = new qx.ui.container.Composite(new qx.ui.layout.Grow()).set({ alignX: "center", alignY: "middle", zIndex: 11 });
      header.add(new qx.ui.container.Composite(new qx.ui.layout.VBox(5)).set({
        decorator: "pane-light-opaque",
        allowGrowX: true,
        allowGrowY: true
      }));
      header.add(new qx.ui.basic.Label(text).set({
        paddingLeft: 9,
        paddingBottom: 2,
        allowGrowX: true,
        allowGrowY: true,
        font: "font_size_13_bold_shadow"
      }));
      header.addListener("click", () => {
        const section = this.sections[key];
        const open = !section.isVisible();
        if (open) section.show();
        else section.exclude();
        this.opts.config.set(`stabs.section.${key}`, open);
      });
      win.add(header);
    }
    /**
     * A row of boxes: the label column, then one box per preset column.
     * @param {Array<[key, labelWidget]>} rows
     */
    _section(key, underHeader, rows) {
      const section = new qx.ui.container.Composite(new qx.ui.layout.HBox(-2)).set({
        decorator: "pane-light-plain",
        allowGrowX: true,
        marginTop: underHeader ? -18 : 0
      });
      const labels = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
        width: LABEL_COLUMN,
        padding: 9,
        marginTop: underHeader ? 10 : 0,
        allowGrowX: true
      });
      this.rows[key] = {};
      for (const [rowKey, label] of rows) {
        labels.add(label);
        this.rows[key][rowKey] = [label];
      }
      section.add(labels, { flex: 0 });
      this.opts.presets.forEach((preset, i) => {
        const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({
          allowGrowX: true,
          marginTop: underHeader ? 10 : 0,
          decorator: "pane-light-opaque"
        });
        const col = this.columns[i];
        col.cells[key] = {};
        for (const [rowKey] of rows) {
          let cell;
          if (key === "battle" && rowKey === "preset") {
            cell = valueLabel("center").set({ value: preset.name, toolTipText: preset.description });
          } else if (key === "battle" && rowKey === "outcome") {
            cell = new qx.ui.basic.Atom("-", null).set({ alignX: "center", alignY: "middle", gap: 0, iconPosition: "top", minHeight: ROW_HEIGHT, show: "label" });
            cell.getChildControl("icon").set({ width: 18, height: 18, scale: true, alignY: "middle" });
          } else {
            cell = valueLabel(key === "battle" ? "center" : "right");
          }
          if (key === "repair" && rowKey === "overall") cell.getContentElement().setStyle("text-shadow", "0 0 3pt");
          box.add(cell, { flex: 1 });
          col.cells[key][rowKey] = cell;
          this.rows[key][rowKey].push(cell);
        }
        box.addListener("dblclick", () => this.opts.onLoad(preset.id));
        col.boxes.push(box);
        section.add(box, { flex: 1 });
      });
      this.sections[key] = section;
      return section;
    }
    _buttons() {
      const section = new qx.ui.container.Composite(new qx.ui.layout.HBox(-2)).set({ decorator: "pane-light-plain", allowGrowX: true });
      const labels = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ width: LABEL_COLUMN, padding: 9, allowGrowX: true });
      labels.add(rowLabel(null, IMG.simulate, t("stabsViewSimulation")).set({ marginTop: 1, marginBottom: 5 }));
      section.add(labels, { flex: 0 });
      this.opts.presets.forEach((preset, i) => {
        const box = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ allowGrowX: true, decorator: "pane-light-opaque" });
        const pair = new qx.ui.container.Composite(new qx.ui.layout.HBox()).set({ allowGrowX: true });
        pair.add(iconButton(IMG.simulate, t("stabsLoadSimulate"), () => this.opts.onSimulate(preset.id)));
        pair.add(iconButton(IMG.play, t("stabsViewSimulation"), () => this.opts.onReplay(preset.id)));
        box.add(pair, { flex: 1 });
        this.columns[i].boxes.push(box);
        section.add(box, { flex: 1 });
      });
      return section;
    }
    /**
     * Fill the window.
     * @param {object} s
     * @param {Array<{cells, dim}>} s.columns — per preset, cells from columnCells()
     * @param {string[]} s.enemyRows — Defender rows to show
     * @param {boolean} s.moraleVisible
     * @param {number} s.cacheCount
     * @param {object} s.outcomeTitles — outcome key -> tooltip
     */
    update(s) {
      if (!this.win) return;
      s.columns.forEach(({ cells, dim }, i) => {
        const col = this.columns[i];
        if (!col) return;
        for (const section of ["enemy", "repair", "loot"]) {
          for (const [k, cell] of Object.entries(cells[section])) setCell(col.cells[section][k], cell);
        }
        for (const k of ["duration", "base", "morale"]) setCell(col.cells.battle[k], cells.battle[k]);
        const outcome = col.cells.battle.outcome;
        if (cells.battle.outcome) {
          outcome.set({ icon: IMG[cells.battle.outcome], toolTipIcon: IMG[cells.battle.outcome], toolTipText: s.outcomeTitles[cells.battle.outcome], show: "icon" });
        } else {
          outcome.set({ show: "label" });
          outcome.resetIcon();
          outcome.resetToolTipText();
        }
        for (const box of col.boxes) {
          box.setDecorator(dim ? "pane-light-plain" : "pane-light-opaque");
          box.setOpacity(dim ? DIM_OPACITY : 1);
        }
      });
      const shown = new Set(s.enemyRows);
      for (const k of ENEMY_ROWS) for (const w of this.rows.enemy[k]) w.setVisibility(shown.has(k) ? "visible" : "excluded");
      for (const w of this.rows.battle.morale) w.setVisibility(s.moraleVisible ? "visible" : "excluded");
      this.win.setStatus(t("stabsCacheCount", { n: s.cacheCount }));
    }
  };
  function setCell(widget, cell) {
    if (!widget || !cell) return;
    if (widget.getValue() !== cell.text) widget.setValue(cell.text);
    if (cell.color) widget.setTextColor(cell.color);
    else widget.resetTextColor();
  }

  // plugins/stabs.js
  var TOOLBAR_ID3 = "stabs";
  var SIM_LOCK_MS = 3e3;
  var TICK_MS2 = 300;
  var KEY_NUM0 = 96;
  var KEY_NUM7 = 103;
  function tabsLoaded(win = window) {
    try {
      if (typeof win.TABS !== "undefined") return true;
      return !!(win.qx && win.qx.Class && win.qx.Class.getByName && win.qx.Class.getByName("TABS"));
    } catch {
      return false;
    }
  }
  function mainData() {
    return ClientLib.Data.MainData.GetInstance();
  }
  function cities() {
    return mainData().get_Cities();
  }
  function viewMode() {
    try {
      return ClientLib.Vis.VisMain.GetInstance().get_Mode();
    } catch {
      return null;
    }
  }
  function inReplay() {
    try {
      return qx.core.Init.getApplication().getPlayArea().getViewMode() === ClientLib.Data.PlayerAreaViewMode.pavmCombatReplay;
    } catch {
      return false;
    }
  }
  function targetReady() {
    try {
      const city = cities().get_CurrentCity();
      return !!city && city.get_Version() >= 0 && ClientLib.Vis.VisMain.GetInstance().GetActiveView().get_VisAreaComplete();
    } catch {
      return false;
    }
  }
  function readFormation() {
    try {
      const c = cities();
      const own = c.get_CurrentOwnCity();
      if (!own) return null;
      const formation = own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(c.get_CurrentCityId());
      const units = formation && formation.get_ArmyUnits();
      if (!units) return null;
      return units.l.map((u) => {
        const carried = u.get_IsTransportedCityEntity();
        const carrying = u.get_TransportedCityEntity();
        return {
          id: u.get_Id(),
          gid: carried ? u.get_TransporterCityEntity().get_Id() : carrying !== null ? carrying.get_Id() : 0,
          gs: carried ? 2 : carrying !== null ? 1 : 0,
          i: u.get_MdbUnitId(),
          l: u.get_CurrentLevel(),
          h: Math.ceil(u.get_Health()),
          enabled: u.get_Enabled(),
          x: u.get_CoordX(),
          y: u.get_CoordY(),
          t: carried
        };
      });
    } catch {
      return null;
    }
  }
  function cacheState(targetId, ownId) {
    const c = cities();
    const target = c.GetCity(targetId);
    const own = c.GetCity(ownId);
    let poi = null;
    try {
      const alliance = mainData().get_Alliance();
      if (alliance) poi = { air: alliance.get_POIAirBonus(), inf: alliance.get_POIInfantryBonus(), veh: alliance.get_POIVehicleBonus() };
    } catch {
    }
    return {
      version: target ? target.get_Version() : -1,
      own: own ? { version: own.get_Version(), recovery: own.get_hasRecovery(), poi } : null
    };
  }
  function enums() {
    const B = ClientLib.Base;
    const T = B.ETechName;
    return {
      GDI: B.EFactionType.GDIFaction,
      NOD: B.EFactionType.NODFaction,
      Offense: B.EPlacementType.Offense,
      Feet: B.EUnitMovementType.Feet,
      Wheel: B.EUnitMovementType.Wheel,
      Track: B.EUnitMovementType.Track,
      Air: B.EUnitMovementType.Air,
      Air2: B.EUnitMovementType.Air2,
      Structure: B.EUnitMovementType.Structure,
      ArmorNone: B.EArmorType.NONE,
      tech: {
        cy: T.Construction_Yard,
        cc: T.Command_Center,
        barracks: T.Barracks,
        factory: T.Factory,
        airport: T.Airport,
        df: T.Defense_Facility,
        dhq: T.Defense_HQ,
        support: [T.Support_Air, T.Support_Ion, T.Support_Art]
      }
    };
  }
  function buildingInfo(targetId) {
    const city = cities().GetCity(targetId);
    if (!city) return {};
    const bd = city.get_CityBuildingsData();
    const T = ClientLib.Base.ETechName;
    const unique = (name) => bd.GetUniqueBuildingByTechName(name);
    const pos = (b) => b ? { x: b.get_CoordX(), y: b.get_CoordY() } : null;
    return {
      cy: pos(unique(T.Construction_Yard) || bd.GetBuildingByMDBId(ClientLib.Base.ETech.FOR_Fortress_ConstructionYard)),
      cc: pos(unique(T.Command_Center)),
      barracks: pos(unique(T.Barracks)),
      factory: pos(unique(T.Factory)),
      airport: pos(unique(T.Airport)),
      df: pos(unique(T.Defense_Facility)),
      dhq: pos(unique(T.Defense_HQ)),
      support: pos(unique(T.Support_Air) || unique(T.Support_Art) || unique(T.Support_Ion))
    };
  }
  function clientEnv(data) {
    const E = enums();
    const util = ClientLib.API.Util;
    const resMain = ClientLib.Res.ResMain.GetInstance();
    const hpOverride = ClientLib.Base.EUnitModuleType.HitpointOverride;
    const ownCosts = typeof util.GetOwnUnitRepairCosts === "function";
    return {
      E,
      unit: (mdbId) => resMain.GetUnit_Obj(mdbId),
      maxHealth(level, unit, bonus, modules) {
        const mod = (unit.m || []).find((m) => m.t === hpOverride);
        const u = mod && (modules || []).indexOf(mod.i) !== -1 ? Object.assign({}, unit, { lp: mod.h }) : unit;
        return Math.floor(util.GetUnitMaxHealthByLevel(level, u, bonus)) * 16;
      },
      techName: (unit) => parseInt(ClientLib.Base.Tech.GetTechNameFromTechId(unit.tl, unit.f), 10),
      repairCosts(unit, mdbId, level, ratio) {
        if (unit.pt !== E.Offense || !ownCosts) {
          return cities().get_CurrentCity() !== null ? util.GetUnitRepairCosts(level, mdbId, ratio) : null;
        }
        return util.GetOwnUnitRepairCosts(level, mdbId, ratio);
      },
      buildingInfo: buildingInfo(data.d.di),
      asAttacker(fn) {
        if (ownCosts) return fn();
        const c = cities();
        c.set_CurrentCityId(data.d.ai);
        try {
          fn();
        } finally {
          c.set_CurrentCityId(data.d.di);
        }
      }
    };
  }
  function timespan(seconds) {
    try {
      return webfrontend.phe.cnc.Util.getTimespanString(seconds);
    } catch {
      return `${Math.round(seconds)} s`;
    }
  }
  function compact2(n) {
    try {
      return webfrontend.phe.cnc.gui.util.Numbers.formatNumbersCompact(n);
    } catch {
      return String(Math.round(n));
    }
  }
  function lootFromCurrentCity() {
    try {
      const list = ClientLib.API.Battleground.GetInstance().GetLootFromCurrentCity();
      if (list === null) return null;
      const loot = {};
      for (const r of list) loot[r.Type] = r.Count;
      return loot;
    } catch {
      return null;
    }
  }
  function morale(cityId, ownId) {
    const c = cities();
    const target = c.GetCity(cityId);
    const own = c.GetCity(ownId);
    if (!target || !own) return null;
    const sign = ClientLib.Base.Util.GetMoralSignType(own.get_LvlOffense(), target.get_LvlBase());
    let center = null;
    try {
      center = mainData().get_EndGame().GetCenter().get_CombatId();
    } catch {
    }
    if (mainData().get_Server().get_CombatUseMoral() && target.IsNPC() && target.get_Id() !== center && (sign.k === 1 || sign.k === 2)) {
      return { text: `~${100 - sign.v}%`, level: sign.k, value: sign.v };
    }
    return { text: "100%", level: 0, value: 0 };
  }
  var Stabs = class {
    /** Short description for `/st help`. */
    get description() {
      return t("descStabs");
    }
    constructor(config, toolbar) {
      this.name = "STABS";
      this.defaultEnabled = false;
      this.parked = true;
      this.config = config;
      this.toolbar = toolbar;
      this.running = false;
      this.tabsActive = false;
      this.cache = new SimCache();
      this._events = [];
      this._timer = null;
      this._button = null;
      this._win = null;
      this._backButton = null;
      this._replayTarget = null;
      this._lock = false;
      this._lockUntil = 0;
      this._lockTimer = null;
      this._request = false;
      this._formationSig = null;
      this._shown = null;
      this._columns = {};
      this._dirty = true;
      this._onKeyDown = (e) => this._hotkey(e);
    }
    async start() {
      this.running = true;
      this.tabsActive = false;
      if (tabsLoaded()) {
        this._goIdle();
        return;
      }
      if (!this.parked) {
        this.toolbar.register({
          id: TOOLBAR_ID3,
          icon: ICONS.sim,
          label: () => t("toolbarStabs"),
          onClick: () => this.togglePanel()
        });
      }
      this._attach(ClientLib.Vis.VisMain.GetInstance(), "ViewModeChange", ClientLib.Vis.ViewModeChange, this._onViewChanged);
      this._attach(cities(), "CurrentChange", ClientLib.Data.CurrentCityChange, this._onCityChange);
      this._onViewChanged(null, viewMode());
    }
    stop() {
      this.running = false;
      this._teardown();
      this.cache = new SimCache();
    }
    /** One-line status for `/st status`. */
    statusText() {
      if (!this.running) return "/st plugin enable stabs";
      if (this.tabsActive) return t("stabsStatusTabs");
      return t("stabsStatus", { n: this._cacheCount() });
    }
    /**
     * /st status: "inactive — TABS detected" instead of "on" while TABS runs.
     * Checked live: TABS may load after STABS started.
     */
    statusState() {
      if (!this.running) return null;
      if (!this.tabsActive && tabsLoaded()) this._goIdle();
      return this.tabsActive ? t("stabsInactiveTabs") : null;
    }
    // ── Lifecycle ──
    /** TABS runs here: drop everything and stay idle. */
    _goIdle() {
      if (!this.tabsActive) chatMessage(`[ST] ${t("stabsTabsDetected")}`);
      this.tabsActive = true;
      this._teardown();
      console.log("[ST] STABS: TABS is loaded - staying inactive");
    }
    _teardown() {
      for (const ev of this._events) {
        try {
          webfrontend.phe.cnc.Util.detachNetEvent(ev.source, ev.name, ev.type, this, ev.cb);
        } catch {
        }
      }
      this._events = [];
      this._stopTimer();
      clearTimeout(this._lockTimer);
      this._lockTimer = null;
      this._lock = false;
      this._request = false;
      document.removeEventListener("keydown", this._onKeyDown);
      this.toolbar.unregister(TOOLBAR_ID3);
      if (this._button) {
        try {
          const parent = this._button.getLayoutParent();
          if (parent) parent.remove(this._button);
          this._button.dispose();
        } catch {
        }
        this._button = null;
      }
      if (this._win) this._win.dispose();
      this._win = null;
      if (this._backButton) {
        try {
          const parent = this._backButton.getLayoutParent();
          if (parent) parent.remove(this._backButton);
          this._backButton.dispose();
        } catch {
        }
        this._backButton = null;
      }
      this._shown = null;
      this._columns = {};
    }
    _attach(source, name, type, cb) {
      webfrontend.phe.cnc.Util.attachNetEvent(source, name, type, this, cb);
      this._events.push({ source, name, type, cb });
    }
    _onViewChanged(oldMode, newMode) {
      const V = ClientLib.Vis.Mode;
      if (newMode === V.CombatSetup) {
        this._ensureButton();
        if (this._button) this._button.show();
        document.addEventListener("keydown", this._onKeyDown);
        this._formationSig = null;
      } else if (oldMode === V.CombatSetup) {
        if (this._button) this._button.hide();
        document.removeEventListener("keydown", this._onKeyDown);
      }
      if ((newMode === V.CombatSetup || newMode === V.Battleground) && this.config.get("stabs.panel.open", true) && !inReplay() && !this.isPanelOpen()) {
        this.openPanel();
      }
      if (newMode !== V.CombatSetup && newMode !== V.Battleground && newMode !== V.City) this.closePanel();
      this._syncTimer();
    }
    _onCityChange(oldId, newId) {
      if (cities().GetCity(newId) === null) this._shown = null;
      this._dirty = true;
    }
    /** The tick runs while the attack setup or the panel is open. */
    _syncTimer() {
      const needed = viewMode() === ClientLib.Vis.Mode.CombatSetup || this.isPanelOpen();
      if (needed && !this._timer) {
        this._timer = setInterval(() => this._tick(), TICK_MS2);
        this._tick();
      } else if (!needed) {
        this._stopTimer();
      }
    }
    _stopTimer() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
    }
    _tick() {
      if (tabsLoaded()) {
        this._goIdle();
        return;
      }
      try {
        if (viewMode() === ClientLib.Vis.Mode.CombatSetup) this._watchFormation();
        this._updateButton();
        if (this.isPanelOpen()) this._render();
      } catch (e) {
        console.warn("[ST] STABS: tick failed", e);
      }
    }
    /** A formation change (move, enable/disable) marks the panel dirty and, with auto simulate, simulates. */
    _watchFormation() {
      if (!targetReady()) return;
      const formation = readFormation();
      const sig = formation ? `${cities().get_CurrentCityId()}#${JSON.stringify(formation.map((u) => [u.id, u.x, u.y, u.enabled, u.h]))}` : null;
      if (sig === this._formationSig) return;
      this._formationSig = sig;
      this._dirty = true;
      if (formation && formation.length && this.config.get("stabs.autoSimulate", true) && !this._cachedEntry(formation)) {
        this.simulate();
      }
    }
    _hotkey(e) {
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.keyCode === KEY_NUM0) this._onSimulateClick();
      else if (e.keyCode === KEY_NUM7) this.togglePanel();
    }
    // ── Simulation ──
    _cachedEntry(formation) {
      const c = cities();
      const ownId = c.get_CurrentOwnCityId();
      const targetId = c.get_CurrentCityId();
      if (!formation || ownId === null || targetId === null) return null;
      return this.cache.check(targetId, formationKey(formation, ownId), cacheState(targetId, ownId));
    }
    _onSimulateClick() {
      if (this._cachedEntry(readFormation())) {
        this.openPanel();
        return;
      }
      this.simulate();
    }
    /** Simulate the current formation; during the 3 s lock it runs once the lock ends. */
    simulate() {
      if (this._lock) {
        this._request = true;
        return;
      }
      const c = cities();
      const own = c.get_CurrentOwnCity();
      const target = c.get_CurrentCity();
      if (!own || !target || target.CheckInvokeBattle(own, true) !== ClientLib.Data.EAttackBaseResult.OK) return;
      const formation = readFormation();
      if (!formation) return;
      this._lock = true;
      this._lockUntil = 0;
      this._restartLock();
      const units = formation.filter((u) => u.enabled && u.h > 0).map((u) => ({ i: u.id, x: u.x, y: u.y }));
      ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand("SimulateBattle", {
        battleSetup: { d: target.get_Id(), a: own.get_Id(), u: units, s: 0 }
      }, webfrontend.phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, this, (ctx, result) => {
        this._restartLock();
        this._lockUntil = Date.now() + SIM_LOCK_MS;
        this._onResult(result, formation);
      }), null);
    }
    _restartLock() {
      clearTimeout(this._lockTimer);
      this._lockTimer = setTimeout(() => this._unlock(), SIM_LOCK_MS);
    }
    _unlock() {
      this._lockTimer = null;
      this._lock = false;
      this._lockUntil = 0;
      if (this._request && this.running && !this.tabsActive) {
        this._request = false;
        this.simulate();
      }
    }
    _onResult(data, formation) {
      if (!this.running || this.tabsActive || !data || cities().get_CurrentCity() === null) return;
      try {
        const d = data.d;
        const merged = mergeFormation(formation, d.a);
        const key = formationKey(merged, d.ai);
        this.cache.check(d.di, key, cacheState(d.di, d.ai));
        const stats = computeStats(data, clientEnv(data));
        const own = cities().GetCity(d.ai);
        this.cache.add(d.di, key, {
          stats,
          formation: merged,
          combat: d,
          ownId: d.ai,
          cityId: d.di,
          recovery: own ? own.get_hasRecovery() : void 0
        });
        this._dirty = true;
      } catch (e) {
        console.error("[ST] STABS: simulation result not readable", e);
      }
    }
    _cacheCount() {
      try {
        return this.cache.count(cities().get_CurrentCityId());
      } catch {
        return 0;
      }
    }
    // ── Simulate button (attack setup bar) ──
    _ensureButton() {
      if (this._button) return;
      try {
        const hud = qx.core.Init.getApplication().getPlayArea().getHUD();
        const swap = hud.getUIItem(ClientLib.Data.Missions.PATH.WDG_COMBATSWAPVIEW);
        const btn = new webfrontend.ui.SoundButton(null, IMG.simulate).set({
          toolTipText: t("stabsSimulate"),
          width: 44,
          height: 44,
          allowGrowX: false,
          allowGrowY: false,
          appearance: "button-baseviews",
          marginRight: 6
        });
        btn.addListener("click", () => this._onSimulateClick());
        swap.getLayoutParent().addAfter(btn, swap);
        this._button = btn;
      } catch (e) {
        console.warn("[ST] STABS: Simulate button not placed", e && e.message);
      }
    }
    /** Enabled unless locked or empty; a cached formation is always clickable. Counts down after a result. */
    _updateButton() {
      const btn = this._button;
      if (!btn) return;
      const formation = readFormation();
      const cached = formation ? !!this._cachedEntry(formation) : false;
      btn.setEnabled(!!formation && (cached || !this._lock && formation.length > 0));
      const left = this._lockUntil - Date.now();
      if (!cached && formation && formation.length && this._lock && left > 0) {
        btn.setLabel((left / 1e3).toFixed(1));
        btn.setShow("label");
      } else {
        btn.setShow("icon");
      }
    }
    // ── Statistics window ──
    isPanelOpen() {
      return !!this._win && this._win.isOpen();
    }
    togglePanel() {
      if (this.isPanelOpen()) {
        this.config.set("stabs.panel.open", false);
        this.closePanel();
      } else {
        this.config.set("stabs.panel.open", true);
        this.openPanel();
      }
    }
    openPanel() {
      if (this.tabsActive) return;
      this._ensureWindow();
      if (!this._win) return;
      this._win.open();
      this._dirty = true;
      this._render();
      this._syncTimer();
    }
    /** Closing forgets the shown results (TABS resets its columns on close). */
    closePanel() {
      if (this._win) this._win.close();
      this._shown = null;
      this._columns = {};
      this._syncTimer();
    }
    _ensureWindow() {
      if (this._win) return;
      try {
        this._win = new StatsWindow({
          config: this.config,
          presets: [PRESETS.live, PRESETS.cy].map((p) => ({
            id: p.id,
            name: p.id === "live" ? t("stabsPresetLive") : p.name,
            description: t(p.id === "live" ? "stabsPresetLiveDesc" : "stabsPresetCyDesc")
          })),
          onUserClose: () => {
            this.config.set("stabs.panel.open", false);
            this._shown = null;
            this._columns = {};
            this._syncTimer();
          },
          onSimulate: (id) => this._simulateColumn(id),
          onReplay: (id) => this._replayColumn(id),
          onLoad: (id) => this._loadColumn(id),
          onReset: () => {
            const targetId = cities().get_CurrentCityId();
            if (targetId) this.cache.clear(targetId);
            this._shown = null;
            this._columns = {};
            this._dirty = true;
            this._render();
          }
        });
      } catch (e) {
        console.warn("[ST] STABS: statistics window not built", e && e.message);
        this._win = null;
      }
    }
    /** The live column: the cached result of the current formation, else the last one (dimmed). */
    _refreshShown() {
      if (!targetReady()) return false;
      const c = cities();
      const formation = readFormation();
      if (formation) {
        const ownId = c.get_CurrentOwnCityId();
        const key = formationKey(formation, ownId);
        const entry = this.cache.check(c.get_CurrentCityId(), key, cacheState(c.get_CurrentCityId(), ownId));
        if (entry) this._shown = { key, entry };
      }
      return !!this._shown && !!formation && this._shown.key === formationKey(formation, this._shown.entry.ownId);
    }
    /** Key of the current formation, or null. */
    _currentKey() {
      const formation = readFormation();
      if (!formation) return null;
      return formationKey(formation, cities().get_CurrentOwnCityId());
    }
    _render() {
      if (!this._win || !this._win.isOpen()) return;
      if (this._dirty) {
        this._dirty = false;
        this._refreshShown();
        this._columns = { live: this._shown };
        if (targetReady()) {
          const best = this.cache.best(cities().get_CurrentCityId(), PRESETS.cy.criteria);
          if (best) this._columns.cy = best;
        }
      }
      const current = targetReady() ? this._currentKey() : null;
      const loot = lootFromCurrentCity();
      const fmt5 = { time: timespan, number: compact2 };
      const columns = ["live", "cy"].map((id) => {
        const shown = this._columns[id] || null;
        const view = shown ? this._columnView(shown.entry, loot) : null;
        return { cells: columnCells(view, fmt5), dim: !!shown && shown.key !== current, view };
      });
      this._win.update({
        columns,
        enemyRows: visibleEnemyRows(columns[0].view && columns[0].view.stats),
        moraleVisible: columns.some((c) => c.view && c.view.morale && c.view.morale.text !== "100%"),
        cacheCount: this._cacheCount(),
        outcomeTitles: { "total-defeat": t("stabsTotalDefeat"), "total-victory": t("stabsTotalVictory"), victory: t("stabsVictory") }
      });
    }
    /** What one column needs from the client, for a cache entry. */
    _columnView(entry, loot) {
      const view = { stats: entry.stats, loot, base: "", morale: null, storage: null };
      const own = cities().GetCity(entry.ownId);
      if (own) {
        view.base = own.get_Name();
        const rc = Math.min(own.GetResourceCount(RES.RC_INF), own.GetResourceCount(RES.RC_VEH), own.GetResourceCount(RES.RC_AIR));
        try {
          view.storage = mainData().get_Time().GetTimeSpan(rc);
        } catch {
          view.storage = null;
        }
      }
      try {
        view.morale = morale(entry.cityId, entry.ownId);
      } catch {
        view.morale = null;
      }
      return view;
    }
    // ── Column buttons ──
    _columnEntry(id) {
      const shown = this._columns[id];
      return shown ? shown.entry : null;
    }
    /** Double click: put the column's formation in the attack setup. */
    _loadColumn(id) {
      const entry = this._columnEntry(id);
      if (entry) applyFormation(entry);
      this._dirty = true;
    }
    /** ⊕: load the column's formation and simulate it (the current one when the column is empty). */
    _simulateColumn(id) {
      const entry = this._columnEntry(id);
      if (entry) applyFormation(entry);
      this._dirty = true;
      this.simulate();
    }
    /** ▶: view the column's battle; the back button returns to the attack setup. */
    _replayColumn(id) {
      const entry = this._columnEntry(id);
      if (!entry || !entry.combat) return;
      try {
        this._replayTarget = entry.cityId;
        this._ensureBackButton();
        if (this._win) this._win.close();
        startReplay(entry.cityId, entry.combat);
      } catch (e) {
        console.warn("[ST] STABS: replay failed", e && e.message);
      }
    }
    /** A back button on the game's replay overlay (that overlay belongs to the reports and has none for a simulation). */
    _ensureBackButton() {
      if (this._backButton) return;
      const overlay = qx.core.Init.getApplication().getReportReplayOverlay();
      const btn = new qx.ui.form.Button().set({
        width: 48,
        height: 48,
        icon: IMG.back,
        appearance: "button-friendlist-scroll",
        toolTipText: t("stabsReplayBack")
      });
      btn.addListener("click", () => this._backToSetup());
      overlay.add(btn, { top: 11, left: 346 });
      this._backButton = btn;
    }
    _backToSetup() {
      try {
        const area = qx.core.Init.getApplication().getPlayArea();
        const target = this._replayTarget || cities().get_CurrentCityId();
        area.setView(ClientLib.Data.PlayerAreaViewMode.pavmCombatSetupDefense, target, 0, 0);
        ClientLib.Vis.VisMain.GetInstance().get_CombatSetup().SetPosition(0, area.getHUD().getCombatSetupOffset(ClientLib.Vis.CombatSetup.CombatSetupViewMode.Defense));
      } catch (e) {
        console.warn("[ST] STABS: back to the attack setup failed", e && e.message);
      }
    }
  };
  function applyFormation(entry) {
    const c = cities();
    if (c.get_CurrentOwnCityId() !== entry.ownId) c.set_CurrentOwnCityId(entry.ownId);
    const own = c.GetCity(entry.ownId);
    const formation = own && own.get_CityArmyFormationsManager().GetFormationByTargetBaseId(entry.cityId);
    const list = formation && formation.get_ArmyUnits();
    if (!list) return false;
    const byId = (id) => list.l.find((u) => u.get_Id() === id) || null;
    const carried = [];
    for (const f of entry.formation) {
      if (f.gs === 2) {
        carried.push(f);
        continue;
      }
      const unit = byId(f.id);
      if (!unit) continue;
      unit.set_Enabled(f.enabled);
      const inTheWay = formation.GetUnitByCoord(f.x, f.y);
      if (inTheWay && inTheWay !== unit && ClientLib.Base.Unit.CanBeTransported(inTheWay.get_UnitGameData_Obj(), unit.get_UnitGameData_Obj())) {
        inTheWay.MoveBattleUnit(unit.get_CoordX(), unit.get_CoordY());
      }
      unit.MoveBattleUnit(f.x, f.y);
    }
    for (const f of carried) {
      const unit = byId(f.id);
      const carrier = formation.GetUnitByCoord(f.x, f.y);
      if (unit && carrier && carrier.get_Enabled()) unit.set_Enabled(true);
    }
    return true;
  }
  function startReplay(cityId, combat) {
    qx.core.Init.getApplication().getPlayArea().setView(ClientLib.Data.PlayerAreaViewMode.pavmCombatReplay, cityId, 0, 0);
    const battleground = ClientLib.Vis.VisMain.GetInstance().get_Battleground();
    battleground.Init();
    battleground.LoadCombatDirect(combat);
    setTimeout(() => {
      battleground.RestartReplay();
      battleground.set_ReplaySpeed(1);
    }, 0);
  }

  // lib/main.js
  var ST_VERSION = "5.27.1";
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
    const toolbar = new Toolbar(config, { onConfig: () => cli.openConfigMenu() });
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
      new Stabs(config, toolbar)
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
        const state = typeof p.statusState === "function" && p.statusState() || t(p.running ? "pluginEnabled" : "pluginDisabled");
        const extra = typeof p.statusText === "function" ? ` \u2014 ${p.statusText()}` : "";
        chatMessage(`[ST] ${p.name}: ${state}${extra}`);
      }
      const reg = { player: "registerStatusOn", shared: "registerStatusShared", none: "registerStatusOff" };
      chatMessage(`[ST] ${t(reg[api.registration])}`);
      const pause = { paused: "scannerPausePaused", active: "scannerPauseActive", unknown: "scannerPauseUnknown", stopped: "scannerPauseStopped" };
      chatMessage(`[ST] ${t(pause[online.describe()])}`);
    });
    const registerPanel = new RegisterPanel(async (code, replace) => {
      const result = await api.enroll(code, replace);
      if (result.ok) chatMessage(`[ST] ${t("registerSuccessChat")}`);
      return result;
    }, {
      onRestore: async (key) => {
        const result = await api.restoreKey(key);
        if (result.ok) chatMessage(`[ST] ${t("registerRestoredChat")}`);
        return result;
      },
      getExport: () => exportConfig(config.data)
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
    toolbar.register({
      id: "help",
      icon: ICONS.help,
      label: () => t("toolbarHelp"),
      onClick: () => helpPanel.toggle(buildHelpPanel(ST_VERSION, plugins, cli.commands))
    });
    toolbar.start();
    cli.start();
    idle.start();
    fixUnload();
    chatMessage(`[ST] ${t("loaded", { version: ST_VERSION, active: plugins.filter((p) => p.running).length, total: plugins.length })}`);
    console.log(`[ST] v${ST_VERSION} ready`);
    if (config.configLost) chatMessage(`[ST] ${t("configLost")}`);
    announceUpdateOnce({
      url: api._url,
      current: ST_VERSION,
      notify: (version) => chatMessage(`[ST] ${t("updateAvailable", { version })}`)
    }).catch(() => {
    });
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
}

// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * bootstrap.js — userscript-manager side of Shockr TA Tools (5.25.0).
 *
 * Not an ES module: build.js pastes this file as-is into the .user.js, after
 * `function __stBundle() { ...whole bundle... }`, and calls stBootstrap(__stBundle).
 *
 * With @grant GM_getValue/GM_setValue the manager runs the script in a sandbox,
 * where ClientLib, qx and the game objects are not reachable. So the bundle is
 * injected into the page as a <script> and talks to this side via window events
 * (see lib/config.js): it asks for the mirrored config ('st-gm-request') while
 * it loads, gets it back synchronously ('st-gm-config'), and reports every
 * config change ('st-config-changed'), which is written to GM storage. GM
 * storage is shared by all game hosts (cncappXX), localStorage is not.
 */
function stBootstrap(bundle) {
    const GM_KEY = 'st-config';
    const hasGm = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    function readGm() {
        try {
            const v = GM_getValue(GM_KEY, {});
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        } catch (e) {
            console.warn('[ST] GM config read failed:', e);
            return {};
        }
    }

    let requested = false;
    if (hasGm) {
        window.addEventListener('st-gm-request', () => {
            requested = true;
            window.dispatchEvent(new CustomEvent('st-gm-config', {
                detail: JSON.stringify({ config: readGm() }),
            }));
        });

        window.addEventListener('st-config-changed', (e) => {
            let change;
            try {
                change = JSON.parse(e.detail);
            } catch {
                return;
            }
            if (!change || typeof change.key !== 'string' || !change.key) return;
            // Read fresh each time: another tab (other host) may have written since
            const cfg = readGm();
            if ('value' in change) cfg[change.key] = change.value;
            else delete cfg[change.key];
            try {
                GM_setValue(GM_KEY, cfg);
            } catch (err) {
                console.warn('[ST] GM config write failed:', err);
            }
        });
    } else {
        console.warn('[ST] GM storage not available — config is not mirrored across game hosts');
    }

    // Synchronous: an inline script runs during appendChild, before the next line
    const script = document.createElement('script');
    script.textContent = '(' + bundle.toString() + ')();';
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    if (hasGm && !requested) {
        console.error('[ST] Bundle did not start in the page (script injection blocked?)');
    }
}

stBootstrap(__stBundle);
})();
