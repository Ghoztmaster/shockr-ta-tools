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

Restore (POST /api/enroll/restore, 5.25.0): a player whose browser lost the key
(script re-created by a Tampermonkey "Import") but who still has it from an
export sends {playerId, key}; the server verifies it against the stored hash
and answers 200 - nothing is issued or changed, the key simply stays valid.
Any other case is 403 KEY_NOT_VALID, with no hint whether the player exists.

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
ALREADY_REGISTERED = "Already registered"
KEY_NOT_VALID = "Key not valid"


class EnrollPayload(BaseModel):
    playerId: int = Field(gt=0)
    playerName: str = Field(min_length=1, max_length=50)
    allianceId: int = Field(gt=0)
    worldId: int = Field(ge=0)
    enrollmentCode: str = Field(min_length=1, max_length=100)
    # 5.24.0: false = refuse (409) when the player already has a key, so the
    # userscript can warn that a new key invalidates the old one; true = the
    # player confirmed. Absent (older userscripts) = replace, as before.
    replace: bool | None = None


class RestorePayload(BaseModel):
    """POST /api/enroll/restore: the player's own id + the key they still have."""
    playerId: int = Field(gt=0)
    key: str = Field(min_length=1, max_length=100)


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


# ─── Auto-revoke: key holders who left the alliance ──────────────────
#
# The userscript sends its in-game alliance member list with a scan
# (allianceMembers on POST /api/scan: first scan batch after login, then once
# per hour). Per alliance the server keeps each scanner's LATEST list in memory
# (lost on restart - it fills again within the hour). At most once per hour per
# alliance it compares the lists with the registered keys of that alliance:
#
#   - a key holder counts as "missing" for a scanner when that scanner's list
#     (at most REPORT_MAX_AGE_S old, sent AFTER the key was issued) lacks them.
#     The "sent after the key" rule lets a player who comes back and does
#     /st register again keep the new key; the old lists don't count.
#   - REVOKE_MIN_SCANNERS (3) different scanners missing them -> key revoked
#     (removed from player_keys.jsonl, website sessions end with it). Not
#     restored: a returning player registers again.
#   - fewer -> only a WARNING, never a revoke, so one broken script can't
#     throw everybody out.
#   - the most recent list that mentions the player wins: if it still has
#     them, nobody is revoked (conflicting lists = no action).
#   - a list that doesn't contain its own scanner is ignored (broken read).

REVOKE_MIN_SCANNERS = 3
CHECK_INTERVAL_S = 3600
REPORT_MAX_AGE_S = 24 * 3600
MAX_ALLIANCE_MEMBERS = 500


class AllianceMember(BaseModel):
    playerId: int = Field(gt=0)
    playerName: str = Field(default="", max_length=50)


class AllianceMembershipCheck:
    def __init__(self, clock: Callable[[], float] = time.time,
                 min_scanners: int = REVOKE_MIN_SCANNERS, interval_s: float = CHECK_INTERVAL_S,
                 max_age_s: float = REPORT_MAX_AGE_S):
        self.clock = clock
        self.min_scanners = min_scanners
        self.interval_s = interval_s
        self.max_age_s = max_age_s
        # alliance id -> scanner playerId -> (received at, member playerIds)
        self._reports: dict[int, dict[int, tuple[float, frozenset[int]]]] = {}
        self._last_run: dict[int, float] = {}

    def check_alliance_membership(self, keys: PlayerKeyStore, alliance_id: int, scanner_id: int,
                                  members: list[AllianceMember]) -> list[int]:
        """
        Record one scanner's member list and, when the hourly comparison is
        due, revoke the keys of players at least min_scanners scanners no
        longer see. @returns the revoked playerIds (empty when nothing ran).
        """
        now = self.clock()
        ids = frozenset(m.playerId for m in members)
        if scanner_id not in ids:
            log.warning("Alliance list from %d ignored: the scanner itself is not in it (%d member(s))",
                        scanner_id, len(ids))
            return []
        self._reports.setdefault(alliance_id, {})[scanner_id] = (now, ids)
        if now - self._last_run.get(alliance_id, float("-inf")) < self.interval_s:
            return []
        self._last_run[alliance_id] = now
        return self._compare(keys, alliance_id, now)

    def _compare(self, keys: PlayerKeyStore, alliance_id: int, now: float) -> list[int]:
        reports = {s: r for s, r in self._reports.get(alliance_id, {}).items() if now - r[0] <= self.max_age_s}
        self._reports[alliance_id] = reports
        revoked = []
        for pid, entry in list(keys.players.items()):
            if entry.get("allianceId") != alliance_id:
                continue
            issued = _timestamp(entry.get("createdAt"))
            missing = [t for s, (t, ids) in reports.items() if pid not in ids and s != pid and t > issued]
            if not missing:
                continue
            name = entry.get("playerName") or str(pid)
            seen = [t for t, ids in reports.values() if pid in ids]
            if seen and max(seen) > max(missing):
                log.warning("%s (%d) not in the alliance list of %d scanner(s), but a newer list still has them — no revoke",
                            name, pid, len(missing))
                continue
            if len(missing) < self.min_scanners:
                log.warning("%s not in alliance list (reported by %d/%d required scanners)",
                            name, len(missing), self.min_scanners)
                continue
            if keys.revoke(pid):
                log.info("Key revoked: %s (%d) — no longer in alliance", name, pid)
                revoked.append(pid)
        return revoked
