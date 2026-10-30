"""
War Tracker (5.33.0) — the alliance's progress on Forgotten targets, per
sector and per tunnel, for the alliance leadership (page /war).

Access (WarAccess): the alliance role the userscript sends at enrollment and
with every attack (cic / second / officer, PlayerKeyStore entry "role"), or
the player id in the whitelist data/alliance/war-whitelist.json, edited by
hand on the VPS and re-read when it changes:

    {"playerIds": [123456, 234567]}

Checked on every page load and every War API call, so a demoted officer
loses access with their next attack report (or re-enrollment), a whitelist
edit at once.

Targets (overview): the Forgotten targets the LayoutScanner scanned in the
last SCAN_MAX_AGE_HOURS (ScanStorage.fg_targets) plus every target that was
attacked in the period, matched on the target's city id (report obi = scan
city_id) and, for records without one (before 5.33.0), on the coordinate.
Status within the period:
  - destroyed  an attack in the period destroyed it (is_destroyed)
  - attacked   attacked in the period, still standing
  - open       scanned, no attack in the period
A target destroyed BEFORE the period is gone and is left out. A target that
was destroyed outside the tracker (another alliance, a member without the
script) stays "open" until its scan is older than SCAN_MAX_AGE_HOURS - the
scans hold no "gone" signal.

Sectors: the compass sectors of sector-hud (lib/poi-util.js sectorNo) from
the world size the userscript sends with each attack (AttackStore.geometry);
no geometry yet = no sector. Tunnels: the attack clusters of
server/attacks.py (cluster_attacks, TUNNEL_RADIUS); an open target joins the
nearest tunnel centre within the radius, otherwise it counts only in its
sector.
"""
import json
import logging
import math
from pathlib import Path
from typing import Callable

from server.attacks import TUNNEL_RADIUS, cluster_attacks, is_destroyed, _public
from server.player_keys import PlayerKeyStore

log = logging.getLogger("shockr-alliance")

WAR_ROLES = ("cic", "second", "officer")
SCAN_MAX_AGE_HOURS = 168
SECTOR_NAMES_8 = ("S", "SW", "W", "NW", "N", "NE", "E", "SE")
STATUSES = ("open", "attacked", "destroyed")
TOP_PLAYERS = 5


class WarAccess:
    """Who may open the War page: a leadership role, or the whitelist file."""

    def __init__(self, path: Path):
        self.path = path
        self._mtime: float | None = None
        self._ids: set[int] = set()

    def whitelist(self) -> set[int]:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            self._mtime, self._ids = None, set()
            return self._ids
        if mtime != self._mtime:
            try:
                with open(self.path) as f:
                    data = json.load(f)
                ids = data.get("playerIds", []) if isinstance(data, dict) else data
                self._ids = {int(i) for i in ids}
                log.info("War whitelist loaded: %d player(s)", len(self._ids))
            except (OSError, ValueError, TypeError, AttributeError) as e:
                log.warning("Could not load %s: %s — keeping previous whitelist", self.path, e)
            self._mtime = mtime
        return self._ids

    def allowed(self, player_id: int, player_keys: PlayerKeyStore) -> bool:
        entry = player_keys.players.get(player_id)
        if entry is None:
            return False
        return entry.get("role") in WAR_ROLES or player_id in self.whitelist()


def sector_of(x: int, y: int, geometry: dict | None) -> int | None:
    """Compass sector (0 = south, then clockwise on the map: SW, W, ...) - lib/poi-util.js sectorNo."""
    if not geometry:
        return None
    count = geometry["count"]
    dx = x - geometry["width"] // 2
    dy = y - geometry["height"] // 2
    turn = math.atan2(-dx, dy) / (2 * math.pi)
    return math.floor(turn * count + 0.5) % count     # JS Math.round


def sector_name(i: int | None, geometry: dict | None) -> str:
    if i is None:
        return "?"
    return SECTOR_NAMES_8[i] if geometry and geometry["count"] == 8 else str(i)


def overview(rows: list[dict], since_ms: int, scans: list[dict], geometry: dict | None,
             sector: int | None = None, player: str | None = None, target_type: str | None = None,
             area: Callable[[int, int], bool] | None = None) -> dict:
    """
    War page data. `rows`: the scope's attack records over the whole
    retention (won and lost, any order); `scans`: ScanStorage.fg_targets.
    Filters apply to the targets; a player filter keeps the targets that
    player attacked in the period (so no open ones).
    """
    targets = _collect(rows, scans)
    player_l = player.lower() if player else None
    names: set[str] = set()
    out = []
    for t in targets:
        period = [r for r in t["rows"] if r["timestamp"] >= since_ms]
        if not period and any(is_destroyed(r) for r in t["rows"]):
            continue    # destroyed before the period: gone
        names.update(r["playerName"] for r in period)
        t["sector"] = sector_of(t["x"], t["y"], geometry)
        if sector is not None and t["sector"] != sector:
            continue
        if target_type and t["targetType"] != target_type:
            continue
        if area is not None and not area(t["x"], t["y"]):
            continue
        if player_l and not any(r["playerName"].lower() == player_l for r in period):
            continue
        out.append(_target_view(t, period, geometry))

    tunnels = _tunnels(out)
    out.sort(key=lambda t: (t["lastAttack"] is None, -(t["lastAttack"] or 0), t["x"], t["y"]))   # newest attack first, open last
    return {
        "summary": _summary(out),
        "players": _players(out),
        "sectors": _sectors(out, geometry),
        "tunnels": tunnels,
        "targets": out,
        "playerNames": sorted(names, key=str.lower),
        "geometry": geometry,
    }


def _collect(rows: list[dict], scans: list[dict]) -> list[dict]:
    """Scanned targets + attacked targets, each with its attack records (oldest first)."""
    by_id: dict[int, dict] = {}
    by_pos: dict[tuple[int, int], dict] = {}
    targets: list[dict] = []

    def add(t):
        targets.append(t)
        if t["cityId"] is not None:
            by_id[t["cityId"]] = t
        pos = (t["x"], t["y"])
        if pos not in by_pos or (t["scannedAt"] or 0) >= (by_pos[pos]["scannedAt"] or 0):
            by_pos[pos] = t

    for s in scans:
        add({**s, "rows": []})
    for r in sorted(rows, key=lambda r: r.get("timestamp", 0)):
        tid = r.get("targetId")
        pos = (r["targetX"], r["targetY"])
        t = by_id.get(tid) if tid else None
        if t is None:
            at_pos = by_pos.get(pos)
            # Legacy records (no targetId) match on the coordinate; a record with an
            # id only joins a target at its coordinate that has no id of its own
            if at_pos is not None and (tid is None or at_pos["cityId"] is None):
                t = at_pos
                if tid and t["cityId"] is None:
                    t["cityId"] = tid
                    by_id[tid] = t
        if t is None:
            t = {"cityId": tid, "x": pos[0], "y": pos[1], "targetType": r["targetType"],
                 "targetLevel": r["targetLevel"], "scannedAt": None, "rows": []}
            add(t)
        t["rows"].append(r)
    return targets


def _target_view(t: dict, period: list[dict], geometry: dict | None) -> dict:
    period = sorted(period, key=lambda r: r["timestamp"], reverse=True)
    if any(is_destroyed(r) for r in period):
        status = "destroyed"
    elif period:
        status = "attacked"
    else:
        status = "open"
    counts: dict[str, int] = {}
    for r in period:
        counts[r["playerName"]] = counts.get(r["playerName"], 0) + 1
    last = period[0] if period else None
    # A scan describes the target best; a target only known from attacks takes the newest attack
    target_type = t["targetType"] if t["scannedAt"] is not None or not last else last["targetType"]
    target_level = t["targetLevel"] if t["scannedAt"] is not None or not last else last["targetLevel"]
    return {
        "key": f"{t['x']}:{t['y']}:{t['cityId'] or ''}",
        "cityId": t["cityId"],
        "x": t["x"],
        "y": t["y"],
        "targetType": target_type,
        "targetLevel": target_level,
        "sector": t["sector"],
        "sectorName": sector_name(t["sector"], geometry),
        "status": status,
        "scannedAt": t["scannedAt"],
        "attacks": len(period),
        "won": sum(1 for r in period if r.get("won", True)),
        "attackers": [{"playerName": p, "attacks": n}
                      for p, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "lastAttack": last["timestamp"] if last else None,
        "lootTib": sum(r.get("lootTib", 0) for r in period),
        "lootCrystal": sum(r.get("lootCrystal", 0) for r in period),
        "lootCredits": sum(r.get("lootCredits", 0) for r in period),
        "cpCost": sum(r.get("cpCost") or 0 for r in period),
        "attackList": [_public(r) for r in period],
        "tunnel": None,
    }


def _tunnels(targets: list[dict]) -> list[dict]:
    """Attack clusters (cluster_attacks) + the open targets near each; sets target['tunnel']."""
    attacks = [a for t in targets for a in t["attackList"]]
    clusters = cluster_attacks(attacks)
    pos_to_cluster = {}
    for c in clusters:
        for a in c["attackList"]:
            pos_to_cluster[(a["targetX"], a["targetY"])] = c
        c["_targets"] = []
    for t in targets:
        c = pos_to_cluster.get((t["x"], t["y"])) if t["attacks"] else None
        if c is None and not t["attacks"]:
            best = None
            for cl in clusters:
                d = math.hypot(t["x"] - cl["x"], t["y"] - cl["y"])
                if d <= TUNNEL_RADIUS and (best is None or d < best[0]):
                    best = (d, cl)
            c = best[1] if best else None
        if c is not None:
            c["_targets"].append(t)
            t["tunnel"] = f"{c['x']}:{c['y']}"
    result = []
    for c in clusters:
        counts = {s: sum(1 for t in c["_targets"] if t["status"] == s) for s in STATUSES}
        total = len(c["_targets"])
        result.append({
            "key": f"{c['x']}:{c['y']}",
            "x": c["x"],
            "y": c["y"],
            "minLevel": c["minLevel"],
            "maxLevel": c["maxLevel"],
            "targets": total,
            **counts,
            "progress": round(100 * counts["destroyed"] / total) if total else 0,
            "attacks": c["attacks"],
            "lootTib": c["lootTib"],
            "lootCrystal": c["lootCrystal"],
            "lootCredits": c["lootCredits"],
            "lastAt": c["lastAt"],
            "contributors": c["contributors"],
        })
    return result


def _summary(targets: list[dict]) -> dict:
    counts = {s: sum(1 for t in targets if t["status"] == s) for s in STATUSES}
    attacks = [a for t in targets for a in t["attackList"]]
    total = len(targets)
    players = _players(targets)
    return {
        "targets": total,
        **counts,
        "pctDestroyed": round(100 * counts["destroyed"] / total) if total else 0,
        "attacks": len(attacks),
        "won": sum(1 for a in attacks if a["won"]),
        "lost": sum(1 for a in attacks if not a["won"]),
        "lootTib": sum(a["lootTib"] for a in attacks),
        "lootCrystal": sum(a["lootCrystal"] for a in attacks),
        "lootCredits": sum(a["lootCredits"] for a in attacks),
        "cpCost": sum(a["cpCost"] or 0 for a in attacks),
        "topPlayers": players[:TOP_PLAYERS],
    }


def _players(targets: list[dict]) -> list[dict]:
    per: dict[str, dict] = {}
    for t in targets:
        for a in t["attackList"]:
            p = per.setdefault(a["playerName"], {"playerName": a["playerName"], "attacks": 0, "won": 0,
                                                 "destroyed": 0, "lootTib": 0, "lootCrystal": 0,
                                                 "lootCredits": 0, "cpCost": 0})
            p["attacks"] += 1
            p["won"] += 1 if a["won"] else 0
            p["destroyed"] += 1 if a["destroyed"] else 0
            for k in ("lootTib", "lootCrystal", "lootCredits"):
                p[k] += a[k]
            p["cpCost"] += a["cpCost"] or 0
    return sorted(per.values(), key=lambda p: (-p["attacks"], -p["destroyed"], p["playerName"].lower()))


def _sectors(targets: list[dict], geometry: dict | None) -> list[dict]:
    per: dict[int | None, dict] = {}
    for t in targets:
        s = per.setdefault(t["sector"], {"sector": t["sector"], "name": t["sectorName"], "targets": 0,
                                         **{k: 0 for k in STATUSES}})
        s["targets"] += 1
        s[t["status"]] += 1
    for s in per.values():
        s["progress"] = round(100 * s["destroyed"] / s["targets"]) if s["targets"] else 0
    return sorted(per.values(), key=lambda s: (s["sector"] is None, s["sector"] or 0))
