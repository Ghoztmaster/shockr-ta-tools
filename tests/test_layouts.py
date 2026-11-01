"""Base Layouts page (server/layouts.py, ScanStorage.latest_scans, GET /api/layouts).

Run: python -m pytest tests/test_layouts.py
"""
import json

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.attacks import AttackStore
from server.layouts import b62_unpack, build_layouts, decode_tiles, decode_units, layout_metrics
from server.members import MemberStore
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter
from server.storage import ScanStorage
from server.watchlist import WatchlistStore
from server.web_auth import SessionStore

NOW = 1_791_607_000.0
NOW_MS = int(NOW * 1000)
B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def b62(n: int) -> str:
    """lib/packer.js Base62.encode: least significant digit first."""
    if n == 0:
        return "0"
    out = ""
    while n:
        out += B62[n % 62]
        n //= 62
    return out


def pack_tiles(rows: list[str]) -> str:
    """Rows of digits (resource types) -> the scan's tiles string (lib/scanner-util.js getLayout)."""
    rows = rows + ["000000000"] * (16 - len(rows))
    return ".".join(b62(sum(int(v) << (3 * x) for x, v in enumerate(row))) for row in rows)


def pack_units(units: list[tuple[int, int, int, int]]) -> str:
    """(x, y, mdb id, level) -> UnitPacker string."""
    return ".".join(b62((y * 9 + x) | (i << 8) | (lvl << 17)) for x, y, i, lvl in units)


EMPTY = ["000000000"] * 8


def scan(city_id, x, y, rows=EMPTY, faction=5, level=27, ts=NOW_MS - 3600_000, buildings="", owner_id=0,
         name="tnf:mutants camp"):
    return {"city_id": city_id, "world_id": 477, "x": x, "y": y, "name": name, "owner": "Forgotten",
            "owner_id": owner_id, "faction": faction, "level_base": level, "level_off": 20, "level_def": 20,
            "tiles": pack_tiles(rows), "buildings": buildings, "scanned_by": "A", "version": 1, "timestamp": ts}


# ─── Decoding ────────────────────────────────────────────────────────

def test_decode_roundtrip():
    rows = ["120000000", "000000021", "700000004"]
    grid = decode_tiles(pack_tiles(rows))
    assert len(grid) == 16
    assert "".join(map(str, grid[0])) == "120000000"
    assert "".join(map(str, grid[1])) == "000000021"
    assert "".join(map(str, grid[2])) == "700000004"
    assert decode_tiles("") is None
    assert b62_unpack("a.0.01") == [36, 0, 62]
    assert decode_units(pack_units([(4, 6, 177, 30)])) == [{"x": 4, "y": 6, "id": 177, "level": 30}]


# ─── Metrics ─────────────────────────────────────────────────────────

def test_spots_tib_cry_mix():
    rows = ["222000000",
            "202000110",
            "222000101",
            "000000000",
            "000000000",
            "000000000",
            "000000000",
            "000000000"]
    m = layout_metrics(decode_tiles(pack_tiles(rows)), [])
    assert m["tibFields"] == 8 and m["cryFields"] == 4
    # (1,1): 8 tiberium neighbours -> the "7" bucket
    assert m["tibSpots"][0] == 1
    # (7,2): crystal at (6,1),(7,1),(6,2),(8,2) -> 4 crystal
    assert m["crySpots"][SPOT_INDEX[4]] == 1
    assert m["mixSpots"] == [0, 0, 0, 0, 0]


SPOT_INDEX = {7: 0, 6: 1, 5: 2, 4: 3, 3: 4}


def test_mix_and_edge_fields():
    rows = ["210000000", "000000000"] + ["000000000"] * 6
    m = layout_metrics(decode_tiles(pack_tiles(rows)), [])
    # (0,1) and (1,1) see tib + cry = 2: not counted (sizes 3..7); (2,0) sees 1 crystal only
    assert m["mixSpots"] == [0, 0, 0, 0, 0]
    rows = ["212000000", "000000000"] + ["000000000"] * 6
    m = layout_metrics(decode_tiles(pack_tiles(rows)), [])
    assert m["mixSpots"][SPOT_INDEX[3]] == 1          # (1,1): 2 tib + 1 cry


def test_power8_no_touching_centres():
    m = layout_metrics(decode_tiles(pack_tiles(EMPTY)), [])
    # 9x8 empty base: centres need all 8 neighbours inside; greedy row-major, no two centres adjacent
    assert m["power8"] == 12
    rows = ["000000000", "000000000", "000000000"] + ["222222222"] * 5
    assert layout_metrics(decode_tiles(pack_tiles(rows)), [])["power8"] == 4   # row 1: x=1,3,5,7


def test_cy_df_rows():
    grid = decode_tiles(pack_tiles(EMPTY))
    m = layout_metrics(grid, decode_units(pack_units([(4, 6, 177, 30), (2, 3, 195, 30), (1, 9, 177, 1)])))
    assert (m["cyRow"], m["cyCol"], m["dfRow"]) == (2, 4, 5)
    assert layout_metrics(grid, [])["cyRow"] is None


# ─── Rows: type, loot, CP, status ────────────────────────────────────

def test_build_layouts_loot_cp_status():
    records = [scan(1, 100, 100), scan(2, 110, 110), scan(3, 120, 120, level=27.4),
               scan(4, 130, 130, faction=8, name="event camp"), scan(5, 140, 140, faction=1, name="Home")]
    attacks = [
        {"targetId": 1, "targetX": 100, "targetY": 100, "targetType": "camp", "targetLevel": 27, "won": True,
         "destroyed": False, "lootTib": 100, "lootCrystal": 50, "lootCredits": 10, "playerId": 7,
         "playerName": "Me", "cpCost": 14, "timestamp": NOW_MS - 7200_000},
        {"targetX": 100, "targetY": 100, "targetType": "camp", "targetLevel": 27, "won": True,
         "lootTib": 300, "lootCrystal": 150, "lootCredits": 30, "playerId": 8, "playerName": "Other",
         "timestamp": NOW_MS - 60_000},
        {"targetId": 2, "targetX": 110, "targetY": 110, "targetType": "camp", "targetLevel": 27, "won": False,
         "playerId": 7, "playerName": "Me", "cpCost": 12, "timestamp": NOW_MS - 60_000},
    ]
    claims = [{"targetX": 120, "targetY": 120, "playerName": "Claimer"}]
    rows = {b["cityId"]: b for b in build_layouts(records, attacks, claims, player_id=7)}
    assert 4 not in rows                                     # event camp skipped
    assert rows[5]["type"] == "player" and rows[5]["lootTib"] is None
    one = rows[1]
    assert (one["lootTib"], one["lootCrystal"], one["lootCredits"], one["lootEstimated"]) == (200, 100, 20, False)
    assert one["cp"] == 14
    # coordinate-only attack after the scan without `destroyed`: a won one reads as destroyed (is_destroyed)
    assert one["status"] == "destroyed"
    assert rows[2]["status"] == "attacked" and rows[2]["cp"] == 12 and rows[2]["lootEstimated"] is True
    assert rows[3]["status"] == "claimed" and rows[3]["claimedBy"] == ["Claimer"]
    assert rows[3]["lootTib"] == 200                         # estimate: camp level 27
    assert rows[1]["layout"][0] == "000000000"


def test_build_layouts_free_and_old_attack():
    records = [scan(1, 100, 100, ts=NOW_MS - 60_000)]
    attacks = [{"targetId": 1, "targetX": 100, "targetY": 100, "targetType": "camp", "targetLevel": 27,
                "won": True, "destroyed": True, "playerId": 7, "playerName": "Me", "timestamp": NOW_MS - 3600_000}]
    assert build_layouts(records, attacks, [], 7)[0]["status"] == "free"   # attack before this scan


# ─── Route ───────────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch, tmp_path):
    keys = PlayerKeyStore(None, clock=lambda: NOW)
    member = keys.enroll(200, "OzookerO", 100, "SoO", role="member")
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", SessionStore(keys, clock=lambda: NOW))
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "get_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    monkeypatch.setattr(main, "attack_store", AttackStore(None, clock=lambda: NOW))
    monkeypatch.setattr(main, "watchlist", WatchlistStore(None, clock=lambda: NOW))
    monkeypatch.setattr(main, "storage", ScanStorage(tmp_path))
    monkeypatch.setattr(main.time, "time", lambda: NOW)
    monkeypatch.setattr("server.storage.time.time", lambda: NOW)
    path = tmp_path / "alliance" / "SoO" / "477.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [scan(1, 102, 296, ts=NOW_MS - 7200_000, level=20), scan(1, 102, 296, level=21),
             scan(2, 104, 298, faction=6, name="tnf:mutants outpost"),
             scan(3, 99, 290, faction=2, owner_id=200, name="My base"),
             scan(9, 50, 50, ts=NOW_MS - 30 * 86400_000)]
    path.write_text("\n".join(json.dumps(s) for s in lines) + "\n")
    other = tmp_path / "alliance" / "Other" / "477.jsonl"
    other.parent.mkdir(parents=True, exist_ok=True)
    other.write_text(json.dumps(scan(77, 1, 1)) + "\n")
    return {"client": TestClient(main.app, base_url="https://testserver"), "member": member}


def test_layouts_route(env):
    c = env["client"]
    assert c.get("/api/layouts").status_code == 401
    assert c.get("/layouts", follow_redirects=False).status_code == 303
    assert c.post("/api/login", json={"playerName": "OzookerO", "apiKey": env["member"]}).status_code == 200
    assert c.get("/layouts").status_code == 200
    data = c.get("/api/layouts").json()
    assert data["worldId"] == 477 and data["worlds"] == [477]
    ids = {b["cityId"]: b for b in data["bases"]}
    assert set(ids) == {1, 2, 3}                       # newest per city, own scope only, max 7 days
    assert ids[1]["level"] == 21
    assert ids[2]["type"] == "outpost" and ids[3]["type"] == "player"
    assert data["ownBases"] == [{"cityId": 3, "name": "My base", "x": 99, "y": 290, "faction": 2}]
    assert c.get("/api/layouts", params={"maxAgeHours": 1}).json()["bases"] == [] or \
        {b["cityId"] for b in c.get("/api/layouts", params={"maxAgeHours": 1}).json()["bases"]} <= {1, 2, 3}
