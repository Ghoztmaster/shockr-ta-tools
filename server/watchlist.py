"""
WatchList — players claim Forgotten targets they intend to attack.

Unlike Target Watch (automatic, 10-minute "I'm looking at this"), a claim is
set by hand (`/st watch` in the game) and stays until the player removes it,
wins an attack on it, or CLAIM_TTL_SECONDS (24 h) pass.

POST /api/watchlist (userscript, X-Player-Key) carries an `action`:
  claim        claim the target at targetX:targetY. If another player of the
               same scope already claims it, nothing is stored and the answer
               is status "conflict" with those claims — unless `force` is set,
               then the claim is added NEXT to theirs (it never removes another
               player's claim; "one claim per player per coordinate").
               Claiming your own target again refreshes claimedAt.
  unclaim      remove your claim at targetX:targetY
  unclaim_all  remove all your claims in worldId
  list         active claims in worldId (same scope) — read-only; the
               userscript uses it for the "claimed by X" warning while viewing.
               A POST action instead of a GET so the one nginx CORS block
               (POST, OPTIONS) covers everything the userscript calls.

Auto-unclaim: a won attack stored via POST /api/attack on the same coordinate
by the same player removes that player's claim there — only claims made at or
before the attack's time (a claim made after the attack, with the report
arriving late, stays).

Storage: in memory, backed up per world to data/watchlist/{worldId}.json
(whole file rewritten atomically on every change). Expired claims are removed
lazily on every access. Needs a single uvicorn worker, as in the Dockerfile.
"""
import json
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

log = logging.getLogger("shockr-alliance")

TARGET_TYPES = ("camp", "outpost", "base")
ACTIONS = ("claim", "unclaim", "unclaim_all", "list")
CLAIM_TTL_SECONDS = 24 * 3600


class WatchlistPayload(BaseModel):
    """POST /api/watchlist body (camelCase, as sent by plugins/watchlist.js)."""
    model_config = ConfigDict(extra="ignore")

    action: str = Field(max_length=20)
    worldId: int = Field(ge=1, le=999)
    targetX: int | None = Field(default=None, ge=0, le=1600)
    targetY: int | None = Field(default=None, ge=0, le=1600)
    targetLevel: float = Field(default=0, ge=0, le=100)
    targetType: str = Field(default="", max_length=20)
    force: bool = False

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ACTIONS:
            raise ValueError(f"action must be one of {', '.join(ACTIONS)}")
        return v

    @field_validator("targetType")
    @classmethod
    def validate_target_type(cls, v: str) -> str:
        v = v.strip().lower()
        if v and v not in TARGET_TYPES:
            raise ValueError("targetType must be camp, outpost or base")
        return v

    @model_validator(mode="after")
    def required_per_action(self):
        if self.action in ("claim", "unclaim") and (self.targetX is None or self.targetY is None):
            raise ValueError(f"{self.action} needs targetX and targetY")
        if self.action == "claim" and not self.targetType:
            raise ValueError("claim needs targetType (camp, outpost or base)")
        return self


class ClaimNotFound(Exception):
    pass


class ClaimForbidden(Exception):
    pass


class WatchlistStore:
    def __init__(self, data_dir: Path | None, ttl_seconds: int = CLAIM_TTL_SECONDS,
                 clock: Callable[[], float] = time.time):
        """data_dir None = memory only (tests)."""
        self.dir = data_dir / "watchlist" if data_dir is not None else None
        self.ttl = ttl_seconds
        self.clock = clock
        self._worlds: dict[int, list[dict]] = {}
        self._all_loaded = False

    # ─── Write ───────────────────────────────────────────────────────

    def claim(self, world_id: int, scope: str, player_id: int, player_name: str,
              x: int, y: int, level: float, target_type: str, force: bool = False) -> dict:
        """
        {"status": "claimed"|"refreshed"|"conflict", "claim": public claim or None,
         "others": other players' claims on this coordinate (same scope)}.
        """
        claims = self._claims(world_id)
        others = [c for c in claims if _at(c, x, y) and c["scope"] == scope and c["playerId"] != player_id]
        if others and not force:
            return {"status": "conflict", "claim": None, "others": [_public(c) for c in others]}

        now_ms = self._now_ms()
        own = next((c for c in claims if _at(c, x, y) and c["playerId"] == player_id), None)
        status = "refreshed" if own else "claimed"
        if own is None:
            own = {"id": secrets.token_hex(8), "playerId": player_id, "worldId": world_id,
                   "targetX": x, "targetY": y}
            claims.append(own)
        own.update({
            "playerName": player_name,
            "scope": scope,
            "targetType": target_type,
            "targetLevel": level,
            "claimedAt": now_ms,
        })
        self._save(world_id)
        return {"status": status, "claim": _public(own), "others": [_public(c) for c in others]}

    def unclaim(self, world_id: int, player_id: int, x: int | None = None, y: int | None = None) -> list[dict]:
        """Remove the player's claim at x:y, or all their claims in the world when x/y are None."""
        def mine(c):
            return c["playerId"] == player_id and (x is None or _at(c, x, y))
        return self._remove(world_id, mine)

    def on_attack(self, world_id: int, player_id: int, x: int, y: int, attack_ms: int) -> list[dict]:
        """Won attack stored: drop the player's claim on that target if it was made before the attack."""
        return self._remove(world_id, lambda c: c["playerId"] == player_id and _at(c, x, y)
                            and c["claimedAt"] <= attack_ms)

    def delete(self, claim_id: str, player_id: int | None) -> dict:
        """Delete by id. player_id None = admin (any claim); else only the player's own."""
        self._load_all()
        for world_id in list(self._worlds):
            for c in self._claims(world_id):
                if c["id"] != claim_id:
                    continue
                if player_id is not None and c["playerId"] != player_id:
                    raise ClaimForbidden(claim_id)
                self._remove(world_id, lambda r: r["id"] == claim_id)
                return _public(c)
        raise ClaimNotFound(claim_id)

    # ─── Read ────────────────────────────────────────────────────────

    def active(self, world_id: int, scope: str | None = None) -> list[dict]:
        """Active claims of a world, newest first; scope None = every scope (website)."""
        rows = [c for c in self._claims(world_id) if scope is None or c["scope"] == scope]
        rows.sort(key=lambda c: c["claimedAt"], reverse=True)
        return [_public(c) for c in rows]

    def worlds(self) -> list[int]:
        """World ids with active claims, most recent claim first."""
        self._load_all()
        latest = {w: max((c["claimedAt"] for c in self._claims(w)), default=0) for w in list(self._worlds)}
        return sorted((w for w, t in latest.items() if t), key=lambda w: latest[w], reverse=True)

    # ─── Internals ───────────────────────────────────────────────────

    def _now_ms(self) -> int:
        return int(self.clock() * 1000)

    def _claims(self, world_id: int) -> list[dict]:
        """The world's claims with expired ones removed (and the file rewritten if any were)."""
        if world_id not in self._worlds:
            self._worlds[world_id] = self._read(world_id)
        claims = self._worlds[world_id]
        cutoff = self._now_ms() - self.ttl * 1000
        fresh = [c for c in claims if c.get("claimedAt", 0) >= cutoff]
        if len(fresh) != len(claims):
            self._worlds[world_id] = fresh
            self._save(world_id)
        return self._worlds[world_id]

    def _remove(self, world_id: int, match: Callable[[dict], bool]) -> list[dict]:
        claims = self._claims(world_id)
        removed = [c for c in claims if match(c)]
        if removed:
            self._worlds[world_id] = [c for c in claims if not match(c)]
            self._save(world_id)
        return [_public(c) for c in removed]

    def _file(self, world_id: int) -> Path:
        return self.dir / f"{int(world_id)}.json"

    def _read(self, world_id: int) -> list[dict]:
        if self.dir is None:
            return []
        path = self._file(world_id)
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as e:
            log.warning("Watchlist: cannot read %s: %s", path, e)
            return []
        required = {"id", "playerId", "targetX", "targetY", "claimedAt", "scope"}
        return [c for c in data.get("claims", []) if isinstance(c, dict) and required <= set(c)]

    def _load_all(self) -> None:
        if self._all_loaded:
            return
        self._all_loaded = True
        if self.dir is None or not self.dir.exists():
            return
        for path in self.dir.glob("*.json"):
            if path.stem.isdigit() and int(path.stem) not in self._worlds:
                self._worlds[int(path.stem)] = self._read(int(path.stem))

    def _save(self, world_id: int) -> None:
        if self.dir is None:
            return
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            path = self._file(world_id)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps({"worldId": world_id, "claims": self._worlds.get(world_id, [])},
                                      separators=(",", ":")))
            os.replace(tmp, path)
        except OSError as e:
            log.warning("Watchlist: cannot write world %s: %s", world_id, e)


def _at(claim: dict, x: int, y: int) -> bool:
    return claim["targetX"] == x and claim["targetY"] == y


def _public(c: dict) -> dict:
    """What clients get per claim (no scope)."""
    return {
        "id": c["id"],
        "playerId": c["playerId"],
        "playerName": c.get("playerName", ""),
        "targetType": c.get("targetType", ""),
        "targetLevel": c.get("targetLevel", 0),
        "targetX": c["targetX"],
        "targetY": c["targetY"],
        "worldId": c.get("worldId"),
        "claimedAt": c["claimedAt"],
    }
