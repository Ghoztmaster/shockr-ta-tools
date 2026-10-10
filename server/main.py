"""
Shockr Alliance Server — scan receiver and base viewer API.

Security-first:
- Per-player API keys via self-enrollment (bcrypt hashed); the shared
  per-alliance key is still accepted during a transition period
- Rate limiting per IP
- Strict Pydantic validation on all input
- Alliance-scoped data access (derived from key, not user input)
- Website (pages + viewer API) behind a session cookie from /login with the
  personal API key (server/web_auth.py); admin endpoints stay on Basic Auth
  at the reverse proxy
"""
import json
import time
import logging
from urllib.parse import unquote
from pathlib import Path
from contextlib import asynccontextmanager

import bcrypt
from fastapi import FastAPI, Request, Response, Header, HTTPException, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse, RedirectResponse

from server.models import ScanPayload, ScanResponse
from server.storage import ScanStorage
from server.ratelimit import RateLimiter
from server.target_watch import TargetWatchPayload, TargetWatchStore
from server.attacks import AttackPayload, AttackStore, MAX_BATCH as ATTACK_MAX_BATCH, RETENTION_DAYS as ATTACK_RETENTION_DAYS
from server.members import MemberStore, MembershipError, NOT_A_MEMBER
from server.player_keys import (
    EnrollPayload, EnrollmentConfig, PlayerKeyStore,
    INVALID_CODE, ALLIANCE_NOT_AUTHORIZED, NOT_REGISTERED, INVALID_PLAYER_KEY,
)
from server.web_auth import LoginPayload, SessionStore, SESSION_COOKIE, LOGIN_FAILED

# ─── Config ──────────────────────────────────────────────────────────

CONFIG_DIR = Path("/app/config")
DATA_DIR = Path("/app/data")
KEYS_FILE = CONFIG_DIR / "keys.json"
ENROLLMENT_FILE = CONFIG_DIR / "enrollment.json"
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_SCAN_AGE_S = 3600
STATIC_DIR = Path(__file__).parent / "static"

# ─── Logging ─────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("shockr-alliance")

# ─── Key store ───────────────────────────────────────────────────────

class KeyStore:
    """API key store with bcrypt hashed keys, scoped per alliance."""

    def __init__(self, path: Path):
        self.keys: dict[str, str] = {}
        self.path = path
        self.load()

    def load(self):
        if not self.path.exists():
            log.warning("No keys file at %s — no API keys loaded", self.path)
            return
        with open(self.path) as f:
            self.keys = json.load(f)
        log.info("Loaded %d alliance key(s)", len(self.keys))

    def verify(self, raw_key: str) -> str | None:
        """Verify a raw API key. Returns alliance_id if valid, None otherwise."""
        for alliance_id, hashed in self.keys.items():
            try:
                if bcrypt.checkpw(raw_key.encode(), hashed.encode()):
                    return alliance_id
            except Exception:
                continue
        return None

    def mask(self, key: str) -> str:
        if len(key) < 4:
            return "***"
        return f"***...{key[-3:]}"

# ─── Globals ─────────────────────────────────────────────────────────

key_store = KeyStore(KEYS_FILE)
storage = ScanStorage(DATA_DIR)
target_watches = TargetWatchStore()
attack_store = AttackStore(DATA_DIR)
member_store = MemberStore(DATA_DIR / "members.jsonl")
player_keys = PlayerKeyStore(DATA_DIR / "player_keys.jsonl")
enrollment = EnrollmentConfig(ENROLLMENT_FILE)
post_limiter = RateLimiter(max_requests=10, window_seconds=1)
enroll_limiter = RateLimiter(max_requests=5, window_seconds=3600)
get_limiter = RateLimiter(max_requests=30, window_seconds=1)
login_limiter = RateLimiter(max_requests=10, window_seconds=60)
sessions = SessionStore(player_keys)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Shockr Alliance Server starting")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        attack_store.prune()
    except Exception as e:
        log.warning("Attacks: prune at startup failed: %s", e)
    yield
    log.info("Shockr Alliance Server stopping")


# ─── App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="Shockr Alliance Server",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

# ─── Validation errors (422) ────────────────────────────────────────

# Body excerpt logged with a rejected target-watch POST (enough to see the
# fields; the payload holds no secrets - auth travels in headers).
VALIDATION_LOG_BODY_CHARS = 500


@app.exception_handler(RequestValidationError)
async def log_validation_error(request: Request, exc: RequestValidationError):
    """Same 422 response as FastAPI's default, but a rejected target-watch POST
    is logged with the failing fields and the body, so it is visible WHICH
    field the userscript got wrong (5.6.1: it answered a constant 422)."""
    path = request.url.path
    if path.endswith("/api/target-watch") or path.endswith("/api/attack"):
        fields = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg')} (got {e.get('input')!r})"
            for e in exc.errors()
        )
        body = exc.body
        if isinstance(body, (bytes, bytearray)):
            body = body.decode("utf-8", "replace")
        log.warning("%s 422 from player %s: %s | body: %.*s",
                    "attack" if path.endswith("/api/attack") else "target-watch",
                    request.headers.get("x-player-id", "?"), fields,
                    VALIDATION_LOG_BODY_CHARS, json.dumps(body, default=str) if not isinstance(body, str) else body)
    return await request_validation_exception_handler(request, exc)


# ─── Middleware ───────────────────────────────────────────────────────

@app.middleware("http")
async def limit_payload_size(request: Request, call_next):
    if request.method == "POST":
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_PAYLOAD_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Payload too large"})
    return await call_next(request)

# ─── Dependencies ────────────────────────────────────────────────────

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def verify_api_key(
    request: Request,
    response: Response,
    x_player_key: str = Header("", alias="X-Player-Key"),
    x_alliance_key: str = Header("", alias="X-Alliance-Key"),
    x_player_id: str = Header("", alias="X-Player-Id"),
) -> str:
    """
    X-Player-Key (personal key, must belong to X-Player-Id) first; otherwise
    the shared X-Alliance-Key while the transition period lasts
    (allianceKeyUntil in config/enrollment.json). Returns the storage scope and
    sets request.state.api_key (the key used) and request.state.key_alliance_id
    (in-game alliance id the player key was enrolled with, None for the shared key).
    """
    ip = get_client_ip(request)
    if not post_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if x_player_key:
        try:
            entry = player_keys.verify(int(x_player_id), x_player_key)
        except ValueError:
            entry = None
        if entry is None:
            log.warning("Invalid player key from %s: player %s, key %s", ip, x_player_id, key_store.mask(x_player_key))
            raise HTTPException(status_code=403, detail=INVALID_PLAYER_KEY)
        request.state.api_key = x_player_key
        request.state.key_alliance_id = entry["allianceId"]
        response.headers["X-Auth-Method"] = "player-key"
        return entry["scope"]

    if not x_alliance_key or not enrollment.alliance_key_allowed():
        raise HTTPException(status_code=403, detail=NOT_REGISTERED)
    alliance_id = key_store.verify(x_alliance_key)
    if alliance_id is None:
        log.warning("Invalid API key from %s: %s", ip, key_store.mask(x_alliance_key))
        raise HTTPException(status_code=403, detail="Invalid API key")
    request.state.api_key = x_alliance_key
    request.state.key_alliance_id = None
    response.headers["X-Auth-Method"] = "alliance-key"
    return alliance_id


async def verify_member(
    request: Request,
    alliance_id: str = Depends(verify_api_key),
    x_player_id: str = Header("", alias="X-Player-Id"),
    x_player_name: str = Header("", alias="X-Player-Name"),
    x_alliance_id: str = Header("", alias="X-Alliance-Id"),
) -> str:
    """
    Membership check on top of the API key: the player (headers from the
    userscript) must be a known member of the same in-game alliance — or is
    registered on the first request with a valid key. A player key must also
    be used from the in-game alliance it was enrolled with. Sets
    request.state.player_id.
    """
    try:
        player_id = int(x_player_id)
        in_game_alliance_id = int(x_alliance_id)
    except ValueError:
        raise HTTPException(status_code=403, detail=NOT_A_MEMBER)
    key_alliance_id = request.state.key_alliance_id
    if key_alliance_id is not None and key_alliance_id != in_game_alliance_id:
        log.warning("Player key of %s used from alliance %s (enrolled with %s)", x_player_id, x_alliance_id, key_alliance_id)
        raise HTTPException(status_code=403, detail=NOT_A_MEMBER)
    player_name = unquote(x_player_name).strip()[:50]
    try:
        member_store.check(player_id, player_name, in_game_alliance_id, request.state.api_key)
    except MembershipError as e:
        log.warning("Membership rejected from %s: player %s alliance %s", get_client_ip(request), x_player_id, x_alliance_id)
        raise HTTPException(status_code=403, detail=str(e))
    request.state.player_id = player_id
    return alliance_id


async def rate_limit_get(request: Request):
    ip = get_client_ip(request)
    if not get_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

def current_session(request: Request) -> dict | None:
    return sessions.get(request.cookies.get(SESSION_COOKIE))


async def require_session(request: Request) -> dict:
    """Viewer API: a valid website session (cookie), else 401."""
    session = current_session(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    return session


def cookie_path(request: Request) -> str:
    """The proxy prefix (X-Forwarded-Prefix, e.g. /shockr) so the cookie is not
    sent to the rest of the domain; '/' when served without a prefix."""
    prefix = request.headers.get("x-forwarded-prefix", "").rstrip("/")
    return (prefix if prefix.startswith("/") else "") + "/"


def is_https(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.split(",")[0].strip() == "https"

# ─── Website login (session cookie) ──────────────────────────────────

@app.post("/api/login")
async def post_login(payload: LoginPayload, request: Request):
    ip = get_client_ip(request)
    if not login_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Te veel inlogpogingen — probeer het over een minuut opnieuw")
    result = sessions.login(payload.playerName, payload.apiKey)
    if result is None:
        log.warning("Website login failed from %s: player %r", ip, payload.playerName[:50])
        return JSONResponse(status_code=401, content={"error": LOGIN_FAILED})
    token, session = result
    log.info("Website login: %s (%d) from %s", session["playerName"], session["playerId"], ip)
    response = JSONResponse({"status": "ok", "playerName": session["playerName"]})
    response.set_cookie(
        SESSION_COOKIE, token, max_age=sessions.ttl, path=cookie_path(request),
        httponly=True, secure=is_https(request), samesite="lax",
    )
    return response


@app.post("/api/logout")
async def post_logout(request: Request):
    sessions.logout(request.cookies.get(SESSION_COOKIE))
    # Relative: /shockr/api/logout -> /shockr/login, whatever the proxy prefix
    response = RedirectResponse("../login", status_code=303)
    response.delete_cookie(SESSION_COOKIE, path=cookie_path(request),
                           httponly=True, secure=is_https(request), samesite="lax")
    return response


@app.get("/api/me")
async def get_me(session: dict = Depends(require_session)):
    return {"playerName": session["playerName"], "playerId": session["playerId"]}

# ─── Enrollment (per-player keys) ────────────────────────────────────

@app.post("/api/enroll")
async def post_enroll(payload: EnrollPayload, request: Request):
    """No auth header: the enrollment code (config/enrollment.json) is the auth."""
    ip = get_client_ip(request)
    if not enroll_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Too many enrollment attempts — try again later")
    if not enrollment.check_code(payload.enrollmentCode):
        log.warning("Enrollment with invalid code from %s: player %d alliance %d", ip, payload.playerId, payload.allianceId)
        raise HTTPException(status_code=403, detail=INVALID_CODE)
    if payload.allianceId not in enrollment.alliance_ids:
        log.warning("Enrollment for unauthorized alliance %d from %s: player %d", payload.allianceId, ip, payload.playerId)
        raise HTTPException(status_code=403, detail=ALLIANCE_NOT_AUTHORIZED)

    scope = enrollment.scope
    if not scope:
        scope = next(iter(key_store.keys)) if len(key_store.keys) == 1 else str(payload.allianceId)
    player_key = player_keys.enroll(payload.playerId, payload.playerName.strip()[:50], payload.allianceId, scope)
    return {"status": "ok", "playerKey": player_key}


@app.delete("/api/enroll/{player_id}", dependencies=[Depends(rate_limit_get)])
async def delete_enroll(player_id: int):
    """Revoke a player key (admin — Basic Auth at the reverse proxy)."""
    if not player_keys.revoke(player_id):
        raise HTTPException(status_code=404, detail="Player not registered")
    return {"status": "ok", "playerId": player_id}


@app.get("/api/members", dependencies=[Depends(rate_limit_get)])
async def get_members():
    """Registered players with last activity (admin — Basic Auth at the reverse proxy)."""
    members = []
    for entry in player_keys.list():
        seen = member_store.members.get(entry["playerId"])
        members.append({**entry, "lastSeen": seen["lastSeen"] if seen else None})
    members.sort(key=lambda m: m["playerName"].lower())
    return {"members": members, "count": len(members)}

# ─── POST: receive scan ──────────────────────────────────────────────

@app.post("/api/scan")
async def post_scan(
    payload: ScanPayload,
    request: Request,
    alliance_id: str = Depends(verify_member),
):
    now_ms = int(time.time() * 1000)
    if abs(now_ms - payload.timestamp) > MAX_SCAN_AGE_S * 1000:
        raise HTTPException(status_code=400, detail="Scan timestamp too old or too far in the future")

    stored = storage.store(alliance_id, payload)
    if not stored:
        return ScanResponse(status="duplicate", city_id=payload.city_id)

    log.info("Scan stored: alliance=%s world=%d city=%d", alliance_id, payload.world_id, payload.city_id)
    return ScanResponse(status="ok", city_id=payload.city_id)

# ─── GET: list bases ─────────────────────────────────────────────────

@app.get("/api/bases", dependencies=[Depends(rate_limit_get), Depends(require_session)])
async def get_bases(
    world_id: int | None = None,
    min_level: float | None = None,
    max_age_hours: int = 168,
):
    bases = storage.list_bases(world_id=world_id, min_level=min_level, max_age_hours=max_age_hours)
    return {"bases": bases, "count": len(bases)}

# ─── GET: base detail ────────────────────────────────────────────────

@app.get("/api/base/{city_id}", dependencies=[Depends(rate_limit_get), Depends(require_session)])
async def get_base(city_id: int, world_id: int | None = None):
    detail = storage.get_base(city_id, world_id=world_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Base not found")
    return detail

# ─── Target Watch (in-memory, 10 min TTL) ───────────────────────────

@app.post("/api/target-watch")
async def post_target_watch(
    payload: TargetWatchPayload,
    request: Request,
    alliance_id: str = Depends(verify_member),
):
    if payload.playerId != request.state.player_id:
        raise HTTPException(status_code=403, detail=NOT_A_MEMBER)
    target_watches.add(alliance_id, payload)
    return {"ok": True}


@app.get("/api/target-watch/{world_id}/{target_id}")
async def get_target_watchers(
    world_id: int,
    target_id: int,
    alliance_id: str = Depends(verify_member),
):
    return {"watchers": target_watches.get_watchers(alliance_id, world_id, target_id)}


@app.get("/api/target-watch/{world_id}")
async def get_world_target_watches(
    world_id: int,
    alliance_id: str = Depends(verify_member),
):
    return {"targets": target_watches.get_world(alliance_id, world_id)}


@app.get("/api/targets", dependencies=[Depends(rate_limit_get), Depends(require_session)])
async def get_targets_dashboard():
    """Dashboard data: all worlds with active watches (viewer, website session)."""
    return {
        "serverTime": int(time.time()),
        "ttl": target_watches.ttl,
        "worlds": target_watches.all_worlds(),
    }

# ─── Attack Tracker (won attacks on FG targets) ─────────────────────

@app.post("/api/attack")
async def post_attack(
    payload: AttackPayload | list[AttackPayload],
    request: Request,
    alliance_id: str = Depends(verify_member),
    x_player_name: str = Header("", alias="X-Player-Name"),
):
    """One attack, or a batch (the userscript sends what it buffered, max 50)."""
    items = payload if isinstance(payload, list) else [payload]
    if len(items) > ATTACK_MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"At most {ATTACK_MAX_BATCH} attacks per request")
    player_id = request.state.player_id
    player_name = unquote(x_player_name).strip()[:50] or str(player_id)
    counts = {"ok": 0, "duplicate": 0, "stale": 0}
    for item in items:
        result = attack_store.add(item, player_id, player_name, alliance_id)
        counts[result] += 1
        if result == "ok":
            log.info("Attack stored: %s world=%d %s L%g @ %d:%d", player_name, item.worldId,
                     item.targetType, item.targetLevel, item.targetX, item.targetY)
    return {"status": "ok", "stored": counts["ok"], "duplicates": counts["duplicate"], "stale": counts["stale"]}


@app.get("/api/attacks", dependencies=[Depends(rate_limit_get), Depends(require_session)])
async def get_attacks(
    worldId: int | None = None,
    days: int = 7,
    since: int | None = None,
    player: str | None = None,
    type: str | None = None,
):
    """
    Dashboard data (website session). Period: `since` (ms epoch, e.g. local
    midnight for "today") or else the last `days` days, never more than the
    retention. No worldId: the world with the most recent attack.
    """
    worlds = attack_store.worlds()
    world_id = worldId if worldId is not None else (worlds[0] if worlds else None)
    now_ms = int(time.time() * 1000)
    floor_ms = now_ms - ATTACK_RETENTION_DAYS * 86400 * 1000
    since_ms = since if since is not None else now_ms - max(1, min(days, ATTACK_RETENTION_DAYS)) * 86400 * 1000
    since_ms = max(since_ms, floor_ms)
    target_type = (type or "").strip().lower() or None
    if world_id is None:
        return {"worldId": None, "worlds": [], "since": since_ms, "serverTime": now_ms,
                "summary": {"attacks": 0, "players": 0, "lootTib": 0, "lootCrystal": 0, "lootCredits": 0},
                "tunnels": [], "attacks": [], "players": []}
    data = attack_store.query(world_id, since_ms, player=(player or "").strip() or None, target_type=target_type)
    return {**data, "worlds": worlds, "serverTime": now_ms}

# ─── Health ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "keys_loaded": len(key_store.keys), "player_keys": len(player_keys.players)}

# ─── Pages (website session; no session -> login) ──────────────────

def page(request: Request, name: str, login_url: str):
    if current_session(request) is None:
        return RedirectResponse(login_url, status_code=303)
    return FileResponse(STATIC_DIR / name)


@app.get("/login")
async def login_page():
    return FileResponse(STATIC_DIR / "login.html")

# Public page scripts (no data in them; the login page needs i18n.js before a session exists)
PUBLIC_SCRIPTS = {"session.js", "i18n.js"}


@app.get("/static/{name}")
async def static_script(name: str):
    if name not in PUBLIC_SCRIPTS:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(STATIC_DIR / name, media_type="text/javascript")

@app.get("/")
async def index(request: Request):
    return page(request, "index.html", "login")

@app.get("/targets")
async def targets_page(request: Request):
    return page(request, "targets.html", "login")

@app.get("/attacks")
async def attacks_page(request: Request):
    return page(request, "attacks.html", "login")
