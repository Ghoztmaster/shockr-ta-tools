# Shockr TA Tools v5.0.0

**NL:** Shockr TA Tools — hersteld en uitgebreid. Camp tracker, kill info, speler-status en alliance-verkenning voor C&C Tiberium Alliances.

**DE:** Shockr TA Tools — repariert und erweitert. Camp-Tracker, Kill-Info, Spieler-Status und Allianz-Aufklärung für C&C Tiberium Alliances.

---

## Features

### CampTracker
Numbered markers on the world map for nearby camps and outposts, sorted by newest. Configurable size, font, level filter, and count. Chat alerts when new camps/outposts spawn.

### KillInfo
Plunder value tooltip when hovering over defense units in battle view. Shows repair cost (Tiberium + Crystal) = what you gain by destroying the unit.

### PlayerStatus
Alliance bases colored by online status on the world map:
- 🟢 **Online** — bright green
- 🟡 **Away** — amber
- ⚫ **Offline** — dark grey
- 🔴 **Foe** — red
- 🔵 **Own bases** — cyan

Refreshes every 30 seconds.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser
2. Download [`dist/shockr-ta-tools.user.js`](dist/shockr-ta-tools.user.js) from this repo
3. Open the file — Tampermonkey will offer to install it
4. Reload the game

**Check:** open the browser console (F12) — you should see `[ST] v5.0.0 loaded — 3/3 plugins active`.

## Configuration

Use `/st` commands in the in-game chat (only visible to you):

| Command | Description |
|---------|-------------|
| `/st help` | List all commands |
| `/st version` | Show script version |
| `/st plugin enable <name>` | Enable a plugin |
| `/st plugin disable <name>` | Disable a plugin |
| `/st config set <key> <value>` | Set a config value |
| `/st config list` | Show all config values |

### CampTracker config keys

| Key | Default | Description |
|-----|---------|-------------|
| `camptracker.size` | 24 | Marker size in pixels |
| `camptracker.font` | Iosevka Term | Font family |
| `camptracker.fontsize` | 20 | Font size in pixels |
| `camptracker.offense` | -1 | Level filter: hide camps below main offense + this value |
| `camptracker.count` | 10 | Max markers shown |
| `camptracker.alert` | true | Chat alert on new spawns |

## Building from source

```bash
npm install
node build.js
```

Output: `dist/shockr-ta-tools.user.js`

## Compatibility

- Tested on game version 26.1 (Perforce 576232)
- Works alongside MaelstromTools, MehrStrom, CnCTAOpt, TAMap, and other common TA scripts
- Requires no server — all features run locally in the browser

## Credits

- **Shockr** — original author (contact@shockr.dev)
- **NetquiK [SoO]** — maintained fork, regex fixes
- **Ghozt [SoO]** — v5.0.0 rebuild, fingerprint-based patching, ongoing maintenance

## License

MIT — see [LICENSE](LICENSE).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including the alliance scanner and online base viewer.
