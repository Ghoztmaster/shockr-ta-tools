"""
Alliance members — extra auth layer on top of the X-Alliance-Key check.

Every request to /api/scan and /api/target-watch identifies the player
(X-Player-Id / X-Player-Name / X-Alliance-Id headers, sent by the userscript):
  - unknown player + valid key → registered automatically (bootstrap)
  - known player → in-game alliance id must still match the registered one,
    otherwise 403 (player switched alliance)
  - not seen for 30 days → dropped (lazy cleanup on every check)

The web viewer endpoints (/api/bases, /api/targets, ...) are not affected.

Storage: in-memory dict, persisted as an append-only log in data/members.jsonl.
A line is written on registration, on a name change and at most once per hour
per player for lastSeen; on startup the latest line per player wins, expired
players are dropped and the file is compacted.
"""
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger("shockr-alliance")

MEMBER_TTL_SECONDS = 30 * 24 * 3600
LAST_SEEN_WRITE_INTERVAL = 3600

NOT_A_MEMBER = "Not a recognized alliance member. Scan a base first to register."


class MembershipError(Exception):
    """Request rejected by the membership check (→ 403)."""


def key_fingerprint(raw_key: str) -> str:
    """Short SHA-256 of the API key a player registered with (audit only)."""
    return hashlib.sha256(raw_key.encode()).hexdigest()[:16]


class MemberStore:
    def __init__(self, path: Path | None, ttl_seconds: int = MEMBER_TTL_SECONDS,
                 clock: Callable[[], float] = time.time):
        self.path = path
        self.ttl = ttl_seconds
        self.clock = clock
        self.members: dict[int, dict] = {}
        self._last_written: dict[int, int] = {}
        self.load()

    def load(self) -> None:
        """Read the log (latest entry per player wins), drop expired players, compact."""
        if not self.path or not self.path.exists():
            return
        try:
            with open(self.path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        self.members[int(entry["playerId"])] = entry
                    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                        continue
        except OSError as e:
            log.warning("Could not read %s: %s", self.path, e)
            return
        self._cleanup(int(self.clock()))
        self._last_written = {pid: m["lastSeen"] for pid, m in self.members.items()}
        self._compact()
        log.info("Loaded %d alliance member(s)", len(self.members))

    def check(self, player_id: int, player_name: str, alliance_id: int, raw_key: str) -> dict:
        """
        Accept (and register/refresh) a player, or raise MembershipError.
        @returns the member entry
        """
        if player_id <= 0 or alliance_id <= 0:
            raise MembershipError(NOT_A_MEMBER)

        now = int(self.clock())
        self._cleanup(now)
        member = self.members.get(player_id)

        if member is None:
            member = {
                "playerId": player_id,
                "playerName": player_name,
                "allianceId": alliance_id,
                "allianceKey": key_fingerprint(raw_key),
                "firstSeen": now,
                "lastSeen": now,
            }
            self.members[player_id] = member
            self._write(member)
            log.info("Member registered: %s (%d), alliance %d", player_name, player_id, alliance_id)
            return member

        if member["allianceId"] != alliance_id:
            log.warning("Member %s (%d) rejected: alliance %d, registered with %d",
                        player_name, player_id, alliance_id, member["allianceId"])
            raise MembershipError(NOT_A_MEMBER)

        renamed = player_name and member["playerName"] != player_name
        if renamed:
            member["playerName"] = player_name
        member["lastSeen"] = now
        if renamed or now - self._last_written.get(player_id, 0) >= LAST_SEEN_WRITE_INTERVAL:
            self._write(member)
        return member

    def _cleanup(self, now: int) -> None:
        cutoff = now - self.ttl
        for pid in [pid for pid, m in self.members.items() if m.get("lastSeen", 0) < cutoff]:
            log.info("Member expired: %s (%d)", self.members[pid].get("playerName"), pid)
            del self.members[pid]
            self._last_written.pop(pid, None)

    def _write(self, member: dict) -> None:
        self._last_written[member["playerId"]] = member["lastSeen"]
        if not self.path:
            return
        try:
            with open(self.path, "a") as f:
                f.write(json.dumps(member, separators=(",", ":")) + "\n")
        except OSError as e:
            log.warning("Could not write %s: %s", self.path, e)

    def _compact(self) -> None:
        """Rewrite the log with one line per current member."""
        if not self.path:
            return
        tmp = self.path.with_suffix(".jsonl.tmp")
        try:
            with open(tmp, "w") as f:
                for member in self.members.values():
                    f.write(json.dumps(member, separators=(",", ":")) + "\n")
            tmp.replace(self.path)
        except OSError as e:
            log.warning("Could not compact %s: %s", self.path, e)
