# Analyse: TA_BaseShare.user.js

Datum: 2026-10-15. Bron gelezen, niet live getest; uitspraken over fingerprints zijn afgeleid uit de code, niet geverifieerd in de huidige client.

## Gevonden versies

| Pad | Versie | Opmerking |
|---|---|---|
| `mehrstrom/reference/CnCTA-soo-SCRIPT-PACK/TA_BaseShare.user.js` | 22.07.22 (NetquiK) | Origineel, 501 regels. **Basis van deze analyse.** |
| `mehrstrom/tampermonkey/scripts TA/TA_BaseShare.user.js` = `cnc-ta-script-pack/scripts TA/…` | 22.07.22 | Zelfde, maar beide project-exception-calls uitgecommentarieerd (`console.warn … external lookup/upload disabled`). |
| `…/dist/TA_BaseShare.user.js` (beide repos) | 22.07.22 | Gebundelde build van de gecensureerde variant. |
| `cnc-ta-script-pack/vendor/leo7044/BaseShare.user.js` | 2021.01.16 (leo7044) | Volledige oudere versie, geminificeerd op ~30 regels. Géén loader-stub (zoals `plan-van-aanpak.md` stelt). Verschilt alleen in fingerprint-regexen, knoppositie en attack-knop-logica. |

`legacy/` in deze repo bevat het script niet. Auteur: TheStriker, contributors leo7044 en NetquiK.

## Wat het script doet

**Kort:** het deelt geen layouts in de zin van een layout-string of link. Het is een crowdsourced cache van de **ruwe `OCITY`-serverdata** van Forgotten-basissen. Spelers uploaden wat ze binnen bereik zien; anderen krijgen die data voor basissen **buiten hun aanvalsbereik** in hun client geïnjecteerd, zodat ze die basis toch kunnen openen of simuleren.

### Features

1. **Scan (knop of na een basisverplaatsing).**
   - Voor elke eigen basis worden alle wereldcellen binnen `get_MaxAttackDistance()` (Euclidisch, inclusief) afgelopen. Elk object met `Type === NPCBase` wordt verzameld als `[id, -1, "", "x:y"]`. Dat zijn alleen FG-basissen, geen camps of outposts.
   - De `OCITY`-requester en -receiver van de client worden tijdelijk gekaapt. Per batch van 75 ids wordt een eigen requeststring `id:version:amCount\fOCITY:…` meegegeven met de normale poll. De server stuurt dan de volledige city-data terug **zonder dat de client van view wisselt**.
   - Elk antwoord gaat door een losse `new ClientLib.Data.City().$ctor(0)` met `.Update(data)`. Ghost-bases en bases zonder modules of met 0% gebouwconditie worden gefilterd (alleen gelogd; ze blijven wel in `cityData`).
   - Daarna worden de originele requester en receiver (`Cities`/`UpdateCity`) hersteld, en gaat **de complete `cityData`-map** (alles wat deze sessie ooit is gezien) als POST naar `project-exception.net/download/script/base.php`: `{action:"send", worldid, worldname, data}`.
2. **Ophalen buiten bereik (patch op `RegionCityMenu`).** Bij `showMenu` en bij elke `onTick` van het regio-menu wordt het volgende gedaan als het geselecteerde object een `RegionNPCBase` is, onaangetast (defense en buildings 100%) én verder weg dan `MaxAttackDistance` van al je eigen basissen:
   - GET `base.php?wid=&bid=&aid=&pid=&pn=` (wereld, base-id, alliance-id, player-id en **spelernaam**);
   - is de gedeelde versie nieuwer dan `city.get_Version()`, dan volgt `get_Cities().UpdateCity(null, {l:[data]})`. De gedeelde data wordt zo in de client gezet alsof de server hem stuurde.
3. **Attack-knop forceren.** De knop met `"!"` in het label (de SoundButton in een Composite van `RegionCityMenu`) wordt `setEnabled(true)`: altijd voor spelerbases, en voor FG-bases zodra er gedeelde data is. Dit is puur client-side; de server dwingt het bereik nog steeds af. Doel: de aanvalsopstelling of simulatie openen voor bases buiten bereik.
4. **Auto-scan na verplaatsen.** De callback van `City.MoveTo` wordt omgehangen; 1 s na het resultaat volgt `Scan()`.

### UI-elementen

- Eén `qx.ui.form.Button` met het icoon `webfrontend/ui/icons/efficiency_icons/icon_efficiency_target_range.png` (40px via `resizeIcon`). Hij staat op de desktop rechts naast de RightBar, met de tooltip "BaseShare". Tijdens het scannen is hij disabled.
- Knoppositie met overlap-correctie: als `leoStats`/`BaseScanner` of `BaseInfo` aanwezig is, schuift de knop onder die knoppen (NetquiK-mod).
- Verder geen panelen, instellingen of vertalingen. Feedback alleen via `console`.

### Netwerkverkeer

| Wanneer | Request | Gegevens |
|---|---|---|
| Na elke scan | `POST https://project-exception.net/download/script/base.php` | `worldid`, `worldname`, alle verzamelde ruwe `OCITY`-objecten |
| Bij openen of elke tick van het menu op een FG-base buiten bereik (1× per base per sessie, retry na 30 s) | `GET …/base.php?wid&bid&aid&pid&pn` | wereld-id, base-id, **alliance-id, player-id, spelernaam** |
| Scan | Game-server `OCITY`-poll (via de eigen requester) | 75 city-ids per batch |

## Gebruikte game-client functies

### Publieke (leesbare) API

| Object | Functies |
|---|---|
| `ClientLib.Data.MainData.GetInstance()` | `get_Server()`, `get_World()`, `get_Cities()`, `get_Alliance()`, `get_Player()` |
| `Server` | `get_WorldId()`, `get_Name()`, `get_MaxAttackDistance()` |
| `Alliance` / `Player` | `get_Id()` / `get_Id()`, `get_Name()` |
| `Cities` | `get_AllCities().d`, `get_CurrentCity()`, `UpdateCity(null, {l:[…]})` (ook als `OCITY`-receiver) |
| `City` | `get_PosX/Y()`, `get_Name()`, `get_Id()`, `get_OwnerId()`, `get_Version()`, `get_IsGhostMode()`, `GetBuildingsConditionInPercent()`, `get_ActiveModules()`, `MoveTo`, `new ClientLib.Data.City().$ctor(0)` |
| `World` | `GetObjectFromPosition(x, y)` → `.Type` |
| `ClientLib.Data.WorldSector.ObjectType.NPCBase` | type-enum |
| Vis-object (`RegionNPCBase`) | `get_VisObjectType()`, `get_RawX/Y()`, `get_ConditionDefense()`, `get_ConditionBuildings()` |
| `ClientLib.Vis.VisObject.EObjectType.RegionNPCBase` | type-enum |
| `ClientLib.Vis.VisMain.GetInstance()` | `get_Mode()`, `set_Mode()` (wisselt kort naar `Mode.Region` en terug om sectoren te laden) |
| `ClientLib.Net.CommunicationManager.GetInstance()` | `RegisterDataRequester("OCITY", obj)`, `RegisterDataReceiver("OCITY", delegate)` |
| `ClientLib.Net.UpdateData`, `phe.cnc.Util.createEventDelegate` | delegate voor de receiver |
| `webfrontend.gui.region.RegionCityMenu.prototype` | `showMenu`, `onTick` (gewrapt); interne velden `basename`, `getChildren()`, `getLabel()` |
| `qx.core.Init.getApplication()` | `getDesktop()`, `getRightBar()`, `getMenuBar()` |

### Obfuscated (via fingerprint gevonden)

| Leesbare naam (alias) | Waar | Fingerprint 22.07.22 | Status |
|---|---|---|---|
| `Cities.<OCITY-requester>` (`GetData`) | methode op `ClientLib.Data.Cities.prototype` | `FindMethod(…, /OCITY/)`: eerste functie die de string `OCITY` bevat | Robuust (zoekt op een stringliteral), maar "eerste match" is niet gegarandeerd de requester. **Niet geverifieerd.** |
| `WorldObjectNPCBase.get_Id` | eigenschap in `$ctor` | `/this\.([A-Z]{6})=\(\w\.\$\w=\$I\.[A-Z]{6}\.[A-Z]{6}\(\w,\w,\w\),\w=\w.\w,\w\.\$\w\)[,;](?:return\s)?this;?}/`, het **laatste** veld vóór `return this` | Waarschijnlijk kapot of fout. Shockr moest in 2026-09 voor hetzelfde veld een nieuw patroon maken: de **eerste** onvoorwaardelijke `…JTCQOG`-toewijzing (`lib/clientlib-patch.js`, `$Id`). |
| `City.Update` | methode op `ClientLib.Data.City.prototype` | `FindMethod(…, /Math\.(?:floor\|round)\([a-z]+\.adb\)/)` (`adb` = veld in de OCITY-payload) | Onbekend; Shockr gebruikt dit niet. |
| `City.MoveToResult` | callback-methode van `MoveTo` | `/\.[A-Z]{6}\(this\,this\.([A-Z]{6})\)/` in `MoveTo.toString()` | Onbekend. |

## Herbruikbaar voor Shockr Tools

| Onderdeel | Waarde | Toelichting |
|---|---|---|
| **Batch-ophalen via een eigen `OCITY`-requester** | Hoog, met voorbehoud | Haalt 75 FG-basissen per poll op **zonder view-switch**. Shockr's `layout-scanner`/`alliance-scanner` doen nu `set_CurrentCityId` + `waitForCity` per basis met 2 s pauze, met flikkering en het terugzetten van de view als gevolg. Dit zou de scan veel sneller en onzichtbaar maken. Het moet wel opnieuw gebouwd worden met een gegarandeerd herstel (zie "Niet bruikbaar": een vastgelopen scan laat de client zonder OCITY-updates achter). Eerst live verifiëren met een probe. |
| Losse city-instantie: `new ClientLib.Data.City().$ctor(0)` + `Update(data)` | Middel | Ruwe OCITY-data omzetten naar een `City` waar `extractScan(city)` (`lib/scanner-util.js`) direct mee werkt, zonder de echte `Cities`-collectie te raken. |
| Filter op ghost, 0% conditie en geen modules | Laag | Klein; is ook een zinnige extra skip-check in de layout-scanner. |
| Scan-trigger na `MoveTo` | Laag–middel | Na een verplaatsing staan er nieuwe FG-bases binnen bereik. Kan in Shockr zonder het obfuscated callback te patchen: positie van eigen basissen vergelijken bij de bestaande idle-check. |
| Desktop-knop met overlap-correctie | Laag | Shockr heeft `movable-menu.js`; dit is alleen nuttig als referentie voor de posities van andere scripts (`leoStats`, `BaseInfo`). |
| "Out-of-range layout bekijken" als **idee** | Middel | Shockr's server heeft de layouts al (`/api/base/{city_id}`). Een eigen variant zou die van de eigen alliance-server tonen in een Shockr-paneel, zonder data in de client te injecteren. |

**Encoding:** er valt niets over te nemen. BaseShare stuurt ruwe JSON; Shockr's `lib/packer.js` (Base62/Layout/Binary/UnitPacker) is al compacter en compatibel met de server.

## Niet bruikbaar

| Onderdeel | Reden |
|---|---|
| Alle verkeer naar `project-exception.net` | Third-party, niet van ons. Lekt spelernaam, player-id en alliance-id bij elke klik op een FG-base buiten bereik, en uploadt alle gescande bases. Al uitgeschakeld in de mehrstrom/script-pack-kopie. |
| `UpdateCity(null, …)` met data van buiten | Injecteert data van een derde partij in de client-state alsof de game-server die stuurde. Er is geen validatie: een kwaadwillende of verouderde server bepaalt wat de client denkt. |
| Attack-knop forceren | Omzeilt client-side UI-restricties. Dat valt buiten wat Shockr wil doen, het dwingt server-side niets af, en het is mogelijk in strijd met de spelregels. |
| OCITY-kaping zoals geïmplementeerd | `UpdateData`/`ReceiveData` keren terug zonder nieuwe timeout zolang er één id ontbreekt. Antwoordt de server niet voor één basis, dan wordt `StopScan` nooit bereikt: de eigen requester en receiver blijven staan en **de echte city-updates van de client stoppen** tot een reload. |
| `cityData` | Groeit onbeperkt en wordt elke scan in zijn geheel geüpload. |
| Fingerprints `get_Id` / `Update` / `MoveToResult` | Enkelvoudige regexen zonder fallback. `get_Id` matcht vermoedelijk niet (meer) of het verkeerde veld (zie tabel). Shockr's `clientlib-patch.js` met meerdere patronen per eigenschap is beter. |
| Patroon van injectie via `<script>` + `killMe()` | Verouderd; Shockr bouwt als één bundle met `lib/bootstrap.js`. |
| `onTick`-wrap van `RegionCityMenu` | Draait elke tick en loopt bij de eerste keer door alle velden van het menu. Breekbaar (`basename`, `"!"`-label) en vervuilt het prototype globaal (`showMenuAttPatch`, `updateAtkBtn`). |
| `set_Mode(Region)` heen en terug | Hack om sectoren te forceren; neveneffect op de view. |
| Impliciete global `posData` | Slordig; zou in strict mode crashen. |

## Overlap met Shockr

| BaseShare | Shockr | Verschil |
|---|---|---|
| FG-basissen binnen aanvalsbereik zoeken | `lib/city-util.js` `getAllNearbyObjects()` / `getObjectsNearCity()` | Zelfde aanpak (`GetObjectFromPosition` binnen `MaxAttackDistance`). Shockr neemt ook camps en outposts mee en dedupliceert op `get_Version()`. |
| City-data ophalen | `plugins/layout-scanner.js` (view-switch + `waitForCity`) | BaseShare is sneller (OCITY-batch); Shockr is veiliger maar langzaam en zichtbaar. |
| Layout opslaan en delen | `lib/scanner-util.js` `extractScan()` + `lib/packer.js` → `POST /api/scan` op de eigen alliance-server | Shockr deelt binnen de eigen alliance met API-key en sessie; BaseShare publiek met een third party en ruwe data. |
| Bases van alliance-leden | `plugins/alliance-scanner.js` (`GetPublicPlayerInfo`) | BaseShare heeft dit niet. |
| Shared layout bekijken | Webpagina's (`/targets`, `/api/base/{id}`) | BaseShare toont het in de game-client via injectie; Shockr alleen op de website. |
| `$Id` van een NPC-base | `lib/clientlib-patch.js` (`WorldObjectNPCBase.$Id`, 2 patronen) | Shockr's patroon is actueel (2026-09); dat van BaseShare waarschijnlijk niet. |
| Trigger na basisverplaatsing | Geen | Shockr scant alleen bij idle of handmatig. |

## Aanbeveling

1. **Niet overnemen** als script of als plugin, ook niet in de gecensureerde vorm: zonder project-exception doet het niets nuttigs behalve de geforceerde attack-knop.
2. **Wel onderzoeken:** de OCITY-batch-techniek als snellere, onzichtbare data-bron voor `layout-scanner`. Begin met een probe in `docs/probes/` die meet of een eigen requester volledige FG-data teruggeeft, en of het herstel van de requester en receiver met `try/finally` plus timeout betrouwbaar is. Bouw pas daarna.
3. Optioneel later: de layouts van de eigen server tonen voor een FG-base buiten bereik, in een Shockr-paneel en zonder client-injectie.
