# Project Plan: Shockr TA Tools — Fix & Rebuild

**Repo:** `Ghoztmaster/shockr-ta-tools` (public, GitHub)
**Doel:** Shockr - Tiberium Alliances Tools herstellen, opschonen, en uitbreiden met een zelfgehoste alliance-verkenningsdatabase ter vervanging van het dode shockr.dev.

---

## Achtergrond

Shockr Tools (v4.5.3.6, NetquiK [SoO] fork) is een Tampermonkey userscript voor C&C Tiberium Alliances. Het biedt:
- **CampTracker** — markers op de wereldkaart bij nieuwe camps/outposts
- **LayoutScanner** — automatisch base-layouts scannen
- **AllianceScanner** — alliance-bases scannen
- **Button** — "Scan" knop op wereldkaart, opent base online
- **KillInfo** — plunder-waarde tooltip bij mouseover op units
- **PlayerStatus** — alliance-bases kleuren op online-status

Het script is kapot door twee fundamentele problemen:
1. De shockr.dev API is dood — alle scanner/upload-features falen
2. De ClientLib regex-patches breken bij elke game-client update (EA Perforce obfuscatie-shifts)

Zie `shockr-tools-issues.md` voor de volledige issue-lijst (10 issues).

---

## Scope

### In scope
- Userscript fixen voor huidige game-client
- Debundlen van webpack → leesbare broncode
- Alliance-verkenningsdatabase (zelfgehost, MehrStrom VPS)
- Online base-layout viewer voor alliance members
- Public GitHub repo met installatie-instructies

### Uit scope
- MehrStrom optimizer-integratie (blijft apart, private repo)
- Combat Advisor / CY-Optimizer features (blijven in MehrStrom)
- NOD/Forgotten-specifieke aanpassingen (tenzij gevraagd)

---

## Architectuur

### Componenten

```
┌─────────────────────────────────────────────────────────┐
│ Tampermonkey (in-game)                                  │
│                                                         │
│  shockr-ta-tools.user.js                                │
│  ├── CampTracker        (lokaal, geen server nodig)     │
│  ├── KillInfo           (lokaal)                        │
│  ├── PlayerStatus       (lokaal)                        │
│  ├── LayoutScanner      (POST → jouw server)            │
│  ├── AllianceScanner    (POST → jouw server)            │
│  └── ScanButton         (link → jouw server)            │
│                                                         │
│  Config: server URL instelbaar (/st config set)         │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS POST /api/alliance/scan
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Backend (packetlab.nl/mehrstrom/alliance/)               │
│                                                         │
│  FastAPI                                                │
│  ├── POST /api/alliance/scan     (ontvang base-data)    │
│  ├── GET  /api/alliance/bases    (lijst alle scans)     │
│  ├── GET  /api/alliance/base/:id (detail + layout)      │
│  └── Auth: API key per alliance of per speler           │
│                                                         │
│  Opslag: JSONL (data/alliance/*.jsonl)                  │
│  Later optioneel: PostgreSQL                            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Frontend (packetlab.nl/mehrstrom/alliance/)              │
│                                                         │
│  Volledig achter login (Caddy basic_auth)               │
│  ├── Base-lijst (gesorteerd op scan-tijd)               │
│  ├── Base-detail: 9×16 raster, units, levels, posities  │
│  ├── Alliance-overzicht: wie heeft wat gescand          │
│  └── Filter: op level, type (FG base/camp/outpost),     │
│      regio, leeftijd van scan                           │
└─────────────────────────────────────────────────────────┘
```

### Auth-model

| Wie | Wat | Hoe |
|-----|-----|-----|
| Jij (Ghozt) | Dashboard + API | HTTP Basic Auth (bestaand) |
| Alliance members | POST scans | API key (1 key per alliance, gedeeld via game-chat) |
| Alliance members | Bekijk scans online | HTTP Basic Auth op `/mehrstrom/alliance/` (apart van optimizer) |
| Publiek | Niets | Geen toegang tot alliance-data |

---

## Fasering

### Fase 0 — Repo setup
- [ ] `Ghoztmaster/shockr-ta-tools` aanmaken op GitHub (public)
- [ ] README.md met: wat het doet, installatie, credits (Shockr, NetquiK, Ghozt)
- [ ] LICENSE — kies licentie (MIT of GPL, afhankelijk van origineel)
- [ ] De huidige v4.5.3.6 bundel committen als `legacy/` (referentie, niet uitvoerbaar)
- [ ] `.gitignore`, `package.json`, esbuild config

### Fase 1 — Clean-room herschrijving lokale features
Doel: werkend script zonder server-dependency.

- [ ] **ClientLib patching herschrijven** — weg van single-shot regex, naar fingerprint-scan met fallback (bewezen patroon uit MehrStrom Combat Advisor v2.6.0)
  - `$CampType`, `$Id`, `$Level` voor NPCCamp en NPCBase
  - `$OffenseUnits`, `$DefenseUnits` voor CityUnits
  - `$PlayerId`, `$AllianceId`, `$Id` voor WorldObjectCity
  - `$Poll` voor CommunicationManager
- [ ] **CampTracker** herschrijven
  - Markers op wereldkaart bij nieuwe camps/outposts
  - Instelbaar: size, font, fontSize, offense filter, count, alert
  - Chat-alert bij nieuwe spawns
  - Geen externe API-calls
- [ ] **KillInfo** herschrijven
  - Plunder-waarde tooltip bij mouseover in battle view
  - Regex voor `"tnf:full hp needed to upgrade"` → fingerprint-scan
- [ ] **PlayerStatus** herschrijven
  - Alliance-bases kleuren op online-status (online/away/offline/hidden)
  - `extractValueFromFunction` voor `'Color='` → fingerprint-scan
  - Eigen-base kleur onderscheiden van unknown (#ffffff issue)
- [ ] **BugFixer.fixOnUnload()** fixen — alleen qooxdoo handler patchen, niet globale addEventListener
- [ ] **Config** — localStorage-based, `/st config` chat-commando's
- [ ] **CLI** — `/st` chat-commando's voor enable/disable/config
- [ ] **Idle-detectie** — background scans alleen bij 20 min inactiviteit
- [ ] Alle shockr.dev API-calls verwijderd
- [ ] `@match` URL gevalideerd tegen huidige game-client
- [ ] Error handling: chat-melding bij patch-failures

**Deliverable:** werkend .user.js dat alliance members direct kunnen installeren voor CampTracker + KillInfo + PlayerStatus. Geen server nodig.

### Fase 2 — Scanner-backend
Doel: scans ontvangen en opslaan op de MehrStrom VPS.

- [ ] **API endpoint** `POST /api/alliance/scan`
  - Accepteert: base layout (tiles), units (type + level + positie), gebouwen, eigenaar, alliance, coördinaten, worldId, timestamp
  - Auth: API key in header (`X-Alliance-Key`)
  - Validatie: verplichte velden, max payload size
  - Opslag: JSONL (`data/alliance/{worldId}/*.jsonl`)
- [ ] **API endpoint** `GET /api/alliance/bases`
  - Lijst alle gescande bases, gesorteerd op scan-tijd
  - Filter: worldId, type (FG base/camp/outpost/player), min level
  - Auth: Basic Auth (alliance members)
- [ ] **API endpoint** `GET /api/alliance/base/{cityId}`
  - Detail: raster, units, gebouwen, eigenaar, scan-history
  - Auth: Basic Auth
- [ ] **Data model**

```python
# alliance_scan.py
@dataclass
class AllianceScan:
    city_id: int
    world_id: int
    x: int
    y: int
    name: str
    owner: str
    owner_id: int
    alliance: str
    alliance_id: int
    faction: int              # 1=GDI, 2=NOD, 3=Forgotten
    level_base: float
    level_off: float
    level_def: float
    tiles: str                # base62-encoded 9×16 resource raster
    buildings: str            # base62-encoded building list
    defense_units: str        # base62-encoded unit list (type+level+pos)
    offense_units: str        # base62-encoded unit list (if player base)
    upgrades: dict            # unit_id → research level
    scanned_by: str           # player name van de scanner
    scanned_at: str           # ISO timestamp
    version: int              # city version (game's own version counter)
```

- [ ] **Deduplicatie**: als city_id + version al bestaat, overslaan
- [ ] **Retentie**: scans ouder dan 7 dagen archiveren (gzip)
- [ ] **Migratiescript** voor latere PostgreSQL-overstap (compose-snippet + schema)

### Fase 3 — Alliance-website
Doel: online base-layout viewer voor alliance members.

- [ ] **Pagina** `/mehrstrom/alliance/` — volledig achter Caddy basic_auth
- [ ] **Base-lijst**
  - Tabel: naam, level, type, coördinaten, laatste scan, gescand door
  - Sorteerbaar, filterbaar
  - Kleurcodering: vers (<1u), recent (<6u), oud (>6u)
- [ ] **Base-detail**
  - 9×16 grid met resource-tiles (tib groen, crystal blauw, lege cellen grijs)
  - Defense units op het grid (icoon + level)
  - Offense units apart (als beschikbaar)
  - Gebouwen
  - Scan-historie (wanneer, door wie)
- [ ] **Alliance-overzicht**
  - Wie heeft het script actief (laatste scan-tijdstip per speler)
  - Totaal aantal gescande bases per worldId
- [ ] **Stijl**: consistent met bestaand MehrStrom dashboard (grey UI)

### Fase 4 — Script scanner-integratie
Doel: Tampermonkey script POST scans naar jouw server.

- [ ] **LayoutScanner** — herschrijven, POST naar instelbare server URL
  - Standaard: geen server (scanner uit)
  - Configureerbaar via `/st config set api.url https://packetlab.nl/mehrstrom`
  - API key via `/st config set api.key <key>`
- [ ] **AllianceScanner** — zelfde patroon
- [ ] **ScanButton** — "Bekijk online" knop, opent `{api.url}/alliance/base/{cityId}`
- [ ] **Consent**: scanner-features pas actief na expliciete opt-in (`/st plugin enable layout`, `/st plugin enable alliance`)
- [ ] **Feedback**: chat-melding bij succesvolle scan (`[ST] Base gescand: Camp L47 @ 401:600`)
- [ ] **Error handling**: chat-melding bij gefaalde POST, automatische retry met backoff
- [ ] **Pacing**: respecteer server rate limits, geen spam

### Fase 5 — Documentatie & release
- [ ] README.md bijwerken: installatie, configuratie, features, screenshots
- [ ] CONTRIBUTING.md: hoe melden/bijdragen
- [ ] CHANGELOG.md
- [ ] GitHub Releases: v5.0.0 (lokale features), v5.1.0 (scanner)
- [ ] GreasyFork publicatie (optioneel)

---

## Repo-structuur

```
Ghoztmaster/shockr-ta-tools/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── package.json
├── build.js                      # esbuild config
├── legacy/
│   └── shockr-tools-v4.5.3.6.user.js   # originele bundel (referentie)
├── lib/
│   ├── game-ready.js             # hergebruik uit cnc-ta-script-pack
│   ├── clientlib-patch.js        # fingerprint-based patcher
│   ├── cli.js                    # /st chat commands
│   ├── config.js                 # localStorage config
│   ├── idle-detect.js            # player activity tracking
│   ├── city-util.js              # city loading, distance, selection
│   ├── city-scanner.js           # layout + unit extraction
│   ├── packer.js                 # base62, binary, layout, unit packers
│   └── duration.js               # time helpers
├── plugins/
│   ├── camp-tracker.js
│   ├── kill-info.js
│   ├── player-status.js
│   ├── layout-scanner.js         # fase 4
│   ├── alliance-scanner.js       # fase 4
│   └── scan-button.js            # fase 4
├── dist/
│   └── shockr-ta-tools.user.js   # gebundelde output
├── tests/
│   ├── patcher.test.js
│   ├── camp-tracker.test.js
│   └── packer.test.js
└── docs/
    ├── issues.md                 # de 10 issues uit de audit
    └── shockr-original-analysis.md
```

---

## Data-formaat

Het scan-datamodel volgt het originele Shockr-formaat (base62-encoded), zodat bestaande decoders werken:

### Tiles (resource raster)
9×16 grid, 3 bits per cel, base62-encoded per rij. Decode: `(row >> (col * 3)) & 7`.
Waarden: 0=leeg, 1=crystal, 2=tiberium (let op: `GetResourceType` retourneert 2=tib, 1=crystal — omgekeerd aan `EResourceType`).

### Units
Per unit: 8 bits xy (packed: `y * 9 + x`), 9 bits MdbUnitId, 7 bits level. Base62-encoded lijst.

### Gebouwen
Zelfde formaat als units.

---

## Bekende risico's

| Risico | Mitigatie |
|--------|-----------|
| Game-client update breekt patches weer | Fingerprint-scan met meerdere patronen + fallback; chat-melding bij failure |
| EA blokkeert userscripts | Onwaarschijnlijk — 12+ jaar community scripts, nooit geblokkeerd |
| Shockr/NetquiK claimen copyright | Script is community-maintained, geen expliciete licentie; credits in README |
| Alliance members configureren server verkeerd | Duidelijke installatie-instructies, `/st` diagnostiek-commando |
| Scan-data lekt buiten alliance | Alles achter auth, API key per alliance |

---

## Afhankelijkheden van MehrStrom

| Component | Gedeeld? | Details |
|-----------|----------|---------|
| VPS (packetlab.nl) | Ja | Alliance-backend draait naast MehrStrom in dezelfde Docker Compose |
| FastAPI | Ja | Alliance-endpoints in aparte router, zelfde app |
| Caddy | Ja | Aparte basic_auth block voor `/mehrstrom/alliance/` |
| JSONL store | Ja | Aparte directory `data/alliance/` |
| Tampermonkey build | Nee | Apart repo, eigen esbuild, eigen dist/ |
| ClientLib kennis | Ja | Fingerprint-scan patronen hergebruiken uit MehrStrom learnings |

---

## Credits

- **Shockr** (original author) — contact@shockr.dev
- **NetquiK [SoO]** (fork maintainer) — github.com/netquik
- **Ghoztmaster** (rebuild) — github.com/Ghoztmaster

---

## Tijdlijn

Geen deadline — oppakken wanneer er tijd is. Fasering is zo opgezet dat elke fase een bruikbaar resultaat oplevert:
- Na fase 1: alliance members hebben werkend script (lokale features)
- Na fase 2+3: online base viewer
- Na fase 4: volledige shockr-vervanging
