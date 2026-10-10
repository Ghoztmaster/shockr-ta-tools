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
- **UpgradeCalc** — upgrade panel for your current base: next-level Tiberium + Power cost per building and how long it takes to save up at your current production (fastest first), opened with the "UC" button on your own base. Off by default — `/st plugin enable upgradecalc`
- **TargetWatcher** — tells your alliance server which enemy/Forgotten base you are viewing and warns in chat when an alliance mate is looking at the same target (`[ST] ⚠️ NeoJackson1 kijkt ook naar Camp L47 (sinds 3 min)`), so two players don't hit the same target unknowingly. Uses the scanner's `api.url` / `api.key`. Off by default — `/st plugin enable target-watcher`

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
| `/st help` | Overview of all commands, plugins and useful settings — as a popup panel (close with ✕ / Escape / `/st help`); `/st config set help.popup false` shows it in the chat instead |
| `/st status` | Show plugin status and whether you are registered with the alliance server |
| `/st register` | Register with the alliance server — popup asking for the enrollment code |
| `/st plunder` | Toggle the plunder panel for the selected Forgotten base |
| `/st plugin enable <name>` | Enable a plugin |
| `/st plugin disable <name>` | Disable a plugin |
| `/st config list` | Show all config values |
| `/st config set <key> <value>` | Set a config value |

### Language

All chat messages, panels and `/st` output are available in English, German and Dutch (default: English). Switching applies immediately:

```
/st config set language nl    # en | de | nl
```

### Scanner Setup (optional)

```
/st plugin enable LayoutScanner
/st config set api.url https://your-server.com/shockr
/st register
/st scan
```

### Registration (personal API key)

Every player gets their own API key — no key to copy or paste:

1. Get the **enrollment code** from your alliance chat (it is never in the script or this repo, and the alliance leader can change it at any time).
2. Type `/st register` in the game chat. A popup asks for the enrollment code.
3. The script sends the code together with your player id, name, alliance id and world id (read from the game) to `POST /api/enroll`.
4. The server checks the code and whether your alliance is allowed, and returns a personal key. The script stores it in `api.playerKey` — you'll see `✅ Registered! Your personal key is active.` and `[ST] ✅ Registered successfully` in the chat.
5. The popup then shows the key itself with a **Copy** button and stays open until you click **Close**. You need it (with your player name) to log in to the Shockr Alliance website.

From then on every scan and target-watch request uses your personal key (`X-Player-Key`). `/st config get api.playerKey` shows the key again (only in your own chat, nothing is sent); `/st config list` still shows it as *set* / *not set*, and `/st status` shows whether you are registered. Registering again (e.g. new browser) gives you a new key and invalidates the old one.

**Transition:** the shared alliance key (`/st config set api.key ...`) keeps working until the server admin switches it off. Players without either key get `[ST] ⚠️ Not registered — type /st register`.

## Alliance Scanner Server

The `server/` directory contains a self-hosted FastAPI backend that receives and stores base scans. See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment and [docs/SECURITY.md](docs/SECURITY.md) for the security design.

Features:
- JSONL storage per world, per alliance
- Per-player API keys via self-enrollment (`/st register`, bcrypt hashed); shared alliance key accepted during a transition period
- Web viewer login with player name + personal API key (session cookie); admin endpoints on Basic Auth
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
