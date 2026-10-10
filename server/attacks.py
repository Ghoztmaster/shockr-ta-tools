"""
Alliance Attack Tracker — won attacks on Forgotten targets, per player and per tunnel.

The userscript (plugins/attack-tracker.js) reads the player's own combat
reports and POSTs every WON attack on a Forgotten camp/outpost/base to
POST /api/attack. Lost attacks and PvP are filtered out in the userscript;
the server only accepts the three FG target types.

Storage: data/attacks/{worldId}.jsonl, one line per attack = the POST data +
playerId, playerName, scope (storage scope of the key, like scans) and
receivedAt. Records older than RETENTION_DAYS are removed at startup (prune()),
and a POST older than that is not stored at all.

Deduplication: same playerId + targetX + targetY with timestamps at most
DEDUP_WINDOW_MS apart = the same attack (a resent batch, or the same report
picked up twice). When both carry a reportId, an equal reportId is a duplicate
too, and two different reportIds are never merged — two real attacks on the
same target within a minute stay two.

Tunnels: attacks are grouped into clusters of at most TUNNEL_RADIUS fields
around a centre (cluster_attacks). Known tunnel positions can be passed in as
centres; the scan data holds no tunnels yet, so in practice the centres come
from the attacks themselves: the most-attacked target position becomes the
first centre, every position within the radius joins it, the next unassigned
position starts the next one. Distance is Euclidean (as the game's attack
range). The label is the attack-weighted mean of the cluster's positions.

The store keeps each world's records in memory after the first read; that
needs a single uvicorn worker, as in the Dockerfile.
"""
import json
import logging
import math
import os
import time
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field, field_validator

log = logging.getLogger("shockr-alliance")

TARGET_TYPES = ("camp", "outpost", "base")
RETENTION_DAYS = 7
DEDUP_WINDOW_MS = 60 * 1000
TUNNEL_RADIUS = 10
MAX_FUTURE_MS = 3600 * 1000
MAX_BATCH = 50
LOOT_MAX = 1e12


class AttackPayload(BaseModel):
    """One won attack, as sent by attack-tracker.js (camelCase)."""
    model_config = ConfigDict(extra="ignore")

    targetType: str = Field(max_length=20)
    targetLevel: float = Field(ge=0, le=100)
    targetX: int = Field(ge=0, le=1600)
    targetY: int = Field(ge=0, le=1600)
    lootTib: float = Field(ge=0, le=LOOT_MAX, default=0)
    lootCrystal: float = Field(ge=0, le=LOOT_MAX, default=0)
    lootCredits: float = Field(ge=0, le=LOOT_MAX, default=0)
    worldId: int = Field(ge=1, le=999)
    timestamp: int = Field(gt=0)               # ms epoch, time of the attack
    reportId: int | None = Field(default=None, gt=0)   # optional: game report id, sharper dedup

    @field_validator("lootTib", "lootCrystal", "lootCredits")
    @classmethod
    def whole_numbers(cls, v: float) -> int:
        return int(round(v))

    @field_validator("targetType")
    @classmethod
    def validate_target_type(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in TARGET_TYPES:
            raise ValueError("targetType must be camp, outpost or base")
        return v


class AttackStore:
    def __init__(self, data_dir: Path | None, clock: Callable[[], float] = time.time):
        """data_dir None = memory only (tests)."""
        self.dir = data_dir / "attacks" if data_dir is not None else None
        self.clock = clock
        self._worlds: dict[int, list[dict]] = {}

    # ─── Write ───────────────────────────────────────────────────────

    def add(self, payload: AttackPayload, player_id: int, player_name: str, scope: str) -> str:
        """'ok' (stored), 'duplicate' or 'stale' (older than the retention / too far ahead)."""
        now_ms = int(self.clock() * 1000)
        if payload.timestamp < now_ms - RETENTION_DAYS * 86400 * 1000 or payload.timestamp > now_ms + MAX_FUTURE_MS:
            return "stale"
        records = self._load(payload.worldId)
        if any(_same_attack(r, payload, player_id) for r in records):
            return "duplicate"
        record = payload.model_dump()
        if record.get("reportId") is None:
            record.pop("reportId", None)
        record.update({
            "playerId": player_id,
            "playerName": player_name,
            "scope": scope,
            "receivedAt": now_ms,
        })
        records.append(record)
        if self.dir is not None:
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self._file(payload.worldId), "a") as f:
                f.write(json.dumps(record, separators=(",", ":")) + "\n")
        return "ok"

    def prune(self) -> int:
        """Drop records older than RETENTION_DAYS from every world file (startup). Returns the number removed."""
        if self.dir is None or not self.dir.exists():
            return 0
        cutoff = int(self.clock() * 1000) - RETENTION_DAYS * 86400 * 1000
        removed = 0
        for path in self.dir.glob("*.jsonl"):
            if not path.stem.isdigit():
                continue
            records = _read(path)
            keep = [r for r in records if r.get("timestamp", 0) >= cutoff]
            dropped = _line_count(path) - len(keep)
            if dropped:
                tmp = path.with_suffix(".jsonl.tmp")
                with open(tmp, "w") as f:
                    for r in keep:
                        f.write(json.dumps(r, separators=(",", ":")) + "\n")
                os.replace(tmp, path)
                removed += dropped
                log.info("Attacks: pruned %d record(s) from %s, %d kept", dropped, path.name, len(keep))
            self._worlds[int(path.stem)] = keep
        return removed

    # ─── Read ────────────────────────────────────────────────────────

    def worlds(self) -> list[int]:
        """World ids with stored attacks, most recent attack first."""
        ids = set(self._worlds)
        if self.dir is not None and self.dir.exists():
            ids.update(int(p.stem) for p in self.dir.glob("*.jsonl") if p.stem.isdigit())
        latest = {w: max((r["timestamp"] for r in self._load(w)), default=0) for w in ids}
        return sorted((w for w in ids if latest[w]), key=lambda w: latest[w], reverse=True)

    def query(self, world_id: int, since_ms: int, player: str | None = None,
              target_type: str | None = None, tunnels: list[dict] | None = None) -> dict:
        """
        Dashboard data for one world from since_ms on: the attack list (newest
        first), totals, the tunnel clusters and the players seen in the period
        (the player dropdown — unaffected by the player/type filter).
        """
        in_period = [r for r in self._load(world_id) if r.get("timestamp", 0) >= since_ms]
        players = sorted({r["playerName"] for r in in_period}, key=str.lower)
        rows = [
            r for r in in_period
            if (not player or r["playerName"].lower() == player.lower())
            and (not target_type or r["targetType"] == target_type)
        ]
        rows.sort(key=lambda r: r["timestamp"], reverse=True)
        attacks = [_public(r) for r in rows]
        return {
            "worldId": world_id,
            "since": since_ms,
            "summary": _totals(attacks),
            "tunnels": cluster_attacks(attacks, centers=tunnels),
            "attacks": attacks,
            "players": players,
        }

    # ─── Internals ───────────────────────────────────────────────────

    def _file(self, world_id: int) -> Path:
        return self.dir / f"{int(world_id)}.jsonl"

    def _load(self, world_id: int) -> list[dict]:
        if world_id not in self._worlds:
            path = self._file(world_id) if self.dir is not None else None
            self._worlds[world_id] = _read(path) if path is not None and path.exists() else []
        return self._worlds[world_id]


def cluster_attacks(attacks: list[dict], radius: float = TUNNEL_RADIUS,
                    centers: list[dict] | None = None) -> list[dict]:
    """
    Group attacks into tunnel clusters (see the module doc). `centers` are
    known tunnels ({x, y, level?}); positions within `radius` of one join the
    nearest, the rest are clustered automatically. Clusters: most attacks first.
    """
    by_pos: dict[tuple[int, int], list[dict]] = {}
    for a in attacks:
        by_pos.setdefault((a["targetX"], a["targetY"]), []).append(a)

    clusters: list[dict] = []
    for c in centers or []:
        clusters.append({"cx": c["x"], "cy": c["y"], "known": True, "level": c.get("level"), "positions": []})

    def nearest(pos):
        best, best_d = None, None
        for cl in clusters:
            d = math.hypot(pos[0] - cl["cx"], pos[1] - cl["cy"])
            if d <= radius and (best_d is None or d < best_d):
                best, best_d = cl, d
        return best

    # Most-attacked position first, so it becomes the centre; coordinates break ties (deterministic)
    for pos in sorted(by_pos, key=lambda p: (-len(by_pos[p]), p[0], p[1])):
        cl = nearest(pos)
        if cl is None:
            cl = {"cx": pos[0], "cy": pos[1], "known": False, "level": None, "positions": []}
            clusters.append(cl)
        cl["positions"].append(pos)

    result = []
    for cl in clusters:
        rows = [a for pos in cl["positions"] for a in by_pos[pos]]
        if not rows:
            continue
        rows.sort(key=lambda a: a["timestamp"], reverse=True)
        if cl["known"]:
            x, y = cl["cx"], cl["cy"]
        else:
            x = round(sum(a["targetX"] for a in rows) / len(rows))
            y = round(sum(a["targetY"] for a in rows) / len(rows))
        per_player: dict[str, dict] = {}
        for a in rows:
            p = per_player.setdefault(a["playerName"], {"playerName": a["playerName"], "attacks": 0,
                                                         "lootTib": 0, "lootCrystal": 0, "lootCredits": 0})
            p["attacks"] += 1
            for k in ("lootTib", "lootCrystal", "lootCredits"):
                p[k] += a[k]
        levels = [a["targetLevel"] for a in rows]
        result.append({
            "x": x,
            "y": y,
            "known": cl["known"],
            "tunnelLevel": cl["level"],
            "minLevel": min(levels),
            "maxLevel": max(levels),
            **_totals(rows),
            "lastAt": rows[0]["timestamp"],
            "contributors": sorted(per_player.values(), key=lambda p: (-p["attacks"], -p["lootTib"], p["playerName"].lower())),
            "attackList": rows,
        })
    result.sort(key=lambda c: (-c["attacks"], -c["lastAt"]))
    return result


def _same_attack(record: dict, payload: AttackPayload, player_id: int) -> bool:
    if record.get("playerId") != player_id:
        return False
    if payload.reportId is not None and record.get("reportId") is not None:
        return record["reportId"] == payload.reportId
    return (record.get("targetX") == payload.targetX and record.get("targetY") == payload.targetY
            and abs(record.get("timestamp", 0) - payload.timestamp) <= DEDUP_WINDOW_MS)


def _public(r: dict) -> dict:
    """What the dashboard gets per attack (no scope / receivedAt / reportId)."""
    return {
        "timestamp": r["timestamp"],
        "playerId": r["playerId"],
        "playerName": r["playerName"],
        "targetType": r["targetType"],
        "targetLevel": r["targetLevel"],
        "targetX": r["targetX"],
        "targetY": r["targetY"],
        "lootTib": r.get("lootTib", 0),
        "lootCrystal": r.get("lootCrystal", 0),
        "lootCredits": r.get("lootCredits", 0),
    }


def _totals(rows: list[dict]) -> dict:
    return {
        "attacks": len(rows),
        "players": len({r["playerId"] for r in rows}),
        "lootTib": sum(r["lootTib"] for r in rows),
        "lootCrystal": sum(r["lootCrystal"] for r in rows),
        "lootCredits": sum(r["lootCredits"] for r in rows),
    }


def _read(path: Path) -> list[dict]:
    records = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError as e:
        log.warning("Attacks: cannot read %s: %s", path, e)
    return records


def _line_count(path: Path) -> int:
    try:
        with open(path) as f:
            return sum(1 for line in f if line.strip())
    except OSError:
        return 0
