"""
Per-player API keys with self-enrollment (replaces the shared X-Alliance-Key).

Enrollment (POST /api/enroll): the player sends their in-game identity plus the
enrollment code, which is shared only in the alliance chat. The code and the
whitelisted in-game alliance ids live in config/enrollment.json, edited by hand
on the VPS and re-read automatically when the file changes:

    {"code": "...", "allianceIds": [100], "scope": "SoO", "allianceKeyUntil": "2026-11-01"}

  - code              enrollment code (never in the repo or the userscript)
  - allianceIds       in-game alliance ids allowed to enroll
  - scope (optional)  storage scope for scans/target-watch — use the name from
                      config/keys.json so player-key and shared-key users share
                      the same data. Default: that name when keys.json holds
                      exactly one alliance, else the in-game alliance id.
  - allianceKeyUntil  (optional) last day (UTC, inclusive) the shared
                      X-Alliance-Key is accepted; absent = no deadline.

Keys: 32-char hex (secrets.token_hex(16)), stored as a bcrypt hash; the
plaintext is returned once. Enrolling again with the same playerId issues a
NEW key and invalidates the old one (the old plaintext can't be recovered).

Storage: data/player_keys.jsonl, one line per registered player. Enrolling
again and revoking OVERWRITE that player's line: the whole file is rewritten
atomically (temp file + rename), so it never holds an old key. Files from
before this (append-only: several lines per player, {"playerId": N,
"revoked": true} tombstones) are still read: per player the line with the
newest createdAt/revokedAt wins (file order breaks a tie), and the file is
rewritten clean on startup.
"""
import hashlib
import json
import logging
import secrets
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable

import bcrypt
from pydantic import BaseModel, Field

log = logging.getLogger("shockr-alliance")

INVALID_CODE = "Invalid enrollment code"
ALLIANCE_NOT_AUTHORIZED = "Alliance not authorized"
NOT_REGISTERED = "Not registered — type /st register"
INVALID_PLAYER_KEY = "Invalid player key"


class EnrollPayload(BaseModel):
    playerId: int = Field(gt=0)
    playerName: str = Field(min_length=1, max_length=50)
    allianceId: int = Field(gt=0)
    worldId: int = Field(ge=0)
    enrollmentCode: str = Field(min_length=1, max_length=100)


class EnrollmentError(Exception):
    """Enrollment rejected (→ 403 with str(e) as detail)."""


class EnrollmentConfig:
    """config/enrollment.json, re-read whenever its mtime changes."""

    def __init__(self, path: Path):
        self.path = path
        self._mtime: float | None = None
        self.code = ""
        self.alliance_ids: set[int] = set()
        self.scope: str | None = None
        self.alliance_key_until: date | None = None

    def reload_if_changed(self) -> None:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            if self._mtime is not None:
                log.warning("Enrollment config %s disappeared — enrollment disabled", self.path)
            self._mtime = None
            self.code, self.alliance_ids, self.scope, self.alliance_key_until = "", set(), None, None
            return
        if mtime == self._mtime:
            return
        try:
            with open(self.path) as f:
                data = json.load(f)
            code = str(data.get("code") or "")
            alliance_ids = {int(a) for a in data.get("allianceIds") or []}
            scope = str(data["scope"]) if data.get("scope") else None
            until = data.get("allianceKeyUntil")
            until = date.fromisoformat(until) if until else None
        except (OSError, ValueError, TypeError, AttributeError) as e:
            log.warning("Could not load %s: %s — keeping previous settings", self.path, e)
            return
        self._mtime = mtime
        self.code, self.alliance_ids, self.scope, self.alliance_key_until = code, alliance_ids, scope, until
        log.info("Enrollment config loaded: %d alliance id(s), shared key until %s",
                 len(alliance_ids), until or "no deadline")

    def check_code(self, code: str) -> bool:
        self.reload_if_changed()
        return bool(self.code) and secrets.compare_digest(code.encode(), self.code.encode())

    def alliance_key_allowed(self, today: date | None = None) -> bool:
        self.reload_if_changed()
        if self.alliance_key_until is None:
            return True
        today = today or datetime.now(timezone.utc).date()
        return today <= self.alliance_key_until


def _fingerprint(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


class PlayerKeyStore:
    def __init__(self, path: Path | None, clock: Callable[[], float] = time.time):
        self.path = path
        self.clock = clock
        self.players: dict[int, dict] = {}
        # playerId → SHA-256 of the last key that passed bcrypt (skip bcrypt per request)
        self._verified: dict[int, str] = {}
        self.load()

    def load(self) -> None:
        if not self.path or not self.path.exists():
            return
        # playerId -> ((timestamp, line number), entry or None for a revoke)
        latest: dict[int, tuple[tuple[float, int], dict | None]] = {}
        lines = 0
        try:
            with open(self.path) as f:
                for lineno, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    lines += 1
                    try:
                        entry = json.loads(line)
                        pid = int(entry["playerId"])
                    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                        continue
                    if entry.get("revoked"):
                        rank, value = (_timestamp(entry.get("revokedAt")), lineno), None
                    elif entry.get("playerKey"):
                        rank, value = (_timestamp(entry.get("createdAt")), lineno), entry
                    else:
                        continue
                    if pid not in latest or rank > latest[pid][0]:
                        latest[pid] = (rank, value)
        except OSError as e:
            log.warning("Could not read %s: %s", self.path, e)
            return
        self.players = {pid: entry for pid, (_, entry) in latest.items() if entry is not None}
        if lines != len(self.players):
            self._save()
        log.info("Loaded %d player key(s)%s", len(self.players),
                 f" (file had {lines} line(s), rewritten)" if lines != len(self.players) else "")

    def enroll(self, player_id: int, player_name: str, alliance_id: int, scope: str) -> str:
        """Issue a new key for the player (replacing any previous one). @returns the plaintext key"""
        raw_key = secrets.token_hex(16)
        entry = {
            "playerId": player_id,
            "playerName": player_name,
            "allianceId": alliance_id,
            "scope": scope,
            "playerKey": bcrypt.hashpw(raw_key.encode(), bcrypt.gensalt()).decode(),
            "createdAt": int(self.clock()),
        }
        replaced = player_id in self.players
        self.players[player_id] = entry
        self._verified.pop(player_id, None)
        self._save()   # overwrites the player's previous line
        log.info("Player key %s: %s (%d), alliance %d, scope %s",
                 "re-issued" if replaced else "issued", player_name, player_id, alliance_id, scope)
        return raw_key

    def verify(self, player_id: int, raw_key: str) -> dict | None:
        """The player's entry if raw_key is their current key, else None."""
        entry = self.players.get(player_id)
        if entry is None:
            return None
        fp = _fingerprint(raw_key)
        if self._verified.get(player_id) == fp:
            return entry
        try:
            ok = bcrypt.checkpw(raw_key.encode(), entry["playerKey"].encode())
        except (ValueError, KeyError):
            ok = False
        if not ok:
            return None
        self._verified[player_id] = fp
        return entry

    def revoke(self, player_id: int) -> bool:
        if self.players.pop(player_id, None) is None:
            return False
        self._verified.pop(player_id, None)
        self._save()   # the player's line is gone
        log.info("Player key revoked: %d", player_id)
        return True

    def list(self) -> list[dict]:
        """Registered players without key hashes."""
        return [{k: v for k, v in e.items() if k != "playerKey"} for e in self.players.values()]

    def _save(self) -> None:
        """Write every current player, one line each (temp file + atomic rename)."""
        if not self.path:
            return
        tmp = self.path.with_suffix(".jsonl.tmp")
        try:
            with open(tmp, "w") as f:
                for entry in self.players.values():
                    f.write(json.dumps(entry, separators=(",", ":")) + "\n")
            tmp.replace(self.path)
        except OSError as e:
            log.warning("Could not write %s: %s", self.path, e)


def _timestamp(value) -> float:
    """createdAt/revokedAt as a number; missing or unreadable sorts oldest."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("-inf")
