# Changelog

## [Unreleased]

## [5.16.0] — 2026-10-13

### Loot-logs per target (website + server, geen userscript-wijziging)
- Nieuw endpoint `GET /api/attacks/targets?worldId=&days=` (website-sessie; ook `since`/`player`/`type` zoals `/api/attacks`): de bestaande gewonnen aanvallen uit `data/attacks/{worldId}.jsonl` gegroepeerd per target-coördinaat - `attackCount`, `players` (uniek, meeste aanvallen eerst), `total*`/`avg*` per grondstof, `avgTotal` (tib + crystal + credits per aanval), `lastAttack` (ISO) + `lastAttackMs`, type/level van de meest recente aanval en `attackList` voor het detail. Geen extra opslag (`AttackStore.targets()` / `per_target()`)
- Nieuwe pagina `/loot` (💰 Loot, in de navigatie van elke pagina tussen 🗡 Attacks en 📌 WatchList): samenvatting = de totalen van de getoonde tabel, elke kolom sorteerbaar (standaard Gem/aanval aflopend), filters speler / periode (vandaag, 3, 7 dagen; standaard 7) / type / min. aanvallen (≥1-≥10, client-side), klik op een rij = de losse aanvallen. Geen data: "Nog geen aanvallen gelogd". EN/DE/NL
- `/attacks` en `/api/attacks` inhoudelijk ongewijzigd (alleen de nav-link erbij; de periode-berekening is gedeeld met het nieuwe endpoint via `_attack_period()`)
- `tests/test_siteinfo.py` leest de versie uit `build.js` i.p.v. een vaste `5.11.0` (faalde al sinds 5.12)

## [5.15.0] — 2026-10-13

### Formation Saver (nieuw, `formation-saver`, standaard aan)
- Vervangt SoO Formation Saver. `/st formation save <naam>` / `load <naam>` / `list` / `delete <naam>`; alleen in het aanvalsscherm met een target open, alleen offense
- Opslag in localStorage (`st-formations`), per wereld, naam uniek (hoofdletterongevoelig, max 30 tekens); opnieuw `save` overschrijft. Per unit: type, naam, level, x/y, aan/uit
- Laden koppelt op TYPE (dichtstbijzijnde level), niet op lijstvolgorde zoals het origineel - zo laadt een formatie ook op een ander target/leger; ontbrekende units worden gemeld ("geladen 12/14, ontbreekt: 2× Predator"). Verplaatsen via `unit.MoveBattleUnit` (terugval `formation.MoveBattleUnit`), meerdere rondes voor ruilen. Nooit InvokeBattle, niets naar de server
- Tests: `tests/formation-saver.test.mjs`

### Wavy (nieuw, `wavy`, standaard aan)
- Vervangt TA Wavy. Onderaan het info-paneel van het geselecteerde object (dezelfde zes widgets als TA Wavy): "Forgotten bases within attack range: 34 (31) · 2 waves" + "Levels: 2×31, 2×30, 4×29, 1×28"
- Telregel van TA Wavy zelf: alleen Forgotten-BASES (geen camps/outposts; een verslagen base is een ruïne en telt niet), euclidisch binnen `get_MaxAttackDistance()`; waves uit het aantal binnen het afgeronde bereik (tussen haakjes): ≤21 → 1, ≤31 → 2, ≤41 → 3, ≤51 → 4, anders 5 - gelijk aan de MehrStrom-drempels. Cache per positie 30 s
- Afstandslijnen: TA Wavy tekent die niet; eigen ontwerp - zolang een info-paneel open is op de wereldkaart een cyaan stippellijn van het geselecteerde object naar elke eigen base binnen 50 cellen, met de afstand
- Niet overgenomen: TA Wavy's hook die verdedigingsrapporten als gelezen markeert (Shockr raakt de inbox niet aan) en de verplaats-modus-weergave
- Tests: `tests/wavy.test.mjs`

## [5.14.0] — 2026-10-13

### Map Labels (nieuw, `map-labels`, standaard aan)
- Labels bij Forgotten-targets (camp/outpost/base) op de wereldkaart: 👁 kijkt (geel), 📌 geclaimd (oranje), ⚔ aangevallen (rood) + spelernaam (> 10 tekens → 9 + …). Per speler alleen de hoogste status (⚔ > 📌 > 👁), meerdere spelers onder elkaar. Gecentreerd onder het target, dus niet over het CampTracker-bolletje (linksboven); font = CampTracker-font × 0,6 (min 11 px) - de volle CampTracker-grootte was te breed voor namen
- Alleen waar het wereldobject nog een Forgotten-target is (Type 2, of Type 3 met `$CampType` ≠ 0) - verdwijnt het target, dan verdwijnen de labels. Nooit op speler-bases. Pollen en tekenen alleen op de wereldkaart
- Bronnen, allemaal bestaand (geen server-wijziging):
  - 👁 `GET /api/target-watch/{worldId}` elke 10 s (de werkorder noemde `POST action list` - die bestaat niet; dit is de bestaande route met spelerauth). Eigen 👁 alleen zolang TargetWatcher dat target nog in beeld heeft (`_currentId`, alleen gelezen) → weg zodra je de base verlaat
  - 📌 `POST /api/watchlist {action:"list"}` elke 60 s
  - ⚔ de eigen rapportkoppen (`GetReportHeaderAll`, alleen lezen, filter `isLoggable` uit AttackTracker), laatste 7 dagen, elke 60 s
- **Beperkingen t.o.v. de werkorder**: 👁 van ANDERE spelers blijft tot 10 min staan (TargetWatcher meldt één keer per base-view, de server bewaart 10 min - "binnen 10-15 s weg" kan alleen met een heartbeat/unwatch op de server). ⚔ van ANDERE spelers ontbreekt: de alliance-aanvallen staan alleen achter `GET /api/attacks`, en die vraagt een website-sessie. Beide vragen een server-wijziging die de werkorder uitsloot
- Tests: `tests/map-labels.test.mjs`

### Tunnel Info (nieuw, `tunnel-info`, standaard aan)
- Vervangt TA Tunnel Info: bij elke tunnel in beeld (`RegionPointOfInterest`, `get_Type() === 0`) een label `T42 · ≥39` (level, offense nodig = level − `get_POIActivationLevelDifference()`) en een gestippelde cirkel van het invloedsbereik. Groen als je sterkste eigen offense het haalt, anders rood (TA Tunnel Info vergeleek met de base die je verplaatst; buiten de verplaats-modus is dat er niet)
- Bereik uit de `[tir]N[/tir]`-tag in de alliance-aankondiging, anders 6 - zoals TA Tunnel Info
- **Niet gebouwd**: "welke target-levels de tunnel spawnt" - dat zit niet in de client-data die TA Tunnel Info leest en er is geen getter voor bekend; niet geschat
- Tests: `tests/tunnel-info.test.mjs`

### Overig
- `main.js` houdt de TargetWatcher als benoemde instantie bij (Map Labels leest hem); TargetWatcher zelf ongewijzigd

## [5.13.0] — 2026-10-13

### Scanner-pauze bij online: twee gaten gedicht
- Melding: LayoutScanner/AllianceScanner pauzeerden niet bij OnlineState 1. De bedrading (`lib/online-state.js`, send-gate uit 5.12.1) bestond wel; twee zwakke plekken:
  - De eigen OnlineState komt uit `alliance.get_MemberData()`, die alleen vers is na `RefreshMemberData()` - en die riep alleen PlayerStatus aan. Met PlayerStatus uit bleef de stand op de waarde van bij het inloggen staan. De watcher ververst nu zelf elke 30 s (elke 3e poll)
  - `online.start()` stond helemaal aan het eind van de startup, na alle plugins en CLI-commando's; gooide daar iets, dan draaide de watcher nooit (= nooit gepauzeerd). Hij start nu direct na het aanmaken, vóór de plugins
- `/st status` toont een regel met de scannerstand (gepauzeerd / actief / status niet leesbaar / bewaking draait niet) - voor de live-controle
- Console ongewijzigd: `[ST] Scanner paused (player online)` / `[ST] Scanner resumed (...)`. Tests: `tests/online-state.test.mjs`
- NIET live geverifieerd: of één van deze twee de oorzaak was; controleer met `/st status` terwijl je online bent

### Base Info (nieuw, `base-info`, standaard aan)
- Vervangt "CENTER DRIVEN Base Info": bij speler-bases op de wereldkaart een label `#2 23.4/21.0` (nummer per speler, offense/defense)
- Off/def via `city.get_LvlOffense()`/`get_LvlDefense()` - die bestaan alleen voor bases die de client geladen heeft (eigen bases; andere zodra je ze één keer selecteert). Anders alleen het nummer
- Nummering: stad-id oplopend; eigen bases uit de volledige stedenlijst, andere spelers over de bases die deze sessie in beeld zijn geweest
- Tests: `tests/base-info.test.mjs`

### Attack Range (nieuw, `attack-range`, standaard aan)
- Vervangt "TA Attack Range": een gestippelde cirkel rond elke eigen base op de wereldkaart
- Straal = `get_Server().get_MaxAttackDistance()` (euclidisch, zelfde maat als de camp-tracker/scanners). Afwijking van de werkorder: die noemde een straal "op basis van het offense-level", maar het aanvalsbereik is in TA een serverconstante, niet offense-afhankelijk
- Tests: `tests/attack-range.test.mjs`

### Gedeeld
- `lib/map-overlay.js`: wereldkaart-overlayhelpers (zichtbaar bereik, cel → scherm, events). CampTracker is bewust niet omgezet

## [5.12.1] — 2026-10-12

### Scanner-pauze houdt ook de verzendwachtrij vast
- Bug: na "[ST] Scanner paused (player online)" gingen er alsnog scans naar de server ("[ST] API: 7 scan(s) sent") - de pauze stopte wel nieuwe scans, maar niet de wachtrij van `ApiClient` (flush-timer, de eigen `flush()` van een scanner, een batch die al verstuurd werd)
- Zolang de scanners gepauzeerd zijn gaat er geen `/api/scan`-request meer uit: `send()` buffert, `flush()` doet niets, en een lopende batch stopt vóór de volgende scan (de rest gaat terug in de wachtrij). Console: `[ST] API: sending held (scanner paused) — N scan(s) buffered`, één keer per pauze
- Bij hervatten gaat de buffer in de oorspronkelijke volgorde de deur uit (`[ST] API: sending resumed — N buffered scan(s)`), met dezelfde pacing van 2 s per request
- Losse requests (TargetWatcher, WatchList, AttackTracker) worden niet vastgehouden. De buffer staat in het geheugen; een herlaad van de pagina tijdens de pauze gooit hem weg (zoals de wachtrij altijd al deed)
- Tests: `tests/api-hold.test.mjs`

## [5.12.0] — 2026-10-12

### Standaard-plugins
- **TargetWatcher** staat voortaan standaard **aan** voor nieuwe installaties (was uit). **LayoutScanner** stond al standaard aan — ongewijzigd
- Bestaande installaties houden hun huidige stand: bij de eerste start van 5.12.0 wordt een niet-gezette `targetwatcher.enabled` vastgezet op de oude standaard (uit); wie hem zelf aan- of uitzette, houdt die keuze. Nieuw = geen `st-config` in localStorage bij het laden (`Config.isNew`, `Config.pinChangedDefaults`)
- Tests: `tests/config-defaults.test.mjs`

## [5.11.0] — 2026-10-11

### WatchList — vaste targets claimen (userscript + server + website + nginx, VPS)
- Nieuwe plugin **WatchList** (standaard aan, `/st plugin disable watchlist`). Anders dan Target Watcher (automatisch, 10 min "ik kijk hiernaar") is een claim handmatig en blijft hij staan tot je hem verwijdert, een aanval erop wint of 24 uur verstreken zijn
- `/st watch` claimt het geselecteerde target: op de wereldkaart de selectie (`get_SelectedObject`), in de base-view de base in beeld. Alleen Forgotten camp/outpost/base; type + level uit het wereldobject (`$CampType`/`$Level`). Chat + console: `[ST] WatchList: outpost lvl 18 @ 84:293 claimed`
- Al geclaimd door een ander → `⚠ this target is already claimed by OzookerO`, er wordt niets opgeslagen. `/st watch force` claimt toch: je claim komt **naast** de zijne (die van de ander wordt nooit verwijderd — "één claim per speler per coördinaat")
- `/st unwatch` (geselecteerd target) en `/st unwatch all` (al je claims in deze wereld)
- Waarschuwing bij bekijken: een lokale 2,5 s-timer leest het geselecteerde target; staat het op de WatchList van een ander → één regel per target-view `[ST] ⚠ This target is claimed by OzookerO (2 hours ago)`. De claimlijst komt via `POST /api/watchlist {action:"list"}`, hooguit 1× per minuut en alleen als er een FG-target in beeld is; pauzeert tijdens een scan (scan-lock)
- Automatisch weg: wint AttackTracker een aanval op een target dat je geclaimd had, dan haalt de server je claim weg (alleen claims van vóór de aanval) en meldt hem in het `/api/attack`-antwoord (`unclaimed`, alleen als er iets weg is — anders is het antwoord ongewijzigd); de plugin zegt `outpost @ 84:293 defeated — claim removed`. AttackTracker kreeg alleen die hook (`onUnclaimed`), verder ongewijzigd
- Server: `POST /api/watchlist` (X-Player-Key; `action` claim / unclaim / unclaim_all / list — `list` is een POST zodat het ene nginx-CORS-blok volstaat), `GET /api/watchlist?worldId=` en `DELETE /api/watchlist/{id}` (sessie-cookie; alleen eigen claims, anders 403), `DELETE /api/admin/watchlist/{id}` (elke claim; Basic Auth bij nginx bovenop de sessie). Opslag in het geheugen + `data/watchlist/{worldId}.json` (atomisch herschreven), claims verlopen na 24 uur
- Website: pagina **📌 WatchList** (`/watchlist`, in de navigatie tussen 🗡 Attacks en ℹ Info op alle pagina's): speler, type, level, coördinaten, geclaimd, verloopt; filters speler/type; ✕ bij eigen claims; vinkje "Admin" toont ✕ bij alle claims (browser vraagt het admin-wachtwoord); EN/DE/NL
- nginx: CORS-blok `location = /shockr/api/watchlist` + admin-blok, zie docs/DEPLOY.md §10
- Ongewijzigd: Target Watcher, scan/enrollment, Attack Tracker-logica
- Tests: `tests/test_watchlist.py`, `tests/watchlist.test.mjs`

## [5.10.0] — 2026-10-10

### Alliance Attack Tracker (userscript + server + website + nginx, VPS)
- Nieuwe plugin **AttackTracker** (standaard aan): leest elke 2 min de eigen gevechtsrapporten (`GetReportHeaderAll` type 1, alleen lezen — nooit gelezen-markeren of verwijderen) en meldt elke **gewonnen** aanval (`s`) op een **Forgotten** camp/outpost/base (`tp` 2 = NPCRaid; `dbn` 1-2 camp, 3 outpost, 4 base) via `POST /api/attack`: type, level, coördinaten, buit tib/crystal/credits (`RequestReportData` + `ReportDelivered`, één tegelijk, 1 s ertussen). Verloren aanvallen, PvP, fortress/event worden niet verstuurd
- Console bij succes: `[ST] Attack logged: outpost lvl 18 @ 84:293`. Buffer in localStorage (`st-attacks-outbox`), max 1 POST per 5 s met tot 20 aanvallen; mislukte POST blijft staan voor de volgende flush (na 5 mislukkingen weg). Dedup: laatste 100 rapport-id's per wereld (`st-attacks-done-<world>`); een verse installatie neemt de laatste 7 dagen mee
- Server: `POST /api/attack` (X-Player-Key, één aanval of een lijst van max 50; extra veld `reportId`), opslag `data/attacks/{worldId}.jsonl` met playerId/playerName/receivedAt, dedup op speler + target + ±60 s (en reportId), 7 dagen bewaard, oudere regels weg bij het opstarten
- `GET /api/attacks?worldId=&days=|since=&player=&type=` (website-sessie): aanvallen, totalen en een **per-tunnel overzicht** — aanvallen binnen 10 velden van een centrum (het meest aangevallen target begint een cluster); per tunnel aantal, buit en bijdrage per speler
- Website: pagina **🗡 Attacks** (`/attacks`, link naast 🎯 Target Watch op beide pagina's): samenvatting, tunnelkaarten met per-speler-bijdrage, uitklapbare detailtabel, filters speler / vandaag-3-7 dagen / type; EN/DE/NL
- nginx: nieuw CORS-blok `location = /shockr/api/attack`, zie docs/DEPLOY.md §9
- Ongewijzigd: scan, target-watch, login, enrollment
- Tests: `tests/test_attacks.py`, `tests/attack-tracker.test.mjs`

### Fix: player_keys.jsonl één regel per speler (server, VPS)
- Herregistratie (`/st register`) en intrekken (`DELETE /api/enroll/{id}`) voegden een regel toe; de oude regel (met de oude key-hash) bleef in het bestand tot de volgende herstart. Nu overschrijven ze de regel van die speler: het hele bestand wordt atomisch herschreven (tijdelijk bestand + rename)
- Oude bestanden met meerdere regels per speler worden nog gelezen: per speler wint de nieuwste `createdAt`/`revokedAt` (niet meer de laatste regel; bij gelijke tijd wel de laatste regel), en het bestand wordt bij het opstarten opgeschoond
- Geen gedragsverandering voor spelers: ook vóór de fix gold in het geheugen al de nieuwste key. Tests: `tests/test_player_keys.py`

## [5.9.0] — 2026-10-10

### API key zichtbaar na registratie (userscript)
- `/st register`: na succes toont de popup de persoonlijke key in een alleen-lezen veld met een Copy/Kopieren/Kopiëren-knop (clipboard-API, terugval select + `execCommand('copy')`) en de tekst "This is your personal API key. Copy it now — you can see it again later with /st config get api.playerkey. …" in EN/DE/NL (volgt `/st config set language`)
- De popup sluit niet meer vanzelf na 2 s, maar pas op Close/Schließen/Sluiten (of ✕ / Escape)
- `/st config get api.playerkey` toont de echte key i.p.v. "set" (alleen een lokaal systeembericht in de eigen chat); `config list` en `config set` tonen hem nog steeds als set/not set

### Website in EN/DE/NL (server, VPS)
- Nieuw `server/static/i18n.js`: alle vaste tekst op login, base-overzicht (incl. detailpaneel) en Target Watch in Engels, Duits en Nederlands; vlaggen 🇬🇧 🇩🇪 🇳🇱 rechtsboven, keuze in localStorage (`shockr_lang`), zonder keuze de browsertaal (de/nl) en anders Engels. Wisselen vertaalt direct, zonder herladen
- Login-pagina: labels, placeholders, knop en foutmeldingen (onbekende speler/ongeldige key, te veel pogingen, server onbereikbaar) vertaald; "Ingelogd als: … [Uitloggen]" ook
- Spelbegrippen (Camp/Outpost/Base, factie- en unitnamen, Lv) blijven zoals het spel ze toont
- `GET /static/{name}` serveert alleen `session.js` en `i18n.js` (whitelist), publiek zodat de login-pagina vertaald is vóór er een sessie is

### Website login via persoonlijke API key (server + nginx, VPS)
- Vervangt het gedeelde Basic Auth-wachtwoord op `/shockr/`: inloggen op `/shockr/login` met speler-naam + de API key uit `/st register`
- `POST /api/login {playerName, apiKey}` → sessie-cookie `shockr_session` (HttpOnly, Secure achter https, SameSite=Lax, 7 dagen, in het geheugen — na een herstart opnieuw inloggen); fout → 401 `{"error": "Onbekende speler of ongeldige key"}`; max 10 pogingen/IP/minuut
- `POST /api/logout` (sessie + cookie weg, redirect naar login), `GET /api/me` (ingelogde speler)
- Key-check via dezelfde `PlayerKeyStore.verify()` als `X-Player-Key`; naam hoofdletterongevoelig. Een sessie vervalt direct als de key wordt ingetrokken (`DELETE /api/enroll/{id}`) of opnieuw uitgegeven
- Pagina's `/` en `/targets` zonder sessie → redirect naar login; viewer-API (`/api/bases`, `/api/base/{id}`, `/api/targets`) zonder sessie → 401 (de pagina gaat dan naar login)
- Rechtsboven op beide pagina's "Ingelogd als: <naam> [Uitloggen]" (`static/session.js`)
- Ongewijzigd: enrollment, `player_keys.py`, scan/target-watch op `X-Player-Key`, CORS, website-inhoud. Admin-endpoints (`/api/members`, `DELETE /api/enroll/{id}`) blijven Basic Auth — **nginx moet die nu expliciet afschermen**, zie docs/DEPLOY.md §8
- Geen userscript-wijziging, dus geen versiebump. Tests: `tests/test_web_auth.py`

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

### Unit-symbolen in het base-detail grid (website, VPS)
- Elk unit-vakje in het layout-grid toont symbool + level (bv. `✕12`, `◆18`); past dat niet in de cel (> 4 tekens), dan alleen het symbool. De tooltip toont nu volledige naam, level en positie, in elke modus
- Vier modi via een dropdown naast "Base Layout": Afkortingen (AT, MS, RF, …) / Emoji (🛡 👤 🚗 💣 ✈️) / Kleur (gekleurde badge + eerste letter) / **NATO (standaard)** (▬ ✕ ◆ ● △). Wisselt zonder herladen, keuze in localStorage (`shockr_unit_symbol_mode`)
- Defense- en offense-lijst: symbool vóór de naam, plus een legenda per unit-type met aantal
- Categorie uit `UNIT_SYMBOL_MAP` op displayName/name (prefix `FOR_`/`GDI_`/`NOD_` en `_` genegeerd). Onbekende units: `?` / eerste 2 letters / 🔲 / eerste letter; oude scans zonder namen: fallback-symbool + "ID 192"
- Puur frontend (`server/static/index.html`); grid-nummering, unit-namen, scan- en opslaglogica ongewijzigd. Geen userscript-wijziging, dus geen versiebump

## [5.8.0] — 2026-10-05

### Scanner auto-pause bij online-status
- LayoutScanner en AllianceScanner starten geen automatische scan zolang de eigen status **Online** (OnlineState 1) is; bij Away (2) of Offline (0) hervatten ze. Een batch die al loopt maakt zijn scan af. Geldt niet voor de TargetWatcher
- Console: `[ST] Scanner: gepauzeerd (speler online)` / `[ST] Scanner: hervat (speler away)` (of `offline`) — één regel per overgang, één gedeelde watcher (`lib/online-state.js`, elke 10 s)
- Bij hervatten start meteen een scan als de speler ook idle is (de 20-min-idle-regel blijft gelden); handmatige `/st scan` en `/st scanalliance` blijven altijd werken
- Bron eigen status: `alliance.get_MemberData().d[eigen id].OnlineState` (zelfde veld als player-status), anders `get_Player().get_OnlineState()` (niet live geverifieerd). Niet leesbaar → nooit gepauzeerd, één waarschuwing
- `npm test` draait nu `node --test` (de oude `node --test tests/` werkt niet op Node 24); eerste test: `tests/online-state.test.mjs`

## [5.7.1] — 2026-10-05

### Fixes
- **Alliance scanner: geen 429-bursts meer** — `ApiClient` stuurt hooguit één `/api/scan` per 2 s (ook als twee flushes tegelijk starten: die wachten nu op elkaar). Bij een 429: backoff 5 s, 10 s, 20 s; blijft de server 429 geven, dan gaan deze en de resterende scans terug in de wachtrij voor de volgende flush in plaats van door te hameren
- **Target-watch: geen POST met -1-coördinaten** — als `targetX` of `targetY` geen geldige positie (≥ 0) is, wordt de POST overgeslagen

## [5.7.0] — 2026-10-04

### Unit-namen op de base-detail pagina
- **Userscript:** de scan stuurt `unit_names` mee: per unit-type (mdb-id) `{name, displayName}` uit `info.n`/`info.dn` (bron: `get_UnitGameData_Obj()`, dan `GAMEDATA.units[id]`, dan `ClientLib.Res.ResMain.GetInstance().GetUnit_Obj(id)`). Een unit waarvan geen naam te lezen is valt eruit; de scan zelf gaat altijd door. De gepakte unit-strings (`defense_units`/`offense_units`) zijn ongewijzigd
- **Server (VPS):** `ScanPayload.unit_names` is optioneel (oude clients sturen het niet), `GET /api/base/...` geeft het terug
- **Website (VPS):** units tonen `displayName`, anders `name`, anders `ID {type}` (oude scans); het layout-grid heeft kolomnummers (0-8) bovenaan en rijnummers links, 0-based zoals de game telt

## [5.6.1] — 2026-10-03

### Target Watch: 422 Unprocessable Entity
- **Userscript:** the watch payload reads the player via `get_Id()`/`get_Name()` first (same order as `readPlayer()` in api-client), skips the tick while id/name are unknown, and sends every field typed and bounded as `TargetWatchPayload` expects (integers, names trimmed and cut to 50 chars) - an undefined `player.id`/`.name` is dropped by `JSON.stringify`, which the server answers with 422
- **Userscript:** a 422 from any one-off API request now logs the server's `detail` (which field was rejected) in the console, not just the status
- **Server (VPS):** a rejected `POST /api/target-watch` is logged as `target-watch 422 from player <id>: <field>: <reason> (got ...) | body: ...`; the 422 response itself is unchanged (FastAPI's default handler)
- Root cause not confirmed live yet - if the 422 persists after the update, the server log line names the field

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
