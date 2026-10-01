# Shockr TA Tools

**NL:** Camp tracker, kill info, speler-status en alliance-verkenning voor C&C Tiberium Alliances.

**DE:** Camp-Tracker, Kill-Info, Spieler-Status und Allianz-Aufklärung für C&C Tiberium Alliances.

---

## What is this?

A Tampermonkey userscript for [C&C Tiberium Alliances](https://www.tiberiumalliances.com/) that adds:

- **CampTracker** — numbered markers on the world map for nearby camps, outposts and bases, with chat alerts and clickable coordinates
- **KillInfo** — plunder panel for the selected Forgotten base (tiberium + crystal per unit and total), toggled with `/st plunder`
- **PlayerStatus** — alliance base colors by online status (green/yellow/red/grey, own bases cyan)
- **LayoutScanner** — scan nearby FG base layouts and upload to a shared alliance server
- **RepairGuard** — blocks "Repair All" so you don't fully repair by accident (saves crystal on Forgotten Attack worlds); per-unit repair keeps working. Off by default — `/st plugin enable repair-guard`
- **UpgradeCalc** — upgrade panel for your current base: next-level Tiberium + Power cost per building and how long it takes to save up at your current production (fastest first), toggled with `/st upgradecalc`

All features work offline — no external API dependency. The optional scanner uploads to your own self-hosted server.

This is a clean-room rebuild of the original [Shockr Tools](https://shockr.dev) (v4.5.3.6, NetquiK fork), which stopped working after the shockr.dev API went offline.

## Installation

See [INSTALL_GUIDE.md](INSTALL_GUIDE.md) for step-by-step instructions (NL + DE).

Quick version:

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Open `dist/shockr-ta-tools.user.js` → click "Install"
3. Reload the game

## Chat Commands

All configuration via in-game chat:

| Command | Description |
|---------|-------------|
| `/st help` | Show available commands |
| `/st status` | Show plugin status |
| `/st plunder` | Toggle the plunder panel for the selected Forgotten base |
| `/st upgradecalc` | Toggle the upgrade calculator panel for your current base |
| `/st plugin enable <name>` | Enable a plugin |
| `/st plugin disable <name>` | Disable a plugin |
| `/st config list` | Show all config values |
| `/st config set <key> <value>` | Set a config value |

### Scanner Setup (optional)

```
/st plugin enable LayoutScanner
/st config set api.url https://your-server.com/shockr
/st config set api.key YOUR_API_KEY
/st scan
```

## Alliance Scanner Server

The `server/` directory contains a self-hosted FastAPI backend that receives and stores base scans. See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment and [docs/SECURITY.md](docs/SECURITY.md) for the security design.

Features:
- JSONL storage per world, per alliance
- API key auth (bcrypt hashed) for scan uploads
- Basic Auth for the web viewer
- Base list with sorting, filtering, color-coded freshness
- Base detail: 9×16 resource grid, defense/offense units, scan history
- Rate limiting, payload validation, container hardening

## Build from Source

```bash
npm install
node build.js
# Output: dist/shockr-ta-tools.user.js
```

## Credits

- **Shockr** — original author
- **NetquiK [SoO]** — maintained fork
- **Ghozt [SoO]** — rebuild (v5.0.0+), alliance scanner

## License

MIT — see [LICENSE](LICENSE).
