"""Auto-revoke of player keys when a player left the alliance (5.17.0).

server/player_keys.py AllianceMembershipCheck + the allianceMembers field on
POST /api/scan.

Run: python -m pytest tests/test_auto_revoke.py
"""
import logging

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.members import MemberStore
from server.player_keys import AllianceMember, AllianceMembershipCheck, PlayerKeyStore
from server.ratelimit import RateLimiter
from server.storage import ScanStorage
from server.web_auth import SessionStore

T0 = 1_791_607_000.0
ALLIANCE = 100


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def roster(*ids):
    return [AllianceMember(playerId=i, playerName=f"P{i}") for i in ids]


@pytest.fixture
def setup():
    clock = Clock()
    keys = PlayerKeyStore(None, clock=clock)
    for pid in (1, 2, 3, 4, 9):
        keys.enroll(pid, f"P{pid}", ALLIANCE, "SoO")
    keys.enroll(50, "Other", 200, "Other")       # another alliance: never judged by alliance 100's lists
    clock.t += 10
    return clock, keys, AllianceMembershipCheck(clock=clock)


def test_three_scanners_revoke(setup, caplog):
    clock, keys, check = setup
    caplog.set_level(logging.INFO, logger="shockr-alliance")
    # Player 9 left: three scanners send a list without 9. The comparison runs on the first
    # report (only 1 scanner -> warning), and again an hour later with all three.
    assert check.check_alliance_membership(keys, ALLIANCE, 1, roster(1, 2, 3, 4)) == []
    assert "P9 not in alliance list (reported by 1/3 required scanners)" in caplog.text
    clock.t += 60
    assert check.check_alliance_membership(keys, ALLIANCE, 2, roster(1, 2, 3, 4)) == []   # within the hour: no run
    assert check.check_alliance_membership(keys, ALLIANCE, 3, roster(1, 2, 3, 4)) == []
    assert 9 in keys.players
    clock.t += 3600
    assert check.check_alliance_membership(keys, ALLIANCE, 4, roster(1, 2, 3, 4)) == [9]
    assert 9 not in keys.players and 50 in keys.players
    assert "Key revoked: P9 (9) — no longer in alliance" in caplog.text


def test_one_or_two_scanners_only_warn(setup, caplog):
    clock, keys, check = setup
    caplog.set_level(logging.WARNING, logger="shockr-alliance")
    check.check_alliance_membership(keys, ALLIANCE, 1, roster(1, 2, 3, 4))
    clock.t += 3600
    check.check_alliance_membership(keys, ALLIANCE, 2, roster(1, 2, 3, 4))
    clock.t += 3600
    check.check_alliance_membership(keys, ALLIANCE, 1, roster(1, 2, 3, 4))   # same scanner again: still 2
    assert 9 in keys.players
    assert "P9 not in alliance list (reported by 2/3 required scanners)" in caplog.text


def test_newer_list_with_the_player_blocks(setup):
    clock, keys, check = setup
    for s in (1, 2, 3):
        check.check_alliance_membership(keys, ALLIANCE, s, roster(1, 2, 3, 4))
        clock.t += 1
    check.check_alliance_membership(keys, ALLIANCE, 4, roster(1, 2, 3, 4, 9))   # newest says: still a member
    clock.t += 3600
    check.check_alliance_membership(keys, ALLIANCE, 4, roster(1, 2, 3, 4, 9))
    assert 9 in keys.players


def test_list_without_its_own_scanner_ignored(setup):
    clock, keys, check = setup
    for s in (1, 2, 3):
        check.check_alliance_membership(keys, ALLIANCE, s, roster(4))   # broken read: the scanner is missing
        clock.t += 3600
    assert set(keys.players) == {1, 2, 3, 4, 9, 50}


def test_old_lists_expire(setup):
    clock, keys, check = setup
    check.check_alliance_membership(keys, ALLIANCE, 1, roster(1, 2, 3, 4))
    check.check_alliance_membership(keys, ALLIANCE, 2, roster(1, 2, 3, 4))
    clock.t += 25 * 3600                                                   # > 24 h: those two no longer count
    check.check_alliance_membership(keys, ALLIANCE, 3, roster(1, 2, 3, 4))
    assert 9 in keys.players


def test_reregistered_player_keeps_new_key(setup):
    clock, keys, check = setup
    for s in (1, 2, 3):
        check.check_alliance_membership(keys, ALLIANCE, s, roster(1, 2, 3, 4))
    clock.t += 3600
    assert check.check_alliance_membership(keys, ALLIANCE, 1, roster(1, 2, 3, 4)) == [9]
    # Player 9 comes back and registers again: the lists from before the new key don't count
    clock.t += 60
    keys.enroll(9, "P9", ALLIANCE, "SoO")
    clock.t += 3600
    assert check.check_alliance_membership(keys, ALLIANCE, 2, roster(1, 2, 3, 4, 9)) == []
    clock.t += 3600
    assert check.check_alliance_membership(keys, ALLIANCE, 3, roster(1, 2, 3, 4)) == []   # only 1 newer list
    assert 9 in keys.players


# ─── Through POST /api/scan ──────────────────────────────────────────

@pytest.fixture
def env(monkeypatch, tmp_path):
    clock = Clock()
    keys = PlayerKeyStore(None, clock=clock)
    issued = {pid: keys.enroll(pid, f"P{pid}", ALLIANCE, "SoO") for pid in (1, 2, 3, 9)}
    clock.t += 10
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", SessionStore(keys, clock=clock))
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "storage", ScanStorage(tmp_path))
    monkeypatch.setattr(main, "membership_check", AllianceMembershipCheck(clock=clock))
    monkeypatch.setattr(main, "post_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "get_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    monkeypatch.setattr(main.time, "time", clock)
    return {"client": TestClient(main.app, base_url="https://testserver"), "keys": keys, "issued": issued,
            "clock": clock, "tmp": tmp_path}


def scan(env, pid, city_id, members=None):
    body = {"city_id": city_id, "world_id": 477, "x": 10, "y": 10, "name": "b", "owner": f"P{pid}", "owner_id": pid,
            "faction": 1, "level_base": 10, "level_off": 10, "level_def": 10, "tiles": "", "scanned_by": f"P{pid}",
            "version": 1, "timestamp": int(env["clock"]() * 1000)}
    if members is not None:
        body["allianceMembers"] = [{"playerId": m, "playerName": f"P{m}"} for m in members]
    headers = {"X-Player-Key": env["issued"][pid], "X-Player-Id": str(pid), "X-Player-Name": f"P{pid}",
               "X-Alliance-Id": str(ALLIANCE)}
    return env["client"].post("/api/scan", json=body, headers=headers)


def test_scan_route_revokes_and_ends_login(env):
    c = env["client"]
    assert c.post("/api/login", json={"playerName": "P9", "apiKey": env["issued"][9]}).status_code == 200
    assert c.get("/api/me").status_code == 200
    for pid in (1, 2, 3):
        assert scan(env, pid, 1000 + pid, members=[1, 2, 3]).status_code == 200
    env["clock"].t += 3600
    assert scan(env, 1, 2000, members=[1, 2, 3]).status_code == 200
    assert 9 not in env["keys"].players
    # The website session of player 9 is gone, a new login with the old key fails
    assert c.get("/api/me").status_code == 401
    assert c.post("/api/login", json={"playerName": "P9", "apiKey": env["issued"][9]}).status_code != 200
    # The member list is not stored with the scan
    stored = "".join(p.read_text() for p in env["tmp"].rglob("*.jsonl"))
    assert stored and "allianceMembers" not in stored


def test_scan_without_members_unchanged(env):
    assert scan(env, 1, 1001).json()["status"] == "ok"
    assert scan(env, 1, 1001).json()["status"] == "duplicate"
