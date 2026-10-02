"""
Shockr Alliance Server — scan receiver and base viewer API.

Security-first:
- API key auth on POST (per alliance, bcrypt hashed)
- Rate limiting per IP
- Strict Pydantic validation on all input
- Alliance-scoped data access (derived from key, not user input)
"""
import json
import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import bcrypt
from fastapi import FastAPI, Request, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse

from server.models import ScanPayload, ScanResponse
from server.storage import ScanStorage
from server.ratelimit import RateLimiter
from server.target_watch import TargetWatchPayload, TargetWatchStore

# ─── Config ──────────────────────────────────────────────────────────

CONFIG_DIR = Path("/app/config")
DATA_DIR = Path("/app/data")
KEYS_FILE = CONFIG_DIR / "keys.json"
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_SCAN_AGE_S = 3600

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
post_limiter = RateLimiter(max_requests=10, window_seconds=1)
get_limiter = RateLimiter(max_requests=30, window_seconds=1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Shockr Alliance Server starting")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://*.alliances.commandandconquer.com",
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["X-Alliance-Key", "Content-Type"],
    allow_credentials=False,
)

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
    x_alliance_key: str = Header(..., alias="X-Alliance-Key"),
) -> str:
    ip = get_client_ip(request)
    if not post_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    alliance_id = key_store.verify(x_alliance_key)
    if alliance_id is None:
        log.warning("Invalid API key from %s: %s", ip, key_store.mask(x_alliance_key))
        raise HTTPException(status_code=403, detail="Invalid API key")
    return alliance_id


async def rate_limit_get(request: Request):
    ip = get_client_ip(request)
    if not get_limiter.allow(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

# ─── POST: receive scan ──────────────────────────────────────────────

@app.post("/api/scan")
async def post_scan(
    payload: ScanPayload,
    request: Request,
    alliance_id: str = Depends(verify_api_key),
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

@app.get("/api/bases", dependencies=[Depends(rate_limit_get)])
async def get_bases(
    world_id: int | None = None,
    min_level: float | None = None,
    max_age_hours: int = 168,
):
    bases = storage.list_bases(world_id=world_id, min_level=min_level, max_age_hours=max_age_hours)
    return {"bases": bases, "count": len(bases)}

# ─── GET: base detail ────────────────────────────────────────────────

@app.get("/api/base/{city_id}", dependencies=[Depends(rate_limit_get)])
async def get_base(city_id: int, world_id: int | None = None):
    detail = storage.get_base(city_id, world_id=world_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Base not found")
    return detail

# ─── Target Watch (in-memory, 10 min TTL) ───────────────────────────

@app.post("/api/target-watch")
async def post_target_watch(
    payload: TargetWatchPayload,
    alliance_id: str = Depends(verify_api_key),
):
    target_watches.add(alliance_id, payload)
    return {"ok": True}


@app.get("/api/target-watch/{world_id}/{target_id}")
async def get_target_watchers(
    world_id: int,
    target_id: int,
    alliance_id: str = Depends(verify_api_key),
):
    return {"watchers": target_watches.get_watchers(alliance_id, world_id, target_id)}


@app.get("/api/target-watch/{world_id}")
async def get_world_target_watches(
    world_id: int,
    alliance_id: str = Depends(verify_api_key),
):
    return {"targets": target_watches.get_world(alliance_id, world_id)}

# ─── Health ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "keys_loaded": len(key_store.keys)}

@app.get("/")
async def index():
    return FileResponse("/app/server/static/index.html")
