"""
Website login with the personal API key (replaces the shared Basic Auth
password on /shockr/).

A player logs in on /login with their player name + the key they got via
/st register. The key is checked by PlayerKeyStore.verify() — the same check
the scan/target-watch endpoints use for X-Player-Key — so there is no second
copy of the key logic and no password is stored. A successful login creates a
random session token, kept server-side and handed out as the HTTP-only cookie
`shockr_session`.

Sessions are in-memory (like target_watch), 7-day TTL, removed lazily. A
restart logs everyone out (accepted). A session is also dropped as soon as the
player's key is revoked (DELETE /api/enroll/{id}) or re-issued (/st register
again): the session remembers the stored key hash it was opened with and that
must still be the player's current one. So revoking a player who left the
alliance locks them out of the website immediately, not after 7 days.

Requires a single uvicorn worker (as in the Dockerfile).
"""
import secrets
import time
from typing import Callable

from pydantic import BaseModel, Field

from server.player_keys import PlayerKeyStore

SESSION_COOKIE = "shockr_session"
SESSION_TTL_SECONDS = 7 * 24 * 3600
LOGIN_FAILED = "Onbekende speler of ongeldige key"


class LoginPayload(BaseModel):
    playerName: str = Field(min_length=1, max_length=50)
    apiKey: str = Field(min_length=1, max_length=100)


class SessionStore:
    def __init__(self, player_keys: PlayerKeyStore,
                 ttl_seconds: int = SESSION_TTL_SECONDS,
                 clock: Callable[[], float] = time.time):
        self.player_keys = player_keys
        self.ttl = ttl_seconds
        self.clock = clock
        self.sessions: dict[str, dict] = {}

    def login(self, player_name: str, api_key: str) -> tuple[str, dict] | None:
        """(token, session) when the name + key belong to an enrolled player, else None.

        Name match is case-insensitive; if several enrolled players share the
        name, the key decides which one it is.
        """
        name = player_name.strip().lower()
        if not name:
            return None
        for pid, entry in list(self.player_keys.players.items()):
            if entry.get("playerName", "").strip().lower() != name:
                continue
            verified = self.player_keys.verify(pid, api_key.strip())
            if verified is None:
                continue
            self._purge()
            token = secrets.token_urlsafe(32)
            session = {
                "playerId": pid,
                "playerName": verified["playerName"],
                "keyHash": verified["playerKey"],
                "expires": self.clock() + self.ttl,
            }
            self.sessions[token] = session
            return token, session
        return None

    def get(self, token: str | None) -> dict | None:
        """The session for a cookie value, or None (unknown, expired, key revoked/re-issued)."""
        if not token:
            return None
        session = self.sessions.get(token)
        if session is None:
            return None
        entry = self.player_keys.players.get(session["playerId"])
        if (self.clock() >= session["expires"] or entry is None
                or entry.get("playerKey") != session["keyHash"]):
            self.sessions.pop(token, None)
            return None
        return session

    def logout(self, token: str | None) -> None:
        if token:
            self.sessions.pop(token, None)

    def _purge(self) -> None:
        now = self.clock()
        for token in [t for t, s in self.sessions.items() if now >= s["expires"]]:
            del self.sessions[token]
