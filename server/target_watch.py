"""
Target Watch — who in the alliance is looking at which target (Fase 6c).

Pure in-memory, no persistence: a watch only lives 10 minutes, so a restart
losing it is harmless. Requires a single uvicorn worker (as in the Dockerfile);
with more workers each would hold its own copy.

Structure (scoped per alliance, derived from the API key — never from input):
    watches[alliance_id][world_id][target_id] = {
        "target":   {targetId, targetName, targetX, targetY, targetLevel, targetType},
        "watchers": {player_id: {playerId, playerName, timestamp}},
    }

Timestamps are server time (unix seconds) at receipt, so TTL and "sinds X min"
do not depend on the player's clock. A repeated POST by the same player on the
same target overwrites that player's entry (refreshes the timestamp).
Expired entries are removed lazily on every request.
"""
import re
import time
from typing import Callable

from pydantic import BaseModel, Field, field_validator

TTL_SECONDS = 10 * 60

TARGET_TYPE_PATTERN = re.compile(r'^[a-z]{0,20}$')


class TargetWatchPayload(BaseModel):
    """Incoming watch from the userscript (camelCase, as sent by target-watcher.js)."""
    playerId: int = Field(gt=0)
    playerName: str = Field(max_length=50)
    targetId: int = Field(gt=0)
    targetName: str = Field(max_length=50, default="")
    targetX: int = Field(ge=0, le=1600)
    targetY: int = Field(ge=0, le=1600)
    targetLevel: float = Field(ge=0, le=100)
    targetType: str = Field(max_length=20, default="")
    worldId: int = Field(ge=1, le=999)
    timestamp: int = Field(ge=0, default=0)

    @field_validator('playerName', 'targetName')
    @classmethod
    def strip_strings(cls, v: str) -> str:
        return v.strip()

    @field_validator('targetType')
    @classmethod
    def validate_target_type(cls, v: str) -> str:
        v = v.strip().lower()
        if not TARGET_TYPE_PATTERN.match(v):
            raise ValueError('Invalid target type')
        return v


class TargetWatchStore:
    def __init__(self, ttl_seconds: int = TTL_SECONDS, clock: Callable[[], float] = time.time):
        self.ttl = ttl_seconds
        self.clock = clock
        self.watches: dict[str, dict[int, dict[int, dict]]] = {}

    def add(self, alliance_id: str, payload: TargetWatchPayload) -> None:
        """Register (or refresh) a player watching a target."""
        now = int(self.clock())
        self._cleanup(now)

        world = self.watches.setdefault(alliance_id, {}).setdefault(payload.worldId, {})
        entry = world.setdefault(payload.targetId, {"target": {}, "watchers": {}})
        entry["target"] = {
            "targetId": payload.targetId,
            "targetName": payload.targetName,
            "targetX": payload.targetX,
            "targetY": payload.targetY,
            "targetLevel": payload.targetLevel,
            "targetType": payload.targetType,
        }
        entry["watchers"][payload.playerId] = {
            "playerId": payload.playerId,
            "playerName": payload.playerName,
            "timestamp": now,
        }

    def get_watchers(self, alliance_id: str, world_id: int, target_id: int) -> list[dict]:
        """Active watchers of one target, most recent first."""
        self._cleanup(int(self.clock()))
        entry = self.watches.get(alliance_id, {}).get(world_id, {}).get(target_id)
        if not entry:
            return []
        return _sorted_watchers(entry)

    def get_world(self, alliance_id: str, world_id: int) -> list[dict]:
        """All watched targets of a world with their active watchers, most recent first."""
        self._cleanup(int(self.clock()))
        targets = [
            {**entry["target"], "watchers": _sorted_watchers(entry)}
            for entry in self.watches.get(alliance_id, {}).get(world_id, {}).values()
        ]
        targets.sort(key=lambda t: t["watchers"][0]["timestamp"], reverse=True)
        return targets

    def all_worlds(self) -> list[dict]:
        """
        Every world with active watches, for the dashboard (viewer, behind
        Basic Auth — like /api/bases it spans all alliances on this server).
        A target watched from several alliances is merged into one row.
        Targets: most watchers first, then most recent.
        """
        self._cleanup(int(self.clock()))
        merged: dict[int, dict[int, dict]] = {}
        for worlds in self.watches.values():
            for world_id, targets in worlds.items():
                world = merged.setdefault(world_id, {})
                for target_id, entry in targets.items():
                    row = world.setdefault(target_id, {"target": entry["target"], "watchers": {}})
                    for player_id, watcher in entry["watchers"].items():
                        known = row["watchers"].get(player_id)
                        if not known or watcher["timestamp"] > known["timestamp"]:
                            row["watchers"][player_id] = watcher

        result = []
        for world_id in sorted(merged):
            targets = [{**row["target"], "watchers": _sorted_watchers(row)} for row in merged[world_id].values()]
            targets.sort(key=lambda t: (len(t["watchers"]), t["watchers"][0]["timestamp"]), reverse=True)
            result.append({"worldId": world_id, "targets": targets})
        return result

    def _cleanup(self, now: int) -> None:
        """Drop expired watchers, and targets/worlds/alliances left empty."""
        cutoff = now - self.ttl
        for alliance_id in list(self.watches):
            worlds = self.watches[alliance_id]
            for world_id in list(worlds):
                targets = worlds[world_id]
                for target_id in list(targets):
                    watchers = targets[target_id]["watchers"]
                    for player_id in [p for p, w in watchers.items() if w["timestamp"] < cutoff]:
                        del watchers[player_id]
                    if not watchers:
                        del targets[target_id]
                if not targets:
                    del worlds[world_id]
            if not worlds:
                del self.watches[alliance_id]


def _sorted_watchers(entry: dict) -> list[dict]:
    return sorted(entry["watchers"].values(), key=lambda w: w["timestamp"], reverse=True)
