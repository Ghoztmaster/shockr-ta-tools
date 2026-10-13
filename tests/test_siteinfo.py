"""Info page + version footer (server/siteinfo.py + routes in main.py).

Run: python -m pytest tests/test_siteinfo.py
"""
import json
import os
import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.members import MemberStore
from server.player_keys import PlayerKeyStore
from server.ratelimit import RateLimiter
from server.siteinfo import SiteInfo
from server.web_auth import SessionStore

ROOT = Path(__file__).parent.parent
STATIC = ROOT / "server" / "static"
# The released version (build.js @version) - config/version.json must follow it
BUILD_VERSION = re.search(r"const VERSION = '([^']+)'", (ROOT / "build.js").read_text(encoding="utf-8")).group(1)


def write(path: Path, obj):
    path.write_text(json.dumps(obj), encoding="utf-8")
    # mtime granularity on some filesystems is coarse: force a visible change
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000 * (1 + int(write.n))))
    write.n += 1


write.n = 0


@pytest.fixture
def cfg(tmp_path):
    for name in ("version.json", "announcements.json", "roadmap.json"):
        shutil.copy(ROOT / "config" / name, tmp_path / name)
    return tmp_path


@pytest.fixture
def env(cfg, monkeypatch):
    keys = PlayerKeyStore(None)
    key = keys.enroll(164, "GhoztMasters", 100, "SoO")
    monkeypatch.setattr(main, "player_keys", keys)
    monkeypatch.setattr(main, "sessions", SessionStore(keys))
    monkeypatch.setattr(main, "member_store", MemberStore(None))
    monkeypatch.setattr(main, "login_limiter", RateLimiter(max_requests=1000, window_seconds=60))
    monkeypatch.setattr(main, "get_limiter", RateLimiter(max_requests=1000, window_seconds=1))
    monkeypatch.setattr(main, "site_info", SiteInfo(cfg))
    client = TestClient(main.app, base_url="https://testserver")
    return {"client": client, "key": key, "cfg": cfg}


def login(env):
    r = env["client"].post("/api/login", json={"playerName": "GhoztMasters", "apiKey": env["key"]})
    assert r.status_code == 200


class TestSiteInfo:
    def test_repo_config_files(self, cfg):
        si = SiteInfo(cfg)
        v = si.version()
        assert v["version"] == BUILD_VERSION, "config/version.json follows the @version bump"
        assert v["changelog"][0]["version"] == BUILD_VERSION and v["changelog"][0]["date"] == v["date"]
        assert 1 <= len(v["changelog"]) <= 5, "at most 5 versions"
        for c in v["changelog"]:
            assert set(c["changes"]) == {"en", "de", "nl"}, "changelog translated per language"
        assert v["changelog"][0]["changes"]["en"], "the new version lists its changes"
        a = si.announcements()
        assert len(a) == 1 and a[0]["type"] == "info" and set(a[0]["message"]) == {"en", "de", "nl"}
        r = si.roadmap()
        assert len(r["planned"]) == 2 and len(r["ideas"]) == 2

    def test_changes_are_picked_up_without_restart(self, cfg):
        si = SiteInfo(cfg)
        assert len(si.announcements()) == 1
        write(cfg / "announcements.json", [
            {"message": {"en": "a"}, "type": "info", "active": True},
            {"message": {"en": "b", "nl": "b-nl"}, "type": "warning", "active": True},
            {"message": {"en": "hidden"}, "type": "update", "active": False},
            {"message": {"en": "c"}, "type": "bogus"},
        ])
        a = si.announcements()
        assert [x["message"]["en"] for x in a] == ["a", "b", "c"], "active:false hidden, not deleted"
        assert [x["type"] for x in a] == ["info", "warning", "info"], "unknown type -> info"
        write(cfg / "roadmap.json", {"planned": [{"en": "X", "de": "X", "nl": "X"}], "ideas": []})
        assert si.roadmap() == {"planned": [{"en": "X", "de": "X", "nl": "X"}], "ideas": []}

    def test_only_last_three_changelog_entries(self, cfg):
        si = SiteInfo(cfg)
        write(cfg / "version.json", {"version": "9", "date": "2026-01-01", "changelog": [
            {"version": str(i), "date": None, "changes": ["x"]} for i in range(5)]})
        assert [c["version"] for c in si.version()["changelog"]] == ["0", "1", "2"]

    def test_changes_per_language_and_old_list_format(self, cfg):
        si = SiteInfo(cfg)
        write(cfg / "version.json", {"version": "1", "date": "2026-01-01", "changelog": [
            {"version": "1", "changes": {"en": ["a"], "nl": ["a-nl"], "de": []}},
            {"version": "0", "changes": ["legacy"]},
        ]})
        cl = si.version()["changelog"]
        assert cl[0]["changes"] == {"en": ["a"], "nl": ["a-nl"]}, "empty language dropped -> client falls back to en"
        assert cl[1]["changes"] == {"en": ["legacy"], "de": ["legacy"], "nl": ["legacy"]}

    def test_missing_or_broken_file_is_empty(self, cfg):
        si = SiteInfo(cfg)
        (cfg / "roadmap.json").unlink()
        assert si.roadmap() == {"planned": [], "ideas": []}
        (cfg / "announcements.json").write_text("{not json", encoding="utf-8")
        assert si.announcements() == []


class TestRoutes:
    def test_version_is_public(self, env):
        r = env["client"].get("/api/version")
        assert r.status_code == 200 and r.json()["version"] == BUILD_VERSION

    def test_info_api_needs_session(self, env):
        assert env["client"].get("/api/info").status_code == 401
        login(env)
        d = env["client"].get("/api/info").json()
        assert d["version"]["version"] == BUILD_VERSION
        assert len(d["announcements"]) == 1 and len(d["roadmap"]["planned"]) == 2

    def test_info_page_needs_session(self, env):
        r = env["client"].get("/info", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"].endswith("login")
        login(env)
        r = env["client"].get("/info")
        assert r.status_code == 200 and "installSteps" in r.text

    def test_footer_script_is_served(self, env):
        r = env["client"].get("/static/footer.js")
        assert r.status_code == 200 and "api/version" in r.text

    def test_announcements_api_needs_session(self, env):
        assert env["client"].get("/api/announcements").status_code == 401
        login(env)
        a = env["client"].get("/api/announcements").json()["announcements"]
        assert len(a) == 1 and a[0]["type"] == "info"
        write(env["cfg"] / "announcements.json", [{"message": {"en": "x"}, "type": "update", "active": True}])
        a = env["client"].get("/api/announcements").json()["announcements"]
        assert a == [{"message": {"en": "x"}, "type": "update"}], "picked up without restart"
        r = env["client"].get("/static/announcements.js")
        assert r.status_code == 200 and "api/announcements" in r.text


class TestPages:
    @pytest.mark.parametrize("name", ["index.html", "targets.html", "attacks.html", "loot.html", "login.html", "info.html"])
    def test_every_page_loads_the_footer(self, name):
        assert '<script src="static/footer.js"></script>' in (STATIC / name).read_text(encoding="utf-8")

    @pytest.mark.parametrize("name", ["index.html", "targets.html", "attacks.html", "loot.html"])
    def test_banner_on_data_pages(self, name):
        assert '<script src="static/announcements.js"></script>' in (STATIC / name).read_text(encoding="utf-8")

    @pytest.mark.parametrize("name", ["index.html", "targets.html", "attacks.html", "loot.html"])
    def test_nav_links_to_info(self, name):
        assert 'href="info" ' in (STATIC / name).read_text(encoding="utf-8")


class TestI18n:
    """Every info key exists in all three languages; 9 install steps, 11 trouble rows."""

    def keys_per_lang(self):
        src = (STATIC / "i18n.js").read_text(encoding="utf-8")
        blocks = re.split(r"\n        (en|de|nl): \{", src)
        out = {}
        for i in range(1, len(blocks), 2):
            out[blocks[i]] = set(re.findall(r"^\s+(\w+):", blocks[i + 1], re.M))
        return out

    def test_info_keys_in_all_languages(self):
        k = self.keys_per_lang()
        info = {x for x in k["en"] if x.startswith(("info", "navInfo"))}
        assert info, "no info keys"
        for lang in ("de", "nl"):
            assert info <= k[lang], (lang, info - k[lang])
        for i in range(1, 10):
            assert f"infoInstall{i}Html" in info
        for i in range(1, 12):
            assert f"infoTrouble{i}P" in info and f"infoTrouble{i}S" in info
        for key in ("infoBugTitle", "infoBugIntro", "infoBug1", "infoBug2", "infoBug3Html", "infoContact"):
            assert key in info
