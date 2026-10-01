# Roadmap — Shockr TA Tools

Status of the rebuild. Background, architecture and the data format are in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

Legend: ✅ done · 🟡 mostly done · ⬜ open · 🔲 not started

---

## Fase 0 — Repo setup ✅

- [x] `Ghoztmaster/shockr-ta-tools` aangemaakt op GitHub
- [x] README.md met wat het doet, installatie, credits (Shockr, NetquiK, Ghozt)
- [x] LICENSE
- [x] `legacy/` als referentie voor de v4.5.3.6 bundel
- [x] `.gitignore`, `package.json`, esbuild config

## Fase 1 — Clean-room herschrijving lokale features 🟡

Doel: werkend script zonder server-dependency.

### 1a — Fundament ✅

- [x] `game-ready.js` — wacht op ClientLib + qooxdoo + player data
- [x] `clientlib-patch.js` — fingerprint-scan patcher met fallback (`$CampType`, `$Id`, `$Level`, `$OffenseUnits`, `$DefenseUnits`, `$PlayerId`, `$AllianceId`, `$Poll`)
- [x] `config.js` — localStorage-based, per-plugin settings
- [x] `cli.js` — `/st` chat-commando's (help, config, plugin enable/disable)
- [x] `idle-detect.js` — 20 min inactiviteit-detectie
- [x] `city-util.js` — main city, objecten in range, distance, waitForCity
- [x] `packer.js` — base62, layout- en unit-packers
- [x] `build.js` — esbuild bundel naar `dist/shockr-ta-tools.user.js`

### 1b — Plugins ✅

- [x] `camp-tracker.js` — markers op de wereldkaart + chat-alerts bij nieuwe spawns
- [x] `kill-info.js` — plunder panel via `/st plunder`, toont per-unit breakdown en totalen voor geselecteerde FG base (pure GAMEDATA-berekening)
- [x] `player-status.js` — alliance-bases kleuren op online-status

> De battle-view tooltip uit v4.x is vervallen: die tooltip wordt op canvas gerenderd en is niet via de DOM aan te vullen.

### 1c — Opschoning ✅

- [x] `BugFixer.fixOnUnload()` — alleen de qooxdoo handler patchen, niet globale `addEventListener`
- [x] Alle shockr.dev API-calls verwijderd
- [x] `@match` URL gevalideerd tegen huidige game-client
- [x] Error handling: chat-melding bij patch-failures

### 1d — Tests & release 🟡

- [x] Handmatige in-game tests
- [x] v5.0.0 tag
- [x] Repo public
- [x] Installatie-instructie ([INSTALL.md](INSTALL.md))
- [ ] Unit tests (patcher, packers, config)

## Fase 2 — Scanner-backend ✅

Backend live op `packetlab.nl/shockr/`.

- [x] `POST /api/alliance/scan` — API key auth, validatie, JSONL-opslag per world
- [x] `GET /api/alliance/bases` — lijst + filters
- [x] `GET /api/alliance/base/{cityId}` — detail + scan-history
- [x] Rate limiting, CORS beperkt tot game-domein, gehard container

## Fase 3 — Alliance-website ✅

Alliance website live.

- [x] Base-lijst — sorteerbaar, filterbaar, kleurcodering op leeftijd
- [x] Base-detail — 9×16 raster, defense/offense units met levels en posities, scan-history
- [x] Alliance-overzicht

## Fase 4 — Script scanner-integratie 🟡

- [x] `layout-scanner.js` — FG base scanning werkt
- [ ] `alliance-scanner.js` — alliance-bases scannen (nog niet gebouwd)
- [ ] `plugins/scan-button.js` — "Bekijk online" knop op wereldkaart (toekomstig, als er behoefte aan is)
- [x] Config — `api.url` / `api.key` via `/st config set`
- [x] Consent — scanner pas actief na expliciete opt-in
- [x] Chat-feedback bij scans
- [x] Error handling bij gefaalde POST
- [x] Pacing — respecteert server rate limits

## Fase 5 — Documentatie & release ✅

- [x] README.md
- [x] CHANGELOG.md
- [x] CONTRIBUTING.md
- [x] ALLIANCE_GUIDE
- [x] v5.1.0 release

## Fase 6 — Nieuwe plugins 🔲

### 6a — Repair Guard 🔲

- [ ] `plugins/repair-guard.js` — schakelt alle "Repair All" knoppen en functies uit (DOM-manipulatie)
- [ ] Toggle via `/st plugin enable/disable repair-guard`
- Doel: voorkom per ongeluk volledig reppen van units (crystal besparen op FA-werelden)
- Puur client-side, geen server nodig
- Inspiratie: Leo's script (alliance-intern)

### 6b — Upgrade Calculator 🔲

- [ ] `plugins/upgrade-calc.js` — leest upgrade-kosten per gebouw/level uit GAMEDATA (client-side, zelfde aanpak als KillInfo)
- [ ] Leest huidige productiesnelheid live uit ClientLib
- [ ] Toont: "gebouw X naar level Y kost Z resources, duurt N uur sparen bij huidig tempo"
- [ ] Paneel in-game, toggle via `/st upgradecalc`
- Puur client-side, geen server nodig

### 6c — Alliance War Dashboard 🔲

Uitbreiding van de bestaande alliance-website (`packetlab.nl/shockr/`).

- [ ] Combineert WatchList-watcher data (`get_AllianceWatchListWatcher()`) met scan-data en loot-logs
- [ ] Toont wie naar welk target kijkt, voorkomt dubbele aanvallen, alliance-voortgang per sector
- [ ] Nieuw snapshot-veld (`watchlist`) in het userscript
- [ ] Backend-opslag voor watchlist-snapshots
- Bouwt voort op de bestaande Fase 2/3/4 infrastructuur

---

## Samenvatting

| Fase | Onderdeel | Status |
|------|-----------|--------|
| 0 | Repo setup | ✅ Klaar |
| 1 | Lokale features (fundament, plugins, opschoning) | 🟡 Grotendeels klaar — unit tests open |
| 2 | Scanner-backend | ✅ Live op packetlab.nl/shockr/ |
| 3 | Alliance-website | ✅ Live |
| 4 | Script scanner-integratie | 🟡 Grotendeels klaar — alliance-scanner en scan-button open |
| 5 | Documentatie & release | ✅ Klaar (v5.1.0) |
| 6 | Nieuwe plugins (Repair Guard, Upgrade Calculator, Alliance War Dashboard) | 🔲 Nog niet gestart |
