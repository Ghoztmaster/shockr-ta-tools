"""Alliance Attack Tracker (server/attacks.py + routes in main.py).

Run: python -m pytest tests/test_attacks.py
"""
import json

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.attacks import AttackPayload, AttackStore, cluster_attacks
from server.members import MemberStore
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter
from server.web_auth import SessionStore

NOW = 1_791_607_000.0          # s
NOW_MS = int(NOW * 1000)


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


def attack(**kw):
    data = {"targetType": "outpost", "targetLevel": 18, "targetX": 84, "targetY": 293,
            "lootTib": 120000, "lootCrystal": 85000, "lootCredits": 42000,
            "worldId": 477, "timestamp": NOW_MS - 60_000}
    data.update(kw)
    return data


def store_with(clock=None, path=None):
    return AttackStore(path, clock=clock or Clock())


# ─── Store: validation, dedup, retention ────────────────────────────

def test_payload_only_fg_target_types():
    for t in ("camp", "outpost", "base", " Camp "):
        AttackPayload(**attack(targetType=t))
    for t in ("player", "fortress", ""):
        with pytest.raises(ValueError):
            AttackPayload(**attack(targetType=t))


def test_dedup_same_player_target_within_60s():
    s = store_with()
    assert s.add(AttackPayload(**attack()), 164, "GhoztMasters", "SoO") == "ok"
    assert s.add(AttackPayload(**attack(timestamp=NOW_MS - 60_000 + 59_000)), 164, "GhoztMasters", "SoO") == "duplicate"
    # More than 60 s apart, another player, or another target: separate attacks
    assert s.add(AttackPayload(**attack(timestamp=NOW_MS - 60_000 + 61_000)), 164, "GhoztMasters", "SoO") == "ok"
    assert s.add(AttackPayload(**attack()), 200, "OzookerO", "SoO") == "ok"
    assert s.add(AttackPayload(**attack(targetX=85)), 164, "GhoztMasters", "SoO") == "ok"


def test_dedup_report_id_wins_over_time_window():
    s = store_with()
    assert s.add(AttackPayload(**attack(reportId=1)), 164, "G", "SoO") == "ok"
    # Same report again, even with another timestamp: duplicate
    assert s.add(AttackPayload(**attack(reportId=1, timestamp=NOW_MS - 3_600_000)), 164, "G", "SoO") == "duplicate"
    # Two real attacks on the same target 20 s apart: two reports, both kept
    assert s.add(AttackPayload(**attack(reportId=2, timestamp=NOW_MS - 40_000)), 164, "G", "SoO") == "ok"


def test_stale_and_future_rejected():
    s = store_with()
    assert s.add(AttackPayload(**attack(timestamp=NOW_MS - 8 * 86400 * 1000)), 164, "G", "SoO") == "stale"
    assert s.add(AttackPayload(**attack(timestamp=NOW_MS + 2 * 3600 * 1000)), 164, "G", "SoO") == "stale"


def test_persist_and_prune_at_startup(tmp_path):
    clock = Clock()
    s = AttackStore(tmp_path, clock=clock)
    s.add(AttackPayload(**attack(timestamp=NOW_MS - 6 * 86400 * 1000)), 164, "G", "SoO")
    s.add(AttackPayload(**attack(timestamp=NOW_MS - 1000, targetX=10)), 164, "G", "SoO")
    path = tmp_path / "attacks" / "477.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines()]
    assert {"playerId", "playerName", "scope", "receivedAt"} <= set(rows[0])
    assert rows[0]["playerName"] == "G" and rows[0]["scope"] == "SoO"

    # Two days later the first record is past the 7-day retention
    clock.t += 2 * 86400
    restarted = AttackStore(tmp_path, clock=clock)
    assert restarted.prune() == 1
    rows = [json.loads(l) for l in path.read_text().splitlines()]
    assert [r["targetX"] for r in rows] == [10]
    assert len(restarted.query(477, 0)["attacks"]) == 1


# ─── Tunnel clustering ──────────────────────────────────────────────

def row(x, y, player="A", ts=NOW_MS, tib=100, level=18):
    return {"targetX": x, "targetY": y, "playerId": hash(player) % 1000, "playerName": player,
            "timestamp": ts, "targetLevel": level, "targetType": "camp",
            "lootTib": tib, "lootCrystal": 10, "lootCredits": 1}


def test_cluster_radius_10():
    rows = [row(85, 290), row(85, 290), row(84, 293, "B"), row(92, 296, "B"),   # tunnel 1 (all <= 10 from 85:290)
            row(73, 305), row(70, 310, "C")]                                    # 73:305 is 21 fields away
    clusters = cluster_attacks(rows)
    assert [c["attacks"] for c in clusters] == [4, 2]
    first = clusters[0]
    assert first["players"] == 2
    assert first["lootTib"] == 400
    assert [(p["playerName"], p["attacks"]) for p in first["contributors"]] == [("A", 2), ("B", 2)]
    assert (first["minLevel"], first["maxLevel"]) == (18, 18)
    # Label = attack-weighted mean position
    assert (first["x"], first["y"]) == (86, 292)


def test_cluster_never_wider_than_radius_from_its_centre():
    # A chain 0, 8, 16, 24 on one line: single-linkage would make one cluster
    rows = [row(100, 100), row(100, 100), row(108, 100), row(116, 100), row(124, 100)]
    clusters = cluster_attacks(rows)
    # 100:100 (most attacked) is the first centre and takes 108; 116 is 16 away
    # and starts the next one, which takes 124
    assert [sorted({a["targetX"] for a in c["attackList"]}) for c in clusters] == [[100, 108], [116, 124]]


def test_known_tunnel_centres_used():
    rows = [row(84, 293), row(80, 297)]
    clusters = cluster_attacks(rows, centers=[{"x": 85, "y": 290, "level": 22}])
    assert len(clusters) == 1
    assert (clusters[0]["x"], clusters[0]["y"], clusters[0]["tunnelLevel"], clusters[0]["known"]) == (85, 290, 22, True)


# ─── Endpoints ──────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch, tmp_path):
    clock = Clock()
    keys = PlayerKeyStore(None, clock=clock)
    key = keys.enroll(164, "GhoztMasters", 100, "SoO")
    other = keys.enroll(200, "OzookerO", 100, "SoO")
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", SessionStore(keys, clock=clock))
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "post_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "get_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    store = AttackStore(None, clock=lambda: NOW)
    monkeypatch.setattr(main, "attack_store", store)
    monkeypatch.setattr(main.time, "time", lambda: NOW)
    client = TestClient(main.app, base_url="https://testserver")
    return {"client": client, "key": key, "other": other, "store": store}


def headers(pid, name, key):
    return {"X-Player-Key": key, "X-Player-Id": str(pid), "X-Player-Name": name, "X-Alliance-Id": "100"}


def test_post_requires_player_key(env):
    r = env["client"].post("/api/attack", json=attack())
    assert r.status_code == 403
    r = env["client"].post("/api/attack", json=attack(), headers=headers(164, "GhoztMasters", "wrong"))
    assert r.status_code == 403


def test_post_single_and_batch(env):
    c = env["client"]
    h = headers(164, "GhoztMasters", env["key"])
    r = c.post("/api/attack", json=attack(), headers=h)
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "stored": 1, "duplicates": 0, "stale": 0}
    r = c.post("/api/attack", json=[attack(), attack(targetX=90, reportId=5)], headers=h)
    assert r.json()["stored"] == 1 and r.json()["duplicates"] == 1
    # PvP / unknown type is a 422, never stored
    assert c.post("/api/attack", json=attack(targetType="player"), headers=h).status_code == 422
    assert len(env["store"].query(477, 0)["attacks"]) == 2


def test_get_requires_session(env):
    assert env["client"].get("/api/attacks").status_code == 401
    assert env["client"].get("/attacks", follow_redirects=False).status_code == 303


def test_get_dashboard_filters(env):
    c = env["client"]
    c.post("/api/attack", json=[attack(), attack(targetType="camp", targetX=86, targetLevel=17, timestamp=NOW_MS - 2 * 86400 * 1000)],
           headers=headers(164, "GhoztMasters", env["key"]))
    c.post("/api/attack", json=attack(targetX=88), headers=headers(200, "OzookerO", env["other"]))
    assert c.post("/api/login", json={"playerName": "GhoztMasters", "apiKey": env["key"]}).status_code == 200

    data = c.get("/api/attacks", params={"worldId": 477, "days": 7}).json()
    assert data["worlds"] == [477]
    assert data["summary"]["attacks"] == 3 and data["summary"]["players"] == 2
    assert data["players"] == ["GhoztMasters", "OzookerO"]
    assert len(data["tunnels"]) == 1
    assert [p["playerName"] for p in data["tunnels"][0]["contributors"]] == ["GhoztMasters", "OzookerO"]

    assert c.get("/api/attacks", params={"days": 1}).json()["summary"]["attacks"] == 2
    assert c.get("/api/attacks", params={"since": NOW_MS - 3_600_000}).json()["summary"]["attacks"] == 2
    one = c.get("/api/attacks", params={"player": "ozookero"}).json()
    assert one["summary"]["attacks"] == 1
    assert one["players"] == ["GhoztMasters", "OzookerO"]          # dropdown unaffected by the filter
    assert c.get("/api/attacks", params={"type": "camp"}).json()["summary"]["attacks"] == 1


def test_get_without_data(env):
    c = env["client"]
    c.post("/api/login", json={"playerName": "GhoztMasters", "apiKey": env["key"]})
    data = c.get("/api/attacks").json()
    assert data["worldId"] is None and data["tunnels"] == []
