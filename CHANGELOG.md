# Changelog

## [Unreleased]

### Planning
- Roadmap: Fase 6 toegevoegd — Repair Guard, Upgrade Calculator, Alliance War Dashboard

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
