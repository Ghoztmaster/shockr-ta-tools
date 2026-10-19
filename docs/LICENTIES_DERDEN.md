# Licenties van derden — inventaris

Stand: 2026-10-19, na de relicense naar GPL-3.0-or-later (`chore: relicense to GPL-3.0`).
Doel: per bestand vastleggen welke externe code erin zit, van wie, onder welke licentie, en wat er nog moet gebeuren.
**Afronden vóór fase 2 van STABS** (5.28.0).

## Hoe gelezen

- Bron van de licenties: de userscript-headers en de tekst van de originelen, lokale kopieën van NetquiK's pack (`CnCTA-SoO-SCRIPT-PACK`), en de upstream-repo's waar die bestaan (GitHub API).
- "Niet vermeld" = het script noemt zelf geen licentie. Juridisch betekent dat: alle rechten voorbehouden bij de auteur.
- **NetquiK's pack-repo staat als GPL-3.0 op GitHub.** Dat dekt alleen NetquiK's eigen wijzigingen, niet de code van de oorspronkelijke auteurs die hij heeft opgenomen. Een script uit het pack zonder eigen licentieregel is dus niet automatisch GPL.
- Wat niet beschermd is en vrij gebruikt mag worden: ideeën, gedrag, game-feiten (ClientLib-namen, enum-waarden, drempels, formules van het spel zelf) en de aanroepvolgorde van de game-API. Wel beschermd: de code zelf (ook als die vertaald is naar een andere taal), teksten en assets (geluid, iconen).
- Niveau "overgenomen":
  - **code**: structuur/regels overgenomen;
  - **regels**: gedrag of game-logica nagebouwd in eigen code;
  - **feiten**: alleen game-API-routes, getallen of namen.

## Eerst doen (prioriteit)

1. **TABS heeft geen licentie.** Upstream (`Eistee82/ta_simv2`) heeft geen LICENSE en de scriptheader noemt er geen; de "GPL-3.0" komt alleen van NetquiK's pack. Het plan "vanaf fase 2 TABS-code direct overnemen" kan zo niet:
   - óf toestemming van de auteurs (Eistee, TheStriker, VisiG, Lobotommi, XDaast) en van NetquiK voor zijn wijzigingen;
   - óf doorgaan zoals fase 1 (logica lezen, zelf schrijven).

   Gedaan in `chore: relicense to GPL-3.0`: `legacy/README.md` zegt dat TABS geen licentie heeft, het TABS-bestand staat niet meer in git (`legacy/*.user.js` weer in `.gitignore`). Besluit (Wilco, 2026-10-19): geen toestemming vragen; STABS blijft herschrijven zoals fase 1, ook in fase 2 en later.
2. **CC-BY-NC-SA, niet GPL-compatibel:** WarChiefs Sector HUD (Eistee, CC-BY-NC-SA 3.0). `lib/poi-util.js` `sectorNo()` en `plugins/sector-hud.js` `viewCenter()` zijn 1-op-1 overgenomen, tot en met de constante `6.2831853071795862`. Herschrijven vanuit de game-feiten (hoek vanaf het wereldmidden → sector), of Eistee om toestemming vragen.
3. **Assets zonder licentie:** `plugins/pvp-alert-assets.js` bevat letterlijk het sirenegeluid en de twee favicons uit CENTER DRIVEN PvP Alert Status. Vervangen door eigen of vrij gelicenseerde assets (bijv. CC0), of der_flake/XDaast om toestemming vragen.
4. **Code zonder licentie:** Chat Helper Enhanced (regexes en functies "function by function"). Toestemming vragen of de regexes/functies zelf herschrijven.

## Per bestand

| Bestand | Externe bron | Auteur(s) | Licentie bron | Overgenomen | Actie |
|---|---|---|---|---|---|
| `lib/packer.js` | Shockr Tools `blacha/st` (base.n, base.62, pack/*) | Blayne Chard | MIT | code | ✅ geregeld: NOTICE + headerregel |
| `lib/clientlib-patch.js` | `blacha/st` patch.data / client.patcher | Blayne Chard | MIT | code | ✅ geregeld |
| `lib/city-util.js` | `blacha/st` util/city.ts | Blayne Chard | MIT | code | ✅ geregeld |
| `lib/scanner-util.js` | `blacha/st` util/city.scan.ts | Blayne Chard | MIT | code | ✅ geregeld |
| `lib/cli.js` | `blacha/st` st.cli.ts | Blayne Chard | MIT | code | ✅ geregeld |
| `plugins/camp-tracker.js` | `blacha/st` camp.tracker.ts | Blayne Chard | MIT | code | ✅ geregeld |
| `plugins/alliance-scanner.js` | `blacha/st` alliance.scanner.ts | Blayne Chard | MIT | code/regels | ✅ geregeld |
| `plugins/layout-scanner.js` | `blacha/st` layout.ts | Blayne Chard | MIT | code/regels | ✅ geregeld |
| `plugins/player-status.js` | `blacha/st` player.status.ts; kleurschema "maelstrom" uit Maelstrom ADDON City Online Status Colorer | Blayne Chard; White X Dragon, Debitosphere, Der_Flake, NetquiK | MIT; Colorer: niet vermeld | code (blacha); feiten (kleurwaarden) | ✅ blacha geregeld; Colorer: bronvermelding staat er, kleurwaarden zijn feiten — geen actie |
| `lib/bugfix.js` | idee uit `blacha/st` bug.fix.ts | Blayne Chard | MIT | idee (eigen implementatie) | geen |
| `lib/poi-util.js` | WarChiefs Sector HUD `get_SectorNo` | Eistee | **CC-BY-NC-SA 3.0** | code (1-op-1) | **herschrijven** of toestemming |
| `lib/poi-util.js` | Tiberium Alliances Real POI Bonus (`calculateBonus`, directe gevallen) | petui (fix AlkalyneD4, NetquiK) | GPL-3.0-or-later | code (geport) | bronvermelding met licentie toevoegen in de header |
| `lib/poi-util.js`, `plugins/poi-analyser.js` | Info Sticker, MaelstromTools (POI-gegevens) | unicode / NetquiK; Maelstrom e.a. | niet vermeld | feiten | geen (bronvermelding staat er) |
| `plugins/sector-hud.js` | WarChiefs Sector HUD (`get_Coords`, coords-regex, lay-out) | Eistee (fix NetquiK) | **CC-BY-NC-SA 3.0** | code/regels | **herschrijven** of toestemming |
| `plugins/movable-menu.js` | SoO MovableMenuOverlay 1.0.9 | NetquiK | **CC-BY-NC-SA 4.0** | idee (eigen aanpak; header: "Not copied from the original") | regel-voor-regel controleren of er niets letterlijk in staat; dan alleen bronvermelding |
| `plugins/chat-helper.js` | Chat Helper Enhanced Yiannis Mod 3.2.3 | onbekend (Yiannis-mod, fixes NetquiK) | niet vermeld | code (regexes, functies, opslagformaat) | **toestemming vragen** of regexes/functies herschrijven; opslagsleutel/-formaat (compatibiliteit) mag blijven |
| `plugins/pvp-alert.js` | CENTER DRIVEN PvP Alert Status 1.00 | der_flake, fork XDaast | niet vermeld | regels ("port", met fixes) | bronvermelding staat er; code-niveau nalopen |
| `plugins/pvp-alert-assets.js` | idem: favicons + sirenegeluid | der_flake, XDaast | niet vermeld | **assets letterlijk** | **vervangen** door eigen/CC0-assets of toestemming |
| `plugins/loot-summary.js` | MHTools Available Loot Summary + Info 1.8.3.9; MaelstromTools Dev (lootoverzicht) | MrHIDEn (o.b.v. Yaeger, Panavia); Maelstrom, HuffyLuf, KRS_L e.a. | niet vermeld | regels (formule = game-API), lay-out, labelteksten (ook de DE-teksten van Maelstrom) | bronvermelding staat er; eigen DE-labels schrijven i.p.v. die van Maelstrom |
| `plugins/formation-saver.js` | TA Formation Saver 2.x | Panavia, KRS_L, DebitoSphere (NetquiK) | niet vermeld | feiten (client-route) | geen (bronvermelding staat er) |
| `plugins/transfer-all.js` | Transfer All Resources 1.6.2 | KRS_L | niet vermeld | regels + feiten (kindpad, `SelfTrade`) | geen (bronvermelding staat er) |
| `plugins/tunnel-info.js` | TA Tunnel Info 2.2.1.4 | KRS_L (leo7044, NetquiK) | niet vermeld | feiten (data-route, `[tir]`-conventie) | geen (bronvermelding staat er) |
| `plugins/base-info.js` | CENTER DRIVEN Base Info (Basic) 3.23 | XDaast (NetquiK) | niet vermeld | idee | geen |
| `plugins/wavy.js` | Tiberium Alliances Wavy 0.6.2 | petui (NetquiK) | GPL-3.0-or-later | regels ("exactly as TA Wavy") | bronvermelding met licentie toevoegen in de header |
| `plugins/stabs.js`, `plugins/stabs-stats.js` | TABS V2 23.05.31 | Eistee, TheStriker, VisiG, Lobotommi, XDaast (NetquiK) | **niet vermeld** (alleen het pack is GPL-3.0) | regels (fase 1 herschreven, zelfde getallen) | fase 1: geen code overgenomen, zo laten; header "TABS is GPL-3.0" corrigeren; fase 2: zie prioriteit 1 |
| `plugins/kill-info.js`, `plugins/attack-tracker.js` | — | eigen werk | — | — | geen |

### Geen externe code

`lib/api-client.js`, `lib/bootstrap.js`, `lib/config-transfer.js`, `lib/drag.js`, `lib/help.js`, `lib/help-panel.js`, `lib/i18n.js`, `lib/main.js`, `lib/map-overlay.js`, `lib/online-state.js`, `lib/register-panel.js`, `lib/toolbar.js`, `lib/update-check.js`, `plugins/attack-range.js`, `plugins/map-labels.js`, `plugins/repair-guard.js`, `plugins/target-board.js`, `plugins/target-watcher.js`, `plugins/upgrade-calc.js`, `plugins/watchlist.js`.

Voor deze drie bestaat een tegenhanger in `blacha/st` die niet regel voor regel vergeleken is:

- `lib/config.js` ↔ `st.config.ts`
- `lib/game-ready.js` ↔ `util/loader.ts`
- `lib/idle-detect.js` ↔ `st.ts` (online/idle)

Vergelijken. Is er code overgenomen, dan het bestand toevoegen aan NOTICE en de headerregel "Portions derived from" zetten.

## Hoe een actie afronden

- **Bronvermelding:** in de header van het Shockr-bestand: naam + versie van het origineel, auteur(s), licentie, en bij overgenomen code de functie(s). Bij MIT ook de licentietekst (NOTICE).
- **Toestemming:** schriftelijk (issue, forumbericht of mail) met de vraag om de code onder GPL-3.0-or-later te mogen gebruiken; het antwoord bewaren en in deze inventaris noemen.
- **Herschrijven:** het origineel niet open hebben tijdens het schrijven; uitgaan van het gedrag en de game-feiten; tests op gedrag, niet op code.
