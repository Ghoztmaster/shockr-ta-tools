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
