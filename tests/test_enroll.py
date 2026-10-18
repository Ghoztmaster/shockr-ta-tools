"""POST /api/enroll - the re-register guard (5.24.0, `replace` flag).

Run: python -m pytest tests/test_enroll.py
"""
import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter


class Enrollment:
    code = "secret"
    alliance_ids = [100]
    scope = "SoO"

    def check_code(self, code):
        return code == self.code


@pytest.fixture
def env(monkeypatch):
    keys = PlayerKeyStore(None)
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "enrollment", Enrollment())
    monkeypatch.setattr(main, "enroll_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    return {"client": TestClient(main.app, base_url="https://testserver"), "keys": keys}


def enroll(env, code="secret", **extra):
    body = {"playerId": 164, "playerName": "GhoztMasters", "allianceId": 100, "worldId": 477,
            "enrollmentCode": code, **extra}
    return env["client"].post("/api/enroll", json=body)


def test_first_registration_with_replace_false(env):
    r = enroll(env, replace=False)
    assert r.status_code == 200 and env["keys"].verify(164, r.json()["playerKey"])


def test_existing_key_is_kept_without_confirmation(env):
    old = enroll(env).json()["playerKey"]
    r = enroll(env, replace=False)
    assert r.status_code == 409 and r.json()["detail"] == "Already registered"
    assert env["keys"].verify(164, old), "the old key still works"


def test_confirmed_replace_issues_new_key(env):
    old = enroll(env).json()["playerKey"]
    r = enroll(env, replace=True)
    assert r.status_code == 200
    new = r.json()["playerKey"]
    assert env["keys"].verify(164, new) and not env["keys"].verify(164, old)


def test_older_userscripts_without_flag_still_replace(env):
    old = enroll(env).json()["playerKey"]
    r = enroll(env)
    assert r.status_code == 200 and not env["keys"].verify(164, old)


def test_registration_status_needs_the_code(env):
    enroll(env)
    assert enroll(env, code="wrong", replace=False).status_code == 403, "no 409 leak without the code"


# ─── POST /api/enroll/restore (5.25.0) ──────────────────────────────

GAME_ORIGIN = "https://prodgame40.alliances.commandandconquer.com"


@pytest.fixture
def restore_env(env, monkeypatch):
    monkeypatch.setattr(main, "restore_limiter", RateLimiter(max_requests=5, window_seconds=3600))
    return env


def restore(env, player_id, key, origin=GAME_ORIGIN):
    headers = {"Origin": origin} if origin else {}
    return env["client"].post("/api/enroll/restore", json={"playerId": player_id, "key": key}, headers=headers)


def test_restore_with_the_current_key_is_ok_and_changes_nothing(restore_env):
    key = enroll(restore_env).json()["playerKey"]
    r = restore(restore_env, 164, key)
    assert r.status_code == 200 and r.json() == {"status": "ok", "playerId": 164}
    assert restore_env["keys"].verify(164, key), "the key stays the same key"
    assert len(restore_env["keys"].players) == 1
    assert r.headers["access-control-allow-origin"] == GAME_ORIGIN, "the game page may read the answer"


def test_restore_wrong_key_unknown_player_and_old_key_all_give_the_same_403(restore_env):
    old = enroll(restore_env).json()["playerKey"]
    new = enroll(restore_env, replace=True).json()["playerKey"]
    answers = [restore(restore_env, 164, "0" * 32), restore(restore_env, 999, new), restore(restore_env, 164, old)]
    for r in answers:
        assert r.status_code == 403
        assert r.json() == {"detail": "Key not valid"}, "no hint why"
        assert r.headers["access-control-allow-origin"] == GAME_ORIGIN, "even the 403 carries CORS, else the script sees a network error"
    assert restore_env["keys"].verify(164, new) and not restore_env["keys"].verify(164, old)


def test_restore_is_rate_limited_per_ip(restore_env):
    key = enroll(restore_env).json()["playerKey"]
    for _ in range(5):
        assert restore(restore_env, 164, "wrong").status_code == 403
    r = restore(restore_env, 164, key)
    assert r.status_code == 429, "the 6th attempt in an hour is refused, even with the right key"
    assert r.headers["access-control-allow-origin"] == GAME_ORIGIN


def test_restore_cors_only_for_the_game_origin(restore_env):
    key = enroll(restore_env).json()["playerKey"]
    r = restore(restore_env, 164, key, origin="https://evil.example")
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers
    pre = restore_env["client"].options("/api/enroll/restore", headers={"Origin": GAME_ORIGIN,
                                        "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 204
    assert pre.headers["access-control-allow-origin"] == GAME_ORIGIN
    assert "POST" in pre.headers["access-control-allow-methods"]
    assert "Content-Type" in pre.headers["access-control-allow-headers"]
    assert restore_env["client"].options("/api/enroll/restore", headers={"Origin": "https://evil.example"}).status_code == 403


def test_version_endpoint_carries_cors_for_the_game_page(env):
    r = env["client"].get("/api/version", headers={"Origin": GAME_ORIGIN})
    assert r.status_code == 200 and "version" in r.json()
    assert r.headers["access-control-allow-origin"] == GAME_ORIGIN
    assert "access-control-allow-origin" not in env["client"].get("/api/version").headers
