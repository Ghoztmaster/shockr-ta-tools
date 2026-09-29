# Shockr - Tiberium Alliances Tools — Issue Tracker

Repository: `netquik/shockr-ta-tools` (or wherever the maintained fork lives)
Script version: 4.5.3.6 (NetquiK [SoO] fork)

---

## Issue #1 — shockr.dev API is dead, script crashes on scan operations

**Labels:** `bug` `critical` `api`

**Description**
All API calls go to `shockr.dev` (configured in module 679, `Config.api.url`). The domain appears to be dead or no longer serving the TA tools API. This breaks:

- `LayoutScanner` — POST to `/api/v2/city.scan` fails silently, `city_cache_1.CityCache.setStId()` never called
- `AllianceScanner` — same endpoint, same failure
- `Button` ("Scan" button on world map) — `window.open(shockr.dev/base/<id>)` opens a dead page
- `StApi.onStart()` — `install.track` call fails on script load (currently commented out by NetquiK, but `V2Sdk.config` still points to shockr.dev)

**Impact**
Script hangs or throws uncaught promise rejections on every scan cycle (hourly for layouts, every 20 min for alliance, every 30s for player scan). Console fills with network errors. CampTracker and other local-only features may still work but the noise obscures real errors.

**Expected behavior**
Either:
- Remove all shockr.dev API calls and make scanner features no-op (quick fix)
- Replace with a configurable backend URL so users can point to their own server (proper fix)

**Workaround**
None. Users see errors and the Scan button does nothing.

---

## Issue #2 — ClientLib regex patches break on game client updates

**Labels:** `bug` `critical` `compatibility`

**Description**
The script patches obfuscated ClientLib classes using regex matching on minified function bodies (module 33, `client_patcher_1`). Patches affected:

```
PatchCityUnits:       $OffenseUnits, $DefenseUnits  — regex on HasUnitMdbId
PatchWorldObjectNPCCamp: $CampType, $Id, $Level     — regex on $ctor
PatchWorldObjectNPCBase: $Id, $Level                 — regex on $ctor
PatchWorldObjectCity:    $PlayerId, $AllianceId, $Id — regex on $ctor
PatchCommunicationManager: $Poll                     — string match on "Poll"
```

EA pushes Perforce updates that re-obfuscate property names (e.g. confirmed shift `JQZXOE` → `get_UnitGameData_Obj()` in build 575847). When a regex no longer matches, the patch silently fails (`addGetter` returns without defining the property), and any code that reads `object.$CampType`, `object.$Level` etc. gets `undefined`.

**Impact**
- `CampTracker`: camps not detected (`.Type`, `.$CampType`, `.$Level` undefined)
- `LayoutScanner` / `AllianceScanner`: `.$Id` undefined → `set_CurrentCityId(undefined)` → crash
- `Button`: `.$Id` undefined → scan never starts
- `KillInfo`: function body regex for `"tnf:full hp needed to upgrade"` may not match → no plunder tooltip
- `PlayerStatus`: `extractValueFromFunction` for `'Color='` may not match → no online-status coloring

**Expected behavior**
Self-healing fingerprint scan (try multiple patterns, or use real method names like `get_UnitGameData_Obj()` where they exist) instead of single-shot regex. At minimum, log a clear error when a patch fails to match.

**Note**
This is the same class of bug that broke the MehrStrom Combat Advisor at Perforce build 575847. The fix there was switching to real method names + fingerprint fallback.

---

## Issue #3 — `@match` pattern may not cover all game URLs

**Labels:** `bug` `medium` `compatibility`

**Description**
The `@match` header is:
```
https://*.alliances.commandandconquer.com/*/index.aspx*
```

The original (v4.5.3) used:
```
http*://prodgame*.alliances.commandandconquer.com/*/index.aspx*
```

**Questions to verify:**
- Does the current game still serve from `*.alliances.commandandconquer.com`?
- The game launched on Steam (Feb 2025) — does the Steam version use a different URL?
- Are there regional subdomains that don't match the wildcard?

**Impact**
If the URL has changed, the script never injects. Users see nothing — no error, no buttons, no features.

---

## Issue #4 — No error handling or user feedback on patch failures

**Labels:** `enhancement` `ux`

**Description**
When a `ClientLibPatch.addGetter()` regex fails to match, the script throws inside the lazy getter function but the throw is only visible in the console. The user sees:
- CampTracker markers don't appear
- Scan button does nothing
- KillInfo tooltip missing
- Player colors not applied

There is no in-game message, no chat notification, no visual indicator that something is broken.

**Expected behavior**
On patch failure:
- Log a structured warning: `[ST] Patch failed: PatchWorldObjectNPCCamp.$CampType — regex did not match on current client build`
- Show a one-time chat message: `[ST] Some features are unavailable — game client has been updated. Check for a script update.`
- Disable the affected plugin gracefully instead of letting it run with undefined properties

---

## Issue #5 — `BugFixer.fixOnUnload()` hijacks `window.addEventListener`

**Labels:** `bug` `medium` `side-effect`

**Description**
Module 402 replaces `window.addEventListener` globally to intercept `unload` events:

```javascript
window.addEventListener = function(a, b, c) {
    if (a == 'unload') {
        return; // swallowed
    }
    return fixedWindow._addEventListener(a, b, c);
};
```

This silently breaks any other script or game code that registers an `unload` handler. The intent is to prevent a slow `_onNativeUnload` destroy cycle, but the implementation is a global side-effect.

**Impact**
Other userscripts (MaelstromTools, MehrStrom, etc.) that rely on `unload` for cleanup will silently lose their handler. Data-saving on tab close may fail.

**Expected behavior**
Patch only the specific qooxdoo `_onNativeUnload` handler, not the entire `addEventListener` API.

---

## Issue #6 — `LayoutScanner.scanLayout` has a dead-code bug: `ownCityId != ownCityId`

**Labels:** `bug` `low`

**Description**
In module 181, line:
```javascript
if (ownCityId != ownCityId) {
```

This is always `false` — a variable compared to itself. The intended logic (switching own city when out of attack range) never executes.

**Expected behavior**
Should probably be:
```javascript
if (cities.get_CurrentOwnCity().get_Id() != ownCityId) {
```

**Impact**
Layout scans of bases outside attack range from the current own city may fail or use the wrong source city for distance calculations.

---

## Issue #7 — Webpack bundle is not maintainable

**Labels:** `enhancement` `dx`

**Description**
The distributed script is a webpack bundle with numeric module IDs (17, 33, 62, ...). There is no public source repository with the original TypeScript source. The NetquiK fork appears to be edits on the bundled output.

This makes:
- Bug fixing unreliable (hard to trace control flow)
- Regex patch updates error-prone (can't run the TypeScript compiler to check types)
- Contributing practically impossible

**Expected behavior**
Either:
- Publish the TypeScript source with build instructions
- Or clean-room rewrite the useful features as standalone modules

---

## Issue #8 — `CampTracker` alert fires on first load after re-enable

**Labels:** `bug` `low` `ux`

**Description**
`CampTracker.firstUpdate` is set to `true` on construction and flipped to `false` after the first `doUpdate()`. This prevents alerts on initial load. However, if the plugin is stopped and restarted (via `/st plugin disable CampTracker` then `/st plugin enable CampTracker`), a new instance is constructed with `firstUpdate = true` — but the camps are not new, they just weren't tracked during the disable window.

**Impact**
False "New Camp/Outpost spawned" alerts in chat after toggling the plugin.

---

## Issue #9 — `PlayerStatus` color for own bases shows white (same as unknown)

**Labels:** `bug` `low`

**Description**
`getPlayerColor` returns `'#ffffff'` for both the player's own bases and for unknown/unaffiliated bases (the default fallback). Own-base ruins are indistinguishable from neutral bases.

**Expected behavior**
Own bases should have a distinct color (e.g. cyan or bright blue) to differentiate from unknowns.

---

## Issue #10 — Script sends data to external server without user consent or indication

**Labels:** `security` `privacy`

**Description**
The `LayoutScanner`, `AllianceScanner`, and `Button` features automatically POST base layout data (including unit types, levels, positions, owner names, alliance names, coordinates) to `shockr.dev` without:
- Asking the user for consent
- Showing any indication that data is being sent
- Providing an opt-out mechanism (scanners are auto-disabled by default, but can be enabled via `/st plugin enable`)

The `install.track` endpoint (currently commented out) also sends `installId`, `worldId`, `player` name, and script version.

**Expected behavior**
- Clear disclosure that base data is sent to an external server
- Explicit opt-in for scanning features
- Configurable server URL (or disable external sends entirely if no server is configured)

---

## Summary

| # | Title | Severity | Type |
|---|-------|----------|------|
| 1 | shockr.dev API is dead | Critical | Bug |
| 2 | ClientLib regex patches break on game updates | Critical | Bug |
| 3 | @match pattern may not cover all game URLs | Medium | Bug |
| 4 | No error handling on patch failures | Medium | Enhancement |
| 5 | BugFixer hijacks window.addEventListener | Medium | Bug |
| 6 | Dead-code bug: ownCityId != ownCityId | Low | Bug |
| 7 | Webpack bundle is not maintainable | — | Enhancement |
| 8 | CampTracker false alerts on re-enable | Low | Bug |
| 9 | PlayerStatus own-base color indistinct | Low | Bug |
| 10 | Data sent to external server without consent | — | Security |
