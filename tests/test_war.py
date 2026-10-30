"""War Tracker (server/war.py, the War fields in server/attacks.py, routes in main.py).

Run: python -m pytest tests/test_war.py
"""
import json
import os

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.attacks import AttackPayload, AttackStore
from server.members import MemberStore
from server.player_keys import EnrollPayload, PlayerKeyStore
from server.ratelimit import RateLimiter
from server.storage import ScanStorage, fg_type
from server.war import WarAccess, overview, sector_of
from server.web_auth import SessionStore

NOW = 1_791_607_000.0          # s
NOW_MS = int(NOW * 1000)
DAY_MS = 86400 * 1000
GEO = {"worldWidth": 1000, "worldHeight": 1000, "sectorCount": 8}


def attack(**kw):
    data = {"targetType": "camp", "targetLevel": 27, "targetX": 102, "targetY": 296,
            "lootTib": 1000, "lootCrystal": 500, "lootCredits": 100,
            "worldId": 477, "timestamp": NOW_MS - 60_000}
    data.update(kw)
    return data


def rec(x=102, y=296, player="A", ts=NOW_MS - 60_000, **kw):
    """A stored attack record (what AttackStore keeps)."""
    r = {"targetType": "camp", "targetLevel": 27, "targetX": x, "targetY": y, "lootTib": 100,
         "lootCrystal": 50, "lootCredits": 10, "worldId": 477, "timestamp": ts,
         "playerId": hash(player) & 0xffff, "playerName": player, "scope": "SoO"}
    r.update(kw)
    return r


def scan(city_id, x, y, faction=5, level=27, ts=NOW_MS - DAY_MS, name="tnf:mutants camp"):
    return {"city_id": city_id, "world_id": 477, "x": x, "y": y, "name": name, "owner": "Forgotten",
            "owner_id": 0, "faction": faction, "level_base": level, "level_off": 20, "level_def": 20,
            "tiles": "", "scanned_by": "A", "version": 1, "timestamp": ts}


# ─── Pure: sector, scan types, statuses ─────────────────────────────

def test_sector_matches_poi_util_sectorNo():
    geo = {"width": 1000, "height": 1000, "count": 8}
    assert sector_of(500, 900, geo) == 0    # south
    assert sector_of(100, 500, geo) == 2    # west
    assert sector_of(500, 100, geo) == 4    # north
    assert sector_of(900, 500, geo) == 6    # east
    assert sector_of(1, 1, None) is None


def test_fg_type_from_faction_then_name():
    assert fg_type({"faction": 4}) == "base"
    assert fg_type({"faction": 5}) == "camp"
    assert fg_type({"faction": 6}) == "outpost"
    assert fg_type({"faction": 8}) is None                      # event camp
    assert fg_type({"faction": 1}) is None                      # GDI player base
    assert fg_type({"faction": 3, "name": "tnf:mutants outpost"}) == "outpost"


def test_statuses_open_attacked_destroyed():
    scans = [
        {"cityId": 1, "x": 100, "y": 300, "targetType": "camp", "targetLevel": 27, "scannedAt": NOW_MS - DAY_MS},
        {"cityId": 2, "x": 103, "y": 300, "targetType": "outpost", "targetLevel": 28, "scannedAt": NOW_MS - DAY_MS},
        {"cityId": 3, "x": 105, "y": 302, "targetType": "camp", "targetLevel": 26, "scannedAt": NOW_MS - DAY_MS},
    ]
    rows = [
        rec(100, 300, "A", targetId=1, won=True, destroyed=True),
        rec(103, 300, "B", targetId=2, won=False, destroyed=False, ts=NOW_MS - 120_000),
    ]
    data = overview(rows, NOW_MS - DAY_MS, scans, {"width": 1000, "height": 1000, "count": 8})
    status = {t["cityId"]: t["status"] for t in data["targets"]}
    assert status == {1: "destroyed", 2: "attacked", 3: "open"}
    s = data["summary"]
    assert (s["targets"], s["destroyed"], s["attacked"], s["open"], s["pctDestroyed"]) == (3, 1, 1, 1, 33)
    assert (s["attacks"], s["won"], s["lost"]) == (2, 1, 1)
    # one tunnel: the two attacked targets, the open one 2-3 fields away joins it
    assert len(data["tunnels"]) == 1
    tn = data["tunnels"][0]
    assert (tn["targets"], tn["destroyed"], tn["attacked"], tn["open"], tn["progress"]) == (3, 1, 1, 1, 33)
    assert data["sectors"][0]["name"] == "NW" and data["sectors"][0]["targets"] == 3


def test_destroyed_before_period_is_gone_attacked_before_is_open():
    scans = [{"cityId": 1, "x": 10, "y": 10, "targetType": "camp", "targetLevel": 20, "scannedAt": NOW_MS - 5 * DAY_MS},
             {"cityId": 2, "x": 12, "y": 10, "targetType": "camp", "targetLevel": 20, "scannedAt": NOW_MS - 5 * DAY_MS}]
    rows = [rec(10, 10, targetId=1, destroyed=True, ts=NOW_MS - 3 * DAY_MS),
            rec(12, 10, targetId=2, won=False, destroyed=False, ts=NOW_MS - 3 * DAY_MS)]
    data = overview(rows, NOW_MS - DAY_MS, scans, None)
    assert [(t["cityId"], t["status"]) for t in data["targets"]] == [(2, "open")]
    assert data["targets"][0]["sectorName"] == "?"


def test_legacy_records_match_on_coordinate_and_count_as_destroyed():
    scans = [{"cityId": 7, "x": 50, "y": 60, "targetType": "outpost", "targetLevel": 30, "scannedAt": NOW_MS - DAY_MS}]
    rows = [rec(50, 60, targetType="camp")]          # before 5.33.0: no targetId, no won/destroyed
    data = overview(rows, NOW_MS - DAY_MS, scans, None)
    assert len(data["targets"]) == 1
    t = data["targets"][0]
    assert (t["cityId"], t["status"], t["targetType"]) == (7, "destroyed", "outpost")


def test_unscanned_attacked_target_and_filters():
    rows = [rec(200, 200, "A", targetId=9, won=False, destroyed=False),
            rec(800, 800, "B", targetId=10, targetType="base", destroyed=True)]
    geo = {"width": 1000, "height": 1000, "count": 8}
    data = overview(rows, NOW_MS - DAY_MS, [], geo)
    assert {t["cityId"] for t in data["targets"]} == {9, 10}
    assert data["playerNames"] == ["A", "B"]
    assert [t["cityId"] for t in overview(rows, NOW_MS - DAY_MS, [], geo, player="b")["targets"]] == [10]
    assert [t["cityId"] for t in overview(rows, NOW_MS - DAY_MS, [], geo, target_type="base")["targets"]] == [10]
    assert [t["cityId"] for t in overview(rows, NOW_MS - DAY_MS, [], geo,
                                          area=lambda x, y: x < 300)["targets"]] == [9]
    s = sector_of(200, 200, geo)
    assert [t["cityId"] for t in overview(rows, NOW_MS - DAY_MS, [], geo, sector=s)["targets"]] == [9]


def test_scan_storage_fg_targets(tmp_path, monkeypatch):
    monkeypatch.setattr("server.storage.time.time", lambda: NOW)
    st = ScanStorage(tmp_path)
    path = tmp_path / "alliance" / "SoO" / "477.jsonl"
    path.parent.mkdir(parents=True)
    lines = [scan(1, 10, 10, ts=NOW_MS - 2 * DAY_MS), scan(1, 10, 10, level=28, ts=NOW_MS - DAY_MS),
             scan(2, 20, 20, faction=1), scan(3, 30, 30, ts=NOW_MS - 9 * DAY_MS), scan(4, 40, 40, faction=6)]
    path.write_text("\n".join(json.dumps(l) for l in lines) + "\n")
    got = {t["cityId"]: t for t in st.fg_targets("SoO", 477)}
    assert set(got) == {1, 4}
    assert got[1]["targetLevel"] == 28 and got[4]["targetType"] == "outpost"
    assert st.fg_targets("Other", 477) == []
    assert not (tmp_path / "alliance" / "Other").exists()    # a read creates no directory


# ─── Access ──────────────────────────────────────────────────────────

def test_war_access_roles_and_whitelist(tmp_path):
    keys = PlayerKeyStore(None)
    keys.enroll(1, "Cic", 100, "SoO", role="cic")
    keys.enroll(2, "Off", 100, "SoO", role="officer")
    keys.enroll(3, "Mem", 100, "SoO", role="member")
    keys.enroll(4, "Old", 100, "SoO")
    access = WarAccess(tmp_path / "war-whitelist.json")
    assert [access.allowed(p, keys) for p in (1, 2, 3, 4, 99)] == [True, True, False, False, False]

    (tmp_path / "war-whitelist.json").write_text(json.dumps({"playerIds": [3]}))
    assert access.allowed(3, keys)
    path = tmp_path / "war-whitelist.json"
    path.write_text("[4]")
    os.utime(path, (NOW + 10, NOW + 10))      # make sure the mtime differs
    assert access.allowed(4, keys) and not access.allowed(3, keys)
    path.write_text("{broken")
    os.utime(path, (NOW + 20, NOW + 20))
    assert access.allowed(4, keys)            # a broken edit keeps the previous list
    assert keys.set_role(2, "member") and not access.allowed(2, keys)
    assert not keys.set_role(2, "member")     # unchanged: no write


def test_enroll_payload_role():
    base = {"playerId": 1, "playerName": "A", "allianceId": 100, "worldId": 477, "enrollmentCode": "x"}
    assert EnrollPayload(**base).role is None
    assert EnrollPayload(**base, role=" Officer ").role == "officer"
    with pytest.raises(ValueError):
        EnrollPayload(**base, role="admin")


# ─── Routes ──────────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch, tmp_path):
    keys = PlayerKeyStore(None, clock=lambda: NOW)
    officer = keys.enroll(164, "GhoztMasters", 100, "SoO", role="officer")
    member = keys.enroll(200, "OzookerO", 100, "SoO", role="member")
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", SessionStore(keys, clock=lambda: NOW))
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "post_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "get_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    store = AttackStore(None, clock=lambda: NOW)
    monkeypatch.setattr(main, "attack_store", store)
    scans = ScanStorage(tmp_path)
    monkeypatch.setattr(main, "storage", scans)
    monkeypatch.setattr(main, "war_access", WarAccess(tmp_path / "alliance" / "war-whitelist.json"))
    monkeypatch.setattr(main.time, "time", lambda: NOW)
    monkeypatch.setattr("server.storage.time.time", lambda: NOW)
    path = tmp_path / "alliance" / "SoO" / "477.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(s) for s in [scan(1, 102, 296), scan(2, 104, 298, faction=6)]) + "\n")
    client = TestClient(main.app, base_url="https://testserver")
    return {"client": client, "officer": officer, "member": member, "keys": keys, "tmp": tmp_path}


def headers(pid, name, key):
    return {"X-Player-Key": key, "X-Player-Id": str(pid), "X-Player-Name": name, "X-Alliance-Id": "100"}


def login(c, name, key):
    assert c.post("/api/login", json={"playerName": name, "apiKey": key}).status_code == 200


def test_lost_attack_stored_but_not_on_attacks_page(env):
    c = env["client"]
    r = c.post("/api/attack", json=[attack(targetId=1, won=True, destroyed=True, outcome=1, cpCost=14, **GEO),
                                    attack(targetX=104, targetY=298, targetType="outpost", targetId=2,
                                           won=False, destroyed=False, outcome=3, defenderHpEnd=41.5,
                                           timestamp=NOW_MS - 30_000)],
               headers=headers(200, "OzookerO", env["member"]))
    assert r.json()["stored"] == 2
    login(c, "OzookerO", env["member"])
    assert c.get("/api/attacks").json()["summary"]["attacks"] == 1          # won only (Attacks page)
    everything = c.get("/api/attacks", params={"result": "all"}).json()["attacks"]
    assert len(everything) == 2 and {a["won"] for a in everything} == {True, False}
    assert c.get("/api/attacks", params={"result": "lost"}).json()["attacks"][0]["defenderHpEnd"] == 41.5
    assert c.get("/api/attacks", params={"result": "nope"}).status_code == 400
    assert c.get("/api/attacks", params={"result": "all", "xMax": 103}).json()["summary"]["attacks"] == 1
    nw = sector_of(102, 296, {"width": 1000, "height": 1000, "count": 8})
    assert c.get("/api/attacks", params={"result": "all", "sector": nw}).json()["summary"]["attacks"] == 2
    assert c.get("/api/attacks", params={"result": "all", "sector": (nw + 4) % 8}).json()["summary"]["attacks"] == 0


def test_war_page_and_summary_access(env):
    c = env["client"]
    assert c.get("/war", follow_redirects=False).status_code == 303
    assert c.get("/api/attacks/summary").status_code == 401

    login(c, "OzookerO", env["member"])
    assert c.get("/war").status_code == 403
    assert c.get("/api/attacks/summary").status_code == 403
    assert c.get("/api/me").json()["warAccess"] is False

    # whitelist: access on the next page load, no new login
    (env["tmp"] / "alliance" / "war-whitelist.json").write_text(json.dumps({"playerIds": [200]}))
    assert c.get("/war").status_code == 200
    assert c.get("/api/me").json()["warAccess"] is True


def test_summary_open_targets_from_scans(env):
    c = env["client"]
    c.post("/api/attack", json=attack(targetId=1, destroyed=True, cpCost=14, **GEO),
           headers=headers(164, "GhoztMasters", env["officer"]))
    login(c, "GhoztMasters", env["officer"])
    assert c.get("/war").status_code == 200
    data = c.get("/api/attacks/summary", params={"days": 1}).json()
    assert data["worldId"] == 477
    assert {t["cityId"]: t["status"] for t in data["targets"]} == {1: "destroyed", 2: "open"}
    assert data["summary"]["pctDestroyed"] == 50 and data["summary"]["cpCost"] == 14
    assert data["summary"]["topPlayers"][0]["playerName"] == "GhoztMasters"
    assert data["sectors"][0]["name"] == "NW"
    assert data["tunnels"][0]["targets"] == 2


def test_attack_role_refreshes_access(env):
    c = env["client"]
    login(c, "GhoztMasters", env["officer"])
    assert c.get("/war").status_code == 200
    c.post("/api/attack", json=[attack(playerRole="member"), attack(targetX=50, playerRole="officer",
                                                                    timestamp=NOW_MS - 3_600_000)],
           headers=headers(164, "GhoztMasters", env["officer"]))
    assert env["keys"].players[164]["role"] == "member"        # the newest attack's role
    assert c.get("/war").status_code == 403
    assert c.post("/api/attack", json=attack(playerRole="king"),
                  headers=headers(164, "GhoztMasters", env["officer"])).status_code == 422


def test_lost_attack_keeps_watchlist_claim(env, monkeypatch):
    calls = []
    monkeypatch.setattr(main.watchlist, "on_attack", lambda *a: calls.append(a) or [])
    env["client"].post("/api/attack", json=[attack(won=False), attack(targetX=50)],
                       headers=headers(164, "GhoztMasters", env["officer"]))
    assert [a[2] for a in calls] == [50]


def test_payload_new_fields_are_optional():
    p = AttackPayload(**attack())
    assert p.won is True and p.destroyed is None and p.targetId is None and p.playerRole is None
