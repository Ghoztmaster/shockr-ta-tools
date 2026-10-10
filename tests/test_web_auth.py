"""Website login via the personal API key (server/web_auth.py + routes in main.py).

Run: python -m pytest tests/test_web_auth.py
"""
import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.members import MemberStore
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter
from server.web_auth import SessionStore, SESSION_COOKIE, SESSION_TTL_SECONDS, LOGIN_FAILED


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def env(monkeypatch):
    clock = Clock()
    keys = PlayerKeyStore(None, clock=clock)
    key = keys.enroll(164, "GhoztMasters", 100, "SoO")
    other_key = keys.enroll(200, "Other", 100, "SoO")
    sessions = SessionStore(keys, clock=clock)
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", sessions)
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    client = TestClient(main.app, base_url="https://testserver")
    return {"client": client, "keys": keys, "key": key, "other_key": other_key,
            "sessions": sessions, "clock": clock}


def login(client, name, key):
    return client.post("/api/login", json={"playerName": name, "apiKey": key})


def test_pages_redirect_to_login_without_cookie(env):
    c = env["client"]
    for path in ("/", "/targets"):
        r = c.get(path, follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "login"


def test_login_page_and_scripts_are_public(env):
    c = env["client"]
    assert c.get("/login").status_code == 200
    assert 'data-i18n="loginButton"' in c.get("/login").text
    for name in ("session.js", "i18n.js"):
        r = c.get(f"/static/{name}")
        assert r.status_code == 200 and "javascript" in r.headers["content-type"], name
    # Only the whitelisted scripts — the pages themselves stay behind the session
    for name in ("index.html", "targets.html", "login.html", "..%2Fmain.py"):
        assert c.get(f"/static/{name}").status_code == 404, name


def test_i18n_has_every_key_in_all_languages():
    """Every T()/data-i18n key used by the pages exists in en, de and nl."""
    import re
    from pathlib import Path
    static = Path(main.STATIC_DIR)
    src = (static / "i18n.js").read_text(encoding="utf-8")
    tables = {}
    for lang in ("en", "de", "nl"):
        block = re.search(rf"\n        {lang}: \{{(.*?)\n        \}},", src, re.S).group(1)
        tables[lang] = set(re.findall(r"^\s+(\w+):", block, re.M))
    assert tables["en"] == tables["de"] == tables["nl"]
    used = set()
    for page in ("login.html", "index.html", "targets.html", "session.js"):
        text = (static / page).read_text(encoding="utf-8")
        used |= set(re.findall(r"\bT\('(\w+)'", text))
        used |= set(re.findall(r'data-i18n(?:-placeholder|-title|-doctitle)?="(\w+)"', text))
        used |= set(re.findall(r"label: '(\w+)'", text))
    assert used - tables["en"] == set()


def test_viewer_api_requires_session(env):
    c = env["client"]
    for path in ("/api/bases", "/api/base/1", "/api/targets", "/api/me"):
        assert c.get(path).status_code == 401, path


def test_login_ok_sets_httponly_cookie_and_opens_pages(env):
    c = env["client"]
    r = login(c, "GhoztMasters", env["key"])
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    assert f"Max-Age={SESSION_TTL_SECONDS}" in cookie
    assert c.get("/", follow_redirects=False).status_code == 200
    assert c.get("/targets", follow_redirects=False).status_code == 200
    assert c.get("/api/me").json() == {"playerName": "GhoztMasters", "playerId": 164}
    assert c.get("/api/targets").status_code == 200


def test_login_name_is_case_insensitive(env):
    r = login(env["client"], "  ghoztmasters ", env["key"])
    assert r.status_code == 200


def test_cookie_path_follows_proxy_prefix(env):
    r = env["client"].post("/api/login", json={"playerName": "GhoztMasters", "apiKey": env["key"]},
                           headers={"X-Forwarded-Prefix": "/shockr"})
    assert "Path=/shockr/" in r.headers["set-cookie"]


@pytest.mark.parametrize("name,key_name", [
    ("GhoztMasters", "wrong"),       # wrong key
    ("Nobody", "key"),               # unknown player
    ("GhoztMasters", "other_key"),   # another player's key
])
def test_login_failures_same_message(env, name, key_name):
    key = env.get(key_name, "deadbeef" * 4)
    r = login(env["client"], name, key)
    assert r.status_code == 401
    assert r.json() == {"error": LOGIN_FAILED}
    assert "set-cookie" not in r.headers


def test_session_expires_after_7_days(env):
    c = env["client"]
    login(c, "GhoztMasters", env["key"])
    env["clock"].t += SESSION_TTL_SECONDS - 1
    assert c.get("/api/me").status_code == 200
    env["clock"].t += 2
    assert c.get("/api/me").status_code == 401
    assert c.get("/", follow_redirects=False).status_code == 303


def test_logout_removes_session_and_cookie(env):
    c = env["client"]
    login(c, "GhoztMasters", env["key"])
    token = c.cookies.get(SESSION_COOKIE)
    r = c.post("/api/logout", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "../login"
    assert f'{SESSION_COOKIE}=""' in r.headers["set-cookie"] or "Max-Age=0" in r.headers["set-cookie"]
    assert token not in env["sessions"].sessions
    # Even if the browser kept the old cookie, it no longer works
    c.cookies.set(SESSION_COOKIE, token)
    assert c.get("/api/me").status_code == 401


def test_revoke_and_reissue_end_session(env):
    c = env["client"]
    login(c, "GhoztMasters", env["key"])
    assert c.get("/api/me").status_code == 200
    env["keys"].enroll(164, "GhoztMasters", 100, "SoO")   # /st register again -> new key
    env["clock"].t += 1
    assert c.get("/api/me").status_code == 401

    login(c, "Other", env["other_key"])
    assert c.get("/api/me").status_code == 200
    env["keys"].revoke(200)                                # admin removes a leaver
    assert c.get("/api/me").status_code == 401


def test_session_cookie_is_not_header_auth(env):
    """Scan/target-watch stay on X-Player-Key: a website session alone is not enough."""
    c = env["client"]
    login(c, "GhoztMasters", env["key"])
    assert c.get("/api/target-watch/477").status_code == 403
    r = c.get("/api/target-watch/477", headers={
        "X-Player-Key": env["key"], "X-Player-Id": "164",
        "X-Player-Name": "GhoztMasters", "X-Alliance-Id": "100",
    })
    assert r.status_code != 403 or r.json()["detail"] != "Invalid player key"


def test_login_rate_limited(env, monkeypatch):
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=2, window_seconds=60))
    c = env["client"]
    assert login(c, "Nobody", "x").status_code == 401
    assert login(c, "Nobody", "x").status_code == 401
    assert login(c, "Nobody", "x").status_code == 429
