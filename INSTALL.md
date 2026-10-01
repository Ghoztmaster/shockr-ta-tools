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

### Controleren of het werkt

- **CampTracker**: groene/gele genummerde markers bij camps op de wereldkaart
- **KillInfo**: selecteer een Forgotten base → paneel `⚔ Plunder — <base>` verschijnt rechtsonder, boven het FG-def paneel
- **PlayerStatus**: alliance-bases op de kaart zijn groen (online), geel (away) of grijs (offline)

### Problemen?

| Probleem | Oplossing |
|----------|-----------|
| Geen markers te zien | Check of Tampermonkey aan staat (klik op het icoontje → Shockr Tools moet enabled zijn) |
| Script laadt niet | Herlaad de game (F5). Check de console (F12) voor foutmeldingen |
| Kleuren kloppen niet | PlayerStatus heeft 30 seconden nodig om te laden. Even wachten en de kaart verplaatsen |
| Werkt niet na game-update | Meld het bij Ghozt — de game-client is geüpdatet en het script moet aangepast worden |

### Chat-commando's

Type in de in-game chat (alleen zichtbaar voor jou):

| Commando | Wat het doet |
|----------|-------------|
| `/st help` | Toon alle commando's |
| `/st version` | Toon scriptversie |
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

### Prüfen ob es funktioniert

- **CampTracker**: grüne/gelbe nummerierte Markierungen bei Camps auf der Weltkarte
- **KillInfo**: Forgotten-Basis auswählen → Panel `⚔ Plunder — <Basis>` erscheint unten rechts, über dem FG-def-Panel
- **PlayerStatus**: Allianz-Basen auf der Karte sind grün (online), gelb (abwesend) oder grau (offline)

### Probleme?

| Problem | Lösung |
|---------|--------|
| Keine Markierungen | Prüfe ob Tampermonkey aktiviert ist (Klick auf das Symbol → Shockr Tools muss enabled sein) |
| Script lädt nicht | Spiel neu laden (F5). Konsole prüfen (F12) auf Fehlermeldungen |
| Farben stimmen nicht | PlayerStatus braucht 30 Sekunden zum Laden. Kurz warten und Karte verschieben |
| Funktioniert nicht nach Game-Update | Melde es bei Ghozt — der Game-Client wurde aktualisiert und das Script muss angepasst werden |

### Chat-Befehle

Im Spiel-Chat eingeben (nur für dich sichtbar):

| Befehl | Was es tut |
|--------|-----------|
| `/st help` | Alle Befehle anzeigen |
| `/st version` | Script-Version anzeigen |
| `/st plugin disable CampTracker` | CampTracker deaktivieren |
| `/st plugin enable CampTracker` | CampTracker aktivieren |
| `/st config set camptracker.count 15` | Mehr Markierungen anzeigen |
