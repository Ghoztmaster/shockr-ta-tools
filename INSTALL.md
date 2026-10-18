# Installatie-handleiding / Installationsanleitung

## 🇳🇱 Nederlands

### Wat doet dit script?

- **CampTracker** — genummerde markers bij nieuwe camps en outposts op de wereldkaart + chat-alert bij nieuwe spawns
- **KillInfo** — plunder-paneel (Tib + Crystal per unit en totaal) bij het selecteren van een Forgotten base
- **PlayerStatus** — alliance-bases gekleurd op online-status: groen = online, geel = away, grijs = offline, rood = vijand

### Stap 1: Tampermonkey installeren

Tampermonkey is een browser-extensie die userscripts beheert.

1. Ga naar [tampermonkey.net](https://www.tampermonkey.net/)
2. Klik op de knop voor jouw browser (Chrome, Firefox, Edge)
3. Installeer de extensie
4. Je ziet nu een zwart vierkant icoontje rechtsboven in je browser

### Stap 2: Script installeren

1. Download het bestand `shockr-ta-tools.user.js` (je krijgt het van Ghozt of van de repo)
2. Open het bestand in je browser — sleep het naar een tabblad, of gebruik Ctrl+O
3. Tampermonkey toont een installatie-pagina → klik **Install**
4. Klaar!

### Stap 3: Game herladen

1. Ga naar je C&C Tiberium Alliances tabblad
2. Herlaad de pagina (F5 of Ctrl+R)
3. Na het laden zie je in de chat: `[ST] v5.0.0 loaded — 3/3 plugins active`
4. Op de wereldkaart verschijnen gekleurde markers bij camps en online-status kleuren bij alliance-bases

### Updaten zonder je instellingen te verliezen

Het script controleert zelf dagelijks op updates en installeert ze automatisch. Je hoeft normaal niets te doen.

Wil je direct updaten? Klik op het Tampermonkey-icoon in je browser → **Controleren op updates**. Of klik opnieuw op de installatielink op GitHub — Tampermonkey herkent het script en werkt het in-place bij.

**Doe dit nooit:**
- Het script verwijderen en opnieuw installeren
- Tampermonkey → Hulpprogramma's → Importeren
- Een `.user.js`-bestand in het Tampermonkey-dashboard slepen

Bij die drie methodes wist Tampermonkey je instellingen én je API-key. Je moet dan opnieuw registreren.

**Back-up:** doe na je registratie één keer `/st config export` en bewaar de code (het registratievenster toont hem ook meteen). Mocht het toch misgaan, dan zet `/st config import` alles terug — of kies bij `/st register` "Ik heb mijn key nog" en plak alleen de key.

> **Eenmalig, bij de overstap naar 5.25.0:** oudere versies hebben de update-link nog niet in de header. Installeer 5.25.0 één keer met de hand: open het bestand `dist/shockr-ta-tools.user.js`, kopieer de inhoud en plak die in de Tampermonkey-editor over de oude versie (Tampermonkey-dashboard → klik op de scriptnaam → alles vervangen → Ctrl+S). Niet via Importeren. Daarna gaat het vanzelf.

### Controleren of het werkt

- **CampTracker**: groene/gele genummerde markers bij camps op de wereldkaart
- **KillInfo**: selecteer een Forgotten base en typ `/st plunder` → paneel `⚔ Plunder — <base>` verschijnt rechtsonder; nogmaals `/st plunder` of ✕ sluit het
- **PlayerStatus**: alliance-bases op de kaart zijn groen (online), geel (away) of grijs (offline)

### Problemen?

| Probleem | Oplossing |
|----------|-----------|
| Geen markers te zien | Check of Tampermonkey aan staat (klik op het icoontje → Shockr Tools moet enabled zijn) |
| Script laadt niet | Herlaad de game (F5). Check de console (F12) voor foutmeldingen |
| Kleuren kloppen niet | PlayerStatus heeft 30 seconden nodig om te laden. Even wachten en de kaart verplaatsen |
| Werkt niet na game-update | Meld het bij Ghozt — de game-client is geüpdatet en het script moet aangepast worden |
| `[ST] no server configured` of key kwijt na een update | Je hebt het script via Tampermonkey → Importeren of door verwijderen en opnieuw installeren bijgewerkt. Daarbij wist Tampermonkey je instellingen en je API-key. Dit gebeurt niet bij de normale update (via het Tampermonkey-menu of door op de installatielink te klikken). **Oplossing:** `/st register`. Heb je een export-code van `/st config export`? Kies dan "Ik heb mijn key nog" en plak de key. Anders maak je een nieuwe key aan. **Voorkomen:** laat Tampermonkey zelf updaten, en doe na registratie één keer `/st config export` en bewaar de code. |

### Chat-commando's

Type in de in-game chat (alleen zichtbaar voor jou):

| Commando | Wat het doet |
|----------|-------------|
| `/st help` | Toon alle commando's |
| `/st version` | Toon scriptversie |
| `/st register` | Registreren bij de alliance-server (persoonlijke key) — of een bewaarde key terugzetten |
| `/st config export` | Alle instellingen incl. je key als back-upcode |
| `/st config import` | Een back-upcode terugzetten |
| `/st plugin disable CampTracker` | CampTracker uitzetten |
| `/st plugin enable CampTracker` | CampTracker aanzetten |
| `/st config set camptracker.count 15` | Meer markers tonen |

---

## 🇩🇪 Deutsch

### Was macht dieses Script?

- **CampTracker** — nummerierte Markierungen bei neuen Camps und Außenposten auf der Weltkarte + Chat-Alarm bei neuen Spawns
- **KillInfo** — Plünder-Panel (Tib + Crystal pro Einheit und gesamt) beim Auswählen einer Forgotten-Basis
- **PlayerStatus** — Allianz-Basen farblich nach Online-Status: grün = online, gelb = abwesend, grau = offline, rot = Feind

### Schritt 1: Tampermonkey installieren

Tampermonkey ist eine Browser-Erweiterung für Userscripts.

1. Gehe zu [tampermonkey.net](https://www.tampermonkey.net/)
2. Klicke auf den Button für deinen Browser (Chrome, Firefox, Edge)
3. Installiere die Erweiterung
4. Oben rechts im Browser erscheint ein schwarzes Quadrat-Symbol

### Schritt 2: Script installieren

1. Lade die Datei `shockr-ta-tools.user.js` herunter (von Ghozt oder aus dem Repository)
2. Öffne die Datei im Browser — ziehe sie in einen Tab oder nutze Strg+O
3. Tampermonkey zeigt eine Installationsseite → klicke auf **Install**
4. Fertig!

### Schritt 3: Spiel neu laden

1. Gehe zu deinem C&C Tiberium Alliances Tab
2. Seite neu laden (F5 oder Strg+R)
3. Nach dem Laden siehst du im Chat: `[ST] v5.0.0 loaded — 3/3 plugins active`
4. Auf der Weltkarte erscheinen farbige Markierungen bei Camps und Online-Status-Farben bei Allianz-Basen

### Aktualisieren, ohne deine Einstellungen zu verlieren

Das Script prüft selbst täglich auf Updates und installiert sie automatisch. Normalerweise musst du nichts tun.

Sofort aktualisieren? Klicke auf das Tampermonkey-Symbol im Browser → **Nach Userscript-Updates suchen**. Oder klicke erneut auf den Installationslink auf GitHub — Tampermonkey erkennt das Script und aktualisiert es an Ort und Stelle.

**Mach das nie:**
- Das Script löschen und neu installieren
- Tampermonkey → Werkzeuge → Importieren
- Eine `.user.js`-Datei ins Tampermonkey-Dashboard ziehen

Bei diesen drei Wegen löscht Tampermonkey deine Einstellungen und deinen API-Key. Du musst dich dann neu registrieren.

**Sicherung:** mache nach der Registrierung einmal `/st config export` und bewahre den Code auf (das Registrierungsfenster zeigt ihn auch sofort). Geht doch etwas schief, setzt `/st config import` alles zurück — oder wähle bei `/st register` "Ich habe meinen Key noch" und füge nur den Key ein.

> **Einmalig, beim Wechsel auf 5.25.0:** ältere Versionen haben den Update-Link noch nicht im Header. Installiere 5.25.0 einmal von Hand: öffne die Datei `dist/shockr-ta-tools.user.js`, kopiere den Inhalt und füge ihn im Tampermonkey-Editor über die alte Version ein (Tampermonkey-Dashboard → Scriptname anklicken → alles ersetzen → Strg+S). Nicht über Importieren. Danach läuft es von selbst.

### Prüfen ob es funktioniert

- **CampTracker**: grüne/gelbe nummerierte Markierungen bei Camps auf der Weltkarte
- **KillInfo**: Forgotten-Basis auswählen und `/st plunder` eingeben → Panel `⚔ Plunder — <Basis>` erscheint unten rechts; erneut `/st plunder` oder ✕ schließt es
- **PlayerStatus**: Allianz-Basen auf der Karte sind grün (online), gelb (abwesend) oder grau (offline)

### Probleme?

| Problem | Lösung |
|---------|--------|
| Keine Markierungen | Prüfe ob Tampermonkey aktiviert ist (Klick auf das Symbol → Shockr Tools muss enabled sein) |
| Script lädt nicht | Spiel neu laden (F5). Konsole prüfen (F12) auf Fehlermeldungen |
| Farben stimmen nicht | PlayerStatus braucht 30 Sekunden zum Laden. Kurz warten und Karte verschieben |
| Funktioniert nicht nach Game-Update | Melde es bei Ghozt — der Game-Client wurde aktualisiert und das Script muss angepasst werden |
| `[ST] no server configured` oder Key weg nach einem Update | Du hast das Script über Tampermonkey → Importieren oder durch Löschen und Neuinstallieren aktualisiert. Dabei löscht Tampermonkey deine Einstellungen und deinen API-Key. Beim normalen Update (über das Tampermonkey-Menü oder den Installationslink) passiert das nicht. **Lösung:** `/st register`. Hast du einen Export-Code aus `/st config export`? Dann wähle "Ich habe meinen Key noch" und füge den Key ein. Sonst legst du einen neuen Key an. **Vorbeugen:** Tampermonkey selbst aktualisieren lassen und nach der Registrierung einmal `/st config export` machen und den Code aufbewahren. |

### Chat-Befehle

Im Spiel-Chat eingeben (nur für dich sichtbar):

| Befehl | Was es tut |
|--------|-----------|
| `/st help` | Alle Befehle anzeigen |
| `/st version` | Script-Version anzeigen |
| `/st register` | Beim Allianz-Server registrieren (persönlicher Key) — oder einen aufbewahrten Key zurücksetzen |
| `/st config export` | Alle Einstellungen inkl. Key als Sicherungscode |
| `/st config import` | Einen Sicherungscode zurückspielen |
| `/st plugin disable CampTracker` | CampTracker deaktivieren |
| `/st plugin enable CampTracker` | CampTracker aktivieren |
| `/st config set camptracker.count 15` | Mehr Markierungen anzeigen |
