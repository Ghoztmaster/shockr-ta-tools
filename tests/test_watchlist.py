"""WatchList — claims on Forgotten targets (server/watchlist.py + routes in main.py).

Run: python -m pytest tests/test_watchlist.py
"""
import json

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.attacks import AttackStore
from server.members import MemberStore
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter
from server.watchlist import ClaimForbidden, ClaimNotFound, WatchlistPayload, WatchlistStore
from server.web_auth import SessionStore

NOW = 1_791_607_000.0          # s
NOW_MS = int(NOW * 1000)
DAY = 86400


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


def body(**kw):
    data = {"action": "claim", "targetType": "outpost", "targetLevel": 18, "targetX": 84, "targetY": 293,
            "worldId": 477}
    data.update(kw)
    return data


def claim(store, player_id=164, name="GhoztMasters", x=84, y=293, force=False, scope="SoO", world=477):
    return store.claim(world, scope, player_id, name, x, y, 18, "outpost", force=force)


# ─── Payload ────────────────────────────────────────────────────────

def test_payload_validation():
    WatchlistPayload(**body())
    WatchlistPayload(**body(action="list", targetX=None, targetY=None, targetType=""))
    WatchlistPayload(**body(action="unclaim_all", targetX=None, targetY=None))
    for bad in (body(action="steal"), body(targetType="player"), body(action="claim", targetType=""),
                body(action="unclaim", targetX=None), body(targetX=1601), body(worldId=0)):
        with pytest.raises(ValueError):
            WatchlistPayload(**bad)


# ─── Store ──────────────────────────────────────────────────────────

def test_claim_refresh_and_one_claim_per_player_per_coordinate():
    clock = Clock()
    s = WatchlistStore(None, clock=clock)
    first = claim(s)
    assert first["status"] == "claimed" and first["claim"]["claimedAt"] == NOW_MS
    clock.t += 3600
    again = claim(s)
    assert again["status"] == "refreshed"
    assert again["claim"]["id"] == first["claim"]["id"]
    assert [c["claimedAt"] for c in s.active(477)] == [NOW_MS + 3600_000]


def test_conflict_without_force_stores_nothing():
    s = WatchlistStore(None, clock=Clock())
    claim(s)
    result = claim(s, player_id=200, name="OzookerO")
    assert result["status"] == "conflict" and result["claim"] is None
    assert [c["playerName"] for c in result["others"]] == ["GhoztMasters"]
    assert len(s.active(477)) == 1


def test_force_adds_next_to_the_other_claim():
    s = WatchlistStore(None, clock=Clock())
    claim(s)
    result = claim(s, player_id=200, name="OzookerO", force=True)
    assert result["status"] == "claimed"
    assert [c["playerName"] for c in result["others"]] == ["GhoztMasters"]
    assert sorted(c["playerName"] for c in s.active(477)) == ["GhoztMasters", "OzookerO"]


def test_scopes_do_not_see_each_other():
    s = WatchlistStore(None, clock=Clock())
    claim(s, scope="SoO")
    assert claim(s, player_id=300, name="Other", scope="ABC")["status"] == "claimed"
    assert [c["playerName"] for c in s.active(477, scope="ABC")] == ["Other"]
    assert len(s.active(477)) == 2          # website: every scope


def test_unclaim_and_unclaim_all():
    s = WatchlistStore(None, clock=Clock())
    claim(s)
    claim(s, x=90, y=310)
    claim(s, player_id=200, name="OzookerO", x=1, y=1)
    assert s.unclaim(477, 164, 1, 1) == []                     # not mine
    assert [(c["targetX"], c["targetY"]) for c in s.unclaim(477, 164, 84, 293)] == [(84, 293)]
    claim(s, x=91, y=311)
    assert len(s.unclaim(477, 164)) == 2
    assert [c["playerName"] for c in s.active(477)] == ["OzookerO"]


def test_expire_after_24h():
    clock = Clock()
    s = WatchlistStore(None, clock=clock)
    claim(s)
    clock.t += DAY - 1
    assert len(s.active(477)) == 1
    clock.t += 2
    assert s.active(477) == []
    assert s.worlds() == []


def test_on_attack_only_own_claim_made_before_the_attack():
    clock = Clock()
    s = WatchlistStore(None, clock=clock)
    claim(s)
    claim(s, player_id=200, name="OzookerO", force=True)
    removed = s.on_attack(477, 164, 84, 293, NOW_MS + 60_000)
    assert [c["playerName"] for c in removed] == ["GhoztMasters"]
    assert [c["playerName"] for c in s.active(477)] == ["OzookerO"]
    # A claim made AFTER the attack (the report came in late) stays
    clock.t += 600
    claim(s)
    assert s.on_attack(477, 164, 84, 293, NOW_MS + 60_000) == []


def test_delete_own_admin_forbidden_unknown():
    s = WatchlistStore(None, clock=Clock())
    mine = claim(s)["claim"]["id"]
    theirs = claim(s, player_id=200, name="OzookerO", x=1, y=1)["claim"]["id"]
    with pytest.raises(ClaimForbidden):
        s.delete(theirs, 164)
    assert s.delete(mine, 164)["playerName"] == "GhoztMasters"
    assert s.delete(theirs, None)["playerName"] == "OzookerO"     # admin
    with pytest.raises(ClaimNotFound):
        s.delete("nope", None)


def test_persisted_per_world_and_reloaded(tmp_path):
    clock = Clock()
    s = WatchlistStore(tmp_path, clock=clock)
    claim(s)
    claim(s, world=478, x=5, y=5)
    path = tmp_path / "watchlist" / "477.json"
    saved = json.loads(path.read_text())
    assert saved["worldId"] == 477
    assert {"id", "playerId", "playerName", "targetType", "targetLevel", "targetX", "targetY", "claimedAt",
            "scope"} <= set(saved["claims"][0])

    restarted = WatchlistStore(tmp_path, clock=clock)
    assert sorted(restarted.worlds()) == [477, 478]
    # Delete by id finds the world without a prior read of it
    other = WatchlistStore(tmp_path, clock=clock)
    cid = saved["claims"][0]["id"]
    assert other.delete(cid, 164)["targetX"] == 84
    assert json.loads(path.read_text())["claims"] == []

    # Expired claims are dropped from the file on the next access
    claim(other)
    clock.t += DAY + 1
    later = WatchlistStore(tmp_path, clock=clock)
    assert later.active(477) == []
    assert json.loads(path.read_text())["claims"] == []


# ─── Endpoints ──────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch):
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
    store = WatchlistStore(None, clock=clock)
    monkeypatch.setattr(main, "watchlist", store)
    monkeypatch.setattr(main, "attack_store", AttackStore(None, clock=clock))
    monkeypatch.setattr(main.time, "time", clock)
    client = TestClient(main.app, base_url="https://testserver")
    return {"client": client, "key": key, "other": other, "store": store, "clock": clock}


def headers(pid, name, key):
    return {"X-Player-Key": key, "X-Player-Id": str(pid), "X-Player-Name": name, "X-Alliance-Id": "100"}


def gh(env):
    return headers(164, "GhoztMasters", env["key"])


def oz(env):
    return headers(200, "OzookerO", env["other"])


def test_post_requires_player_key(env):
    assert env["client"].post("/api/watchlist", json=body()).status_code == 403
    assert env["client"].post("/api/watchlist", json=body(), headers=headers(164, "GhoztMasters", "x")).status_code == 403


def test_post_claim_conflict_force_list_unclaim(env):
    c = env["client"]
    r = c.post("/api/watchlist", json=body(), headers=gh(env)).json()
    assert r["status"] == "claimed" and r["claim"]["playerName"] == "GhoztMasters"

    r = c.post("/api/watchlist", json=body(), headers=oz(env)).json()
    assert r["status"] == "conflict" and r["others"][0]["playerName"] == "GhoztMasters"
    r = c.post("/api/watchlist", json=body(force=True), headers=oz(env)).json()
    assert r["status"] == "claimed"

    listed = c.post("/api/watchlist", json={"action": "list", "worldId": 477}, headers=gh(env)).json()
    assert sorted(x["playerName"] for x in listed["claims"]) == ["GhoztMasters", "OzookerO"]
    assert "scope" not in listed["claims"][0]

    r = c.post("/api/watchlist", json={"action": "unclaim", "worldId": 477, "targetX": 84, "targetY": 293},
               headers=gh(env)).json()
    assert [x["playerName"] for x in r["removed"]] == ["GhoztMasters"]
    c.post("/api/watchlist", json=body(targetX=1, targetY=2), headers=oz(env))
    r = c.post("/api/watchlist", json={"action": "unclaim_all", "worldId": 477}, headers=oz(env)).json()
    assert len(r["removed"]) == 2
    assert env["store"].active(477) == []


def test_won_attack_removes_own_claim(env):
    c = env["client"]
    c.post("/api/watchlist", json=body(), headers=gh(env))
    c.post("/api/watchlist", json=body(force=True), headers=oz(env))
    attack = {"targetType": "outpost", "targetLevel": 18, "targetX": 84, "targetY": 293, "worldId": 477,
              "timestamp": NOW_MS + 1000}
    env["clock"].t += 5
    r = c.post("/api/attack", json=attack, headers=gh(env)).json()
    assert r["stored"] == 1
    assert [(x["targetX"], x["targetY"]) for x in r["unclaimed"]] == [(84, 293)]
    assert [x["playerName"] for x in env["store"].active(477)] == ["OzookerO"]
    # Duplicate attack: nothing more removed
    assert "unclaimed" not in c.post("/api/attack", json=attack, headers=gh(env)).json()


def test_website_get_and_delete(env):
    c = env["client"]
    assert c.get("/api/watchlist").status_code == 401
    assert c.get("/watchlist", follow_redirects=False).status_code == 303
    mine = c.post("/api/watchlist", json=body(), headers=gh(env)).json()["claim"]["id"]
    theirs = c.post("/api/watchlist", json=body(targetX=90, targetY=310, targetType="camp", targetLevel=20),
                    headers=oz(env)).json()["claim"]["id"]
    assert c.post("/api/login", json={"playerName": "GhoztMasters", "apiKey": env["key"]}).status_code == 200

    data = c.get("/api/watchlist").json()
    assert data["worldId"] == 477 and data["worlds"] == [477]
    assert data["me"] == 164 and data["ttl"] == DAY
    assert data["players"] == ["GhoztMasters", "OzookerO"]
    assert {x["id"] for x in data["claims"]} == {mine, theirs}
    assert c.get("/watchlist").status_code == 200

    assert c.delete(f"/api/watchlist/{theirs}").status_code == 403
    assert c.delete(f"/api/watchlist/{mine}").status_code == 200
    assert c.delete(f"/api/watchlist/{mine}").status_code == 404
    # Admin path (Basic Auth at the proxy, session in the app)
    assert c.delete(f"/api/admin/watchlist/{theirs}").status_code == 200
    assert c.get("/api/watchlist", params={"worldId": 477}).json()["claims"] == []


def test_admin_delete_needs_a_session(env):
    cid = env["client"].post("/api/watchlist", json=body(), headers=gh(env)).json()["claim"]["id"]
    assert TestClient(main.app, base_url="https://testserver").delete(f"/api/admin/watchlist/{cid}").status_code == 401
