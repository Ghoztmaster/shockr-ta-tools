# Changelog

## [Unreleased]

### Planning
- Roadmap: Fase 6 toegevoegd — Repair Guard, Upgrade Calculator, Alliance War Dashboard

### Target Watch backend (VPS)
- `POST /api/target-watch` — register/refresh that a player is viewing a target (one entry per player per target, timestamp = server time)
- `GET /api/target-watch/{worldId}/{targetId}` — `{"watchers": [...]}` of that target; `GET /api/target-watch/{worldId}` — all watched targets of a world (for the dashboard)
- In-memory only (no database/JSONL), scoped per alliance via the API key, 10 min TTL with lazy cleanup on every request
- Same `X-Alliance-Key` auth as the scanner; scanner endpoints and storage unchanged
- **Caddy:** `/shockr/api/target-watch*` must bypass Basic Auth (like `/api/scan`) — see docs/DEPLOY.md; otherwise the userscript gets 401

### Alliance War Dashboard (VPS)
- `/targets` page (Basic Auth) — live table of watched targets per world: target, coords, level, type, watchers with "x min ago"; auto-refresh every 20 s
- Most watchers first, then most recent; targets with ≥2 watchers highlighted orange with ⚠️ (possible double attack); world selector when several worlds are active; friendly message when nobody is watching
- `GET /api/targets` — read-only viewer endpoint (Basic Auth, like `/api/bases`) with all active worlds, so the page needs no alliance API key
- Plain HTML/CSS/JS in the same dark theme, responsive (cards on mobile); "🎯 Target Watch" link in the base overview header

## [5.6.0] — 2026-10-02

### Per-player API keys with enrollment
- **Userscript:** `/st register` opens a popup (same style as the help panel, closes via ✕ / Escape) with one password field for the enrollment code; player id, name, alliance id and world id are read from the game and sent to `POST /api/enroll`
- **Userscript:** on success the personal key is stored automatically in `api.playerKey` (plus `api.playerKeyId`, the player it belongs to — several accounts can share one browser); popup shows `✅ Registered! Your personal key is active.` and closes after 2 s, chat shows `[ST] ✅ Registered successfully`; errors (wrong code, alliance not authorized, too many attempts) shown as ❌ in the popup
- **Userscript:** all scan/target-watch requests send `X-Player-Key` when a personal key is set for the logged-in player, otherwise the shared `X-Alliance-Key`; identity headers unchanged
- **Userscript:** `/st status` shows the registration state (registered / shared key / not registered); `/st config get|set|list` never shows `api.playerKey`, only *set* / *not set*
- **Userscript:** new 403 chat messages — `⚠️ Not registered — type /st register` and `⚠️ Personal key rejected — type /st register ...`; all new texts in EN/DE/NL
- **Server (VPS):** `POST /api/enroll` (no auth header — the code is the auth): checks the enrollment code and the alliance whitelist from `config/enrollment.json` (re-read when the file changes), issues a 32-char hex key, stored as bcrypt hash in `data/player_keys.jsonl`; the plaintext is returned once. Enrolling again issues a new key and invalidates the old one. Rate limit 5 attempts per IP per hour
- **Server:** `X-Player-Key` is checked first and must belong to `X-Player-Id` and be used from the alliance it was enrolled with; fallback to the shared `X-Alliance-Key` until `allianceKeyUntil` in `enrollment.json` (no deadline when absent); no key → `403 Not registered — type /st register`. Response header `X-Auth-Method: player-key | alliance-key`. Membership check (5.5.1) unchanged on top
- **Server:** admin endpoints behind Basic Auth — `GET /api/members` (registered players + last activity), `DELETE /api/enroll/{playerId}` (revoke without restart)
- **Proxy:** new public location for `/shockr/api/enroll`; `X-Player-Key` must be added to `Access-Control-Allow-Headers` for scan/target-watch — see docs/DEPLOY.md

## [5.5.1] — 2026-10-02

### Alliance membership check
- **Userscript:** every scan and target-watch request now sends the player's identity — `X-Player-Id`, `X-Player-Name` (URI-encoded) and `X-Alliance-Id` headers
- **Userscript:** a server rejection shows `[ST] ⚠️ Server: not recognized — scan a base first to register.` (EN/DE/NL); a wrong API key keeps its own message; both at most once per minute
- **Server (VPS):** extra layer on top of the `X-Alliance-Key` check for `/api/scan` and `/api/target-watch`: the first request with a valid key registers the player automatically; afterwards the in-game alliance id must match the registered one, otherwise `403 Not a recognized alliance member`; missing identity or alliance id 0 → 403; target-watch body `playerId` must match the header
- **Server:** members not seen for 30 days are dropped (lazy cleanup); member list persisted in `data/members.jsonl` (written on registration, name change and at most hourly for `lastSeen`; compacted on startup) — survives restarts
- **Server:** `CORSMiddleware` removed — nginx is the sole CORS handler; its `Access-Control-Allow-Headers` must include the three new headers (`/shockr/api/scan` and `/shockr/api/target-watch`)
- `/api/bases`, `/api/targets` and the website are not affected
- **Breaking:** script versions before 5.5.1 send no identity and get 403 on scan/target-watch — update the userscript before deploying the server

## [5.5.0] — 2026-10-02

### Help as popup panel
- `/st help` opens a centered popup panel (same dark style as the KillInfo / Upgrade Calculator panels): section headings, command | description tables with aligned columns, commands in monospace light blue, descriptions in grey
- Close with ✕, Escape or typing `/st help` again; scrolls when it doesn't fit; full width with stacked rows on mobile
- `/st config set help.popup false` — help in the chat as before (unchanged output); default `true`
- Escape listener only while the panel is open, removed on close; help content and translations unchanged (new: close hint in EN/DE/NL)

## [5.4.0] — 2026-10-01

### Target Watcher
- **TargetWatcher plugin** — detects when you view a base that is not yours (Forgotten camp/outpost/base or enemy player base; alliance mates' bases are ignored) and reports it to the alliance server: `POST /api/target-watch` with player, target id/name/coords/level/type and world
- Then `GET /api/target-watch/{worldId}/{targetId}`: if other alliance members watch the same target, one chat warning per target view — `[ST] ⚠️ NeoJackson1 kijkt ook naar Camp L47 (sinds 3 min)`
- POST only on target change (2.5 s poll timer), max 1 POST per 5 s; nothing is sent on your own base or the world map (backend expires watches by TTL); paused while a scanner is switching cities
- Off by default — `/st plugin enable target-watcher`; uses the existing `api.url` / `api.key`; `/st status` shows the current target and number of reports
- Requires the backend endpoint (separate VPS update)

### Languages (EN / DE / NL)
- `lib/i18n.js` — every user-facing text (chat messages, panel labels, `/st status`, `/st help`, errors) in English, German and Dutch; `t(key, vars)` with `{placeholder}` substitution and English fallback
- `/st config set language en|de|nl` — default `en`, applies immediately without reload; console logs stay English, game names come from the client

### Help
- `/st help` rewritten — monospace overview of plugin commands, available plugins (generated from the registered plugins, each with a translated `description`), tool commands, settings and useful config keys
- `<name>`/`<key>` placeholders in usage messages are now escaped (were swallowed as HTML in chat)

### API client
- `ApiClient.request(method, path, body)` — one-off JSON request with the alliance key (scan queue unchanged)

## [5.3.0] — 2026-10-01

### Upgrade Calculator
- **UpgradeCalc plugin** — panel listing every building of the current own city that is not max level, with the Tiberium + Power cost of the next level and the time to save up for it at the current production rate (incl. packages and POI), fastest first; "Gereed" when you already have enough
- Off by default — `/st plugin enable upgradecalc`; while enabled a floating "UC" button appears top left when you view one of your own bases (hidden on the world map and on enemy/Forgotten bases), click toggles the panel
- Switching base closes the panel (recalculated on the next click); refreshes every 30 s while open
- Pure client-side (`GetTechLevelResourceRequirements_Obj` + city resource getters) — no fetch, no document-wide listeners

## v5.2.0 — 2026-10-01

### Repair Guard
- **RepairGuard plugin** — blocks "Repair All" / bulk repair so units are not fully repaired by accident (saves crystal on Forgotten Attack worlds); per-unit repair keeps working
- Off by default; toggle with `/st plugin enable|disable repair-guard`, chat message on activation and on a blocked attempt
- Blocks `RepairAll*` client functions (aliases found by reference, no obfuscated names) with a qooxdoo button-text fallback — no DOM observers or document-wide listeners

### CLI
- `/st status` — shows every plugin's on/off state (plus Repair Guard details)
- `/st plugin` accepts hyphenated names (`repair-guard` = `RepairGuard`)
- Plugins can default to disabled (`defaultEnabled = false`)

## v5.1.0 — 2026-10-01

### Alliance Scanner
- **Scanner backend** — FastAPI server receives and stores base scans (JSONL per world, bcrypt API key auth, rate limiting, Pydantic validation)
- **Layout Scanner plugin** — scans nearby FG bases/camps/outposts and POSTs to the alliance server; runs on idle or via `/st scan`
- **Alliance website** — base list with sorting, filtering (world, type, level, age), color-coded freshness; base detail with 9×16 resource grid, defense/offense units with levels and positions, scan history
- **Security** — API key per alliance, Basic Auth on viewer, CORS restricted to game domain, container hardened (non-root, read-only fs, own network), timestamp validation

### Fixes
- **KillInfo** rewritten as an on-demand plunder panel (`/st plunder`) — pure GAMEDATA, no polling, hover listeners or obfuscated-function discovery (fixes game crash from document-wide mouseover)
- Validation: allow negative owner_id (FG bases) and faction values 3–8 (Forgotten variants)
- CORS headers on scan endpoint for cross-origin POST from game client

## v5.0.0 — 2026-09-30

### Complete rebuild from Shockr Tools v4.5.3.6

All shockr.dev API dependencies removed. Script works fully offline.

### Plugins
- **CampTracker** — numbered markers on the world map for nearby FG camps/outposts/bases; configurable size, font, alert threshold; chat alerts with clickable coordinates
- **KillInfo** — plunder tooltip in battle view showing tib/crystal loot per unit
- **PlayerStatus** — alliance base colors by online status (green/yellow/red/grey); own bases cyan

### Infrastructure
- **ClientLib Patcher** — fingerprint-based patching (10 patterns verified against Perforce 576232 / game v26.1); self-healing on client updates; chat alert on patch failure
- **CLI** — `/st help`, `/st config`, `/st plugin enable/disable`
- **Config** — localStorage-based, per-plugin settings
- **Idle Detect** — 20-minute inactivity tracking
- **BugFixer** — patches qooxdoo `_onNativeUnload` to prevent page unload errors
- **Build** — esbuild single-file bundle with Tampermonkey header

### Credits
- Original: Shockr (shockr.dev)
- Fork: NetquiK [SoO] (v4.5.3.6)
- Rebuild: Ghozt [SoO] (v5.0.0+)
