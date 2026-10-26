# Shockr TA Tools

**NL:** Camp tracker, kill info, speler-status en alliance-verkenning voor C&C Tiberium Alliances.

**DE:** Camp-Tracker, Kill-Info, Spieler-Status und Allianz-Aufklärung für C&C Tiberium Alliances.

---

## What is this?

A Tampermonkey userscript for [C&C Tiberium Alliances](https://www.tiberiumalliances.com/) that adds:

- **Shockr button** — one shield icon top left (drag it anywhere, the position is remembered). Click it for a grid with every Shockr panel: Upgrade Calculator, Help, Target Watch, and a **Config** button for export/import of your settings. Escape or a click outside closes it

- **CampTracker** — numbered markers on the world map for nearby camps, outposts and bases, with chat alerts and clickable coordinates
- **KillInfo** — plunder panel for the selected Forgotten base (tiberium + crystal per unit and total), toggled with `/st plunder`
- **PlayerStatus** — alliance base colors by online status, own bases cyan; scheme via `/st config set colors shockr|maelstrom` (default shockr)
- **LayoutScanner** — scan nearby FG base layouts and upload to a shared alliance server
- **RepairGuard** — blocks "Repair All" so you don't fully repair by accident (saves crystal on Forgotten Attack worlds); per-unit repair keeps working. Off by default — `/st plugin enable repair-guard`
- **AutoRepair** — repairs the attacking base's damaged offense units right after every own attack (as soon as the base is unlocked), with a check every few minutes as a safety net (`/st config set autorepair.interval <min>`, default 5, minimum 1); never while the attack screen is open or a base is in lockdown. Buildings too with `/st config set autorepair.buildings true` (off by default): repaired after an attack on your base, once the attack and the lockdown are over. Cannot run together with RepairGuard (turning one on turns the other off; both on at startup → RepairGuard wins). Off by default — `/st plugin enable auto-repair`
- **UpgradeCalc** — upgrade panel for your current base: next-level Tiberium + Power cost per building and how long it takes to save up at your current production (fastest first), opened with the calculator icon in the Shockr button on your own base. Off by default — `/st plugin enable upgradecalc`
- **AttackTracker** — logs your own WON attacks on Forgotten camps/outposts/bases (target, level, coordinates, tib/crystal/credits loot) to the alliance server, read from your combat reports. Lost attacks and PvP are never sent. The website page **🗡 Attacks** shows per tunnel (targets within 10 fields) who attacked what, with filters per player / day / target type. Uses the scanner's `api.url` + `/st register`. On by default — `/st plugin disable attack-tracker`
- **TargetWatcher** — tells your alliance server which enemy/Forgotten base you are viewing and warns in chat when an alliance mate is looking at the same target (`[ST] ⚠️ NeoJackson1 kijkt ook naar Camp L47 (sinds 3 min)`), so two players don't hit the same target unknowingly. Uses the scanner's `api.url` / `api.key`. On by default for new installs (installs from before 5.12.0 keep their setting) — `/st plugin disable target-watcher`
- **TargetBoard** — the website's Target Watch overview in-game: radar icon in the Shockr button or `/st targets`. Every target your alliance is looking at right now, with level, who watches it and since when; 2+ watchers = orange row. Click a row to centre the world map on it. Refreshes every 20 s while open, no requests while closed. Needs the alliance server (`/st register`). On by default — `/st plugin disable target-board`

All features work offline — no external API dependency. The optional scanner uploads to your own self-hosted server.

This is a rebuild based on the original [Shockr Tools](https://github.com/blacha/st) by Blayne Chard (MIT; used in-game as v4.5.3.6, NetquiK fork), which stopped working after the shockr.dev API went offline. Parts of its code were ported and are still under its MIT license — see [NOTICE](NOTICE).

## Installation

See [INSTALL.md](INSTALL.md) for step-by-step instructions (NL + DE).

Quick version:

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Open `dist/shockr-ta-tools.user.js` → click "Install"
3. Reload the game

### Updating without losing your settings

The script checks for updates by itself (daily) and installs them automatically — the header's `@updateURL` points at this repo's `dist/shockr-ta-tools.user.js` on `main`. Normally you don't have to do anything. The game chat tells you when a newer version is waiting.

Want it right away? Click the Tampermonkey icon in your browser → **Check for userscript updates**. Or click the install link on GitHub again — Tampermonkey recognises the script and updates it in place.

**Never do this:**
- Delete the script and install it again
- Tampermonkey → Utilities → Import
- Drag a `.user.js` file into the Tampermonkey dashboard

With those three methods Tampermonkey wipes your settings **and** your API key (it creates the script as a new one, with new storage). You would have to register again.

**Backup:** after registering, run `/st config export` once and keep the code (the register popup shows it right away). If things do go wrong, `/st config import` puts everything back — or choose "I still have my key" in `/st register` and paste just the key.

> **One-time, when moving to 5.25.0:** older versions don't have the update link in their header yet, so install 5.25.0 by hand once: open `dist/shockr-ta-tools.user.js`, copy its contents and paste them over the old version in the Tampermonkey editor (dashboard → click the script name → replace all → Ctrl+S). Not via Import. From then on it updates itself.

**Troubleshooting — `[ST] no server configured` or key gone after an update:** you updated via Tampermonkey → Import or by deleting and reinstalling, which wipes your settings and API key. This does not happen with a normal update (Tampermonkey menu or the install link). Fix: `/st register`; if you have an export code from `/st config export`, choose "I still have my key" and paste the key, otherwise create a new key. Prevent it: let Tampermonkey update by itself, and run `/st config export` once after registering.

## Chat Commands

All configuration via in-game chat:

| Command | Description |
|---------|-------------|
| `/st help` | Overview of all commands, plugins and useful settings — as a popup panel (close with ✕ / Escape / `/st help`); `/st config set help.popup false` shows it in the chat instead |
| `/st status` | Show plugin status and whether you are registered with the alliance server |
| `/st register` | Register with the alliance server — popup asking for the enrollment code |
| `/st plunder` | Toggle the plunder panel for the selected Forgotten base |
| `/st targets` | Open/close the in-game Target Watch panel |
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
6. Below the key the popup shows your **backup code** (the same text as `/st config export`, including the key) with its own **Copy** button. Keep it somewhere safe: `/st config import` restores all settings and the key after a reinstall.

**Lost the key but still have it from an export?** `/st register` → "I still have my key" → paste it. The server checks it against the stored hash (`POST /api/enroll/restore`, 5 attempts per hour per IP) and the key simply becomes active again in this browser — nothing new is issued, so other browsers or game servers that still hold it keep working. A wrong key gives "Key not valid" and stores nothing.

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

- **Shockr** (Blayne Chard) — original author, [blacha/st](https://github.com/blacha/st)
- **NetquiK [SoO]** — maintained fork
- **Ghozt [SoO]** — rebuild (v5.0.0+), alliance scanner

## License

GPL-3.0-or-later — see [LICENSE](LICENSE). Shockr TA Tools is free software: you can redistribute and/or modify it under the terms of the GNU General Public License version 3 or (at your option) any later version. Code taken over from other userscripts names its source and license in the file (see [docs/LICENTIES_DERDEN.md](docs/LICENTIES_DERDEN.md)). MIT-licensed parts from the original Shockr Tools: see [NOTICE](NOTICE).

## A note on licensing and attribution

Shockr Alliance Tools started as a rebuild of community scripts for Tiberium Alliances, many of which were abandoned years ago. We have put considerable effort into tracing the origin of every piece of code, identifying the original authors and their licenses, and either rewriting code where the license did not allow reuse or crediting it properly where it did. The full inventory is in [docs/LICENTIES_DERDEN.md](docs/LICENTIES_DERDEN.md).

We may still have missed something. If you are the author of code or assets used here and believe we have not credited you correctly, or if you object to the way your work is used, please open an issue or contact Ghozt on the TA forum. We will work with you to resolve it properly — whether that means adding attribution, changing the license note, or replacing the code.
