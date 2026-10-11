"""Site info for the /info page and the version footer on every page.

Three JSON files in the config directory, edited by hand on the server:

- version.json        {"version", "date", "changelog": [{"version", "date",
                                       "changes": {"en": [...], "de": [...], "nl": [...]}}]}
- announcements.json  [{"message": {"en", "de", "nl"}, "type": "info|warning|update", "active": bool}]
- roadmap.json        {"planned": [{"en", "de", "nl"}], "ideas": [...]}

Each file is re-read when its mtime changes (no restart needed). A missing or
broken file never breaks a page: it yields an empty value and one log line
per change, and the last good content is NOT kept - what is on disk is what
is shown, so a deleted announcement disappears.
"""
import json
import logging
from pathlib import Path

log = logging.getLogger("shockr-alliance")

LANGS = ("en", "de", "nl")
ANNOUNCEMENT_TYPES = ("info", "warning", "update")
CHANGELOG_SHOWN = 3


class JsonFile:
    """One JSON file, re-read when its mtime (or size) changes."""

    def __init__(self, path: Path, default):
        self.path = path
        self.default = default
        self._sig = None
        self._value = default

    def get(self):
        try:
            st = self.path.stat()
            sig = (st.st_mtime_ns, st.st_size)
        except OSError:
            sig = None
        if sig != self._sig:
            self._sig = sig
            self._value = self._load() if sig is not None else self.default
        return self._value

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning("Site info: %s unreadable (%s) - shown as empty", self.path.name, e)
            return self.default


def _change_lists(obj) -> dict:
    """changes per language: {"en": [...], "de": [...], "nl": [...]}, only the
    languages that have at least one entry. An old-style plain list (one
    language for everyone) is accepted and shown in every language."""
    def clean(items):
        return [str(c) for c in (items or []) if isinstance(c, (str, int, float)) and str(c).strip()]
    if isinstance(obj, list):
        items = clean(obj)
        return {l: items for l in LANGS} if items else {}
    if isinstance(obj, dict):
        return {l: clean(obj.get(l)) for l in LANGS if isinstance(obj.get(l), list) and clean(obj.get(l))}
    return {}


def _texts(obj) -> dict | None:
    """{"en", "de", "nl"} with at least one non-empty string, else None."""
    if not isinstance(obj, dict):
        return None
    out = {l: obj[l] for l in LANGS if isinstance(obj.get(l), str) and obj[l].strip()}
    return out or None


class SiteInfo:
    def __init__(self, config_dir: Path):
        self.version_file = JsonFile(config_dir / "version.json", {})
        self.announcements_file = JsonFile(config_dir / "announcements.json", [])
        self.roadmap_file = JsonFile(config_dir / "roadmap.json", {})

    def version(self) -> dict:
        v = self.version_file.get()
        if not isinstance(v, dict):
            v = {}
        changelog = []
        for entry in v.get("changelog") or []:
            if not isinstance(entry, dict) or not entry.get("version"):
                continue
            changelog.append({"version": str(entry["version"]), "date": entry.get("date"),
                              "changes": _change_lists(entry.get("changes"))})
        return {
            "version": v.get("version"),
            "date": v.get("date"),
            "changelog": changelog[:CHANGELOG_SHOWN],
        }

    def announcements(self) -> list[dict]:
        raw = self.announcements_file.get()
        out = []
        for a in raw if isinstance(raw, list) else []:
            if not isinstance(a, dict) or a.get("active") is False:
                continue
            msg = _texts(a.get("message"))
            if not msg:
                continue
            typ = a.get("type") if a.get("type") in ANNOUNCEMENT_TYPES else "info"
            out.append({"message": msg, "type": typ})
        return out

    def roadmap(self) -> dict:
        raw = self.roadmap_file.get()
        raw = raw if isinstance(raw, dict) else {}
        return {key: [t for t in (_texts(i) for i in (raw.get(key) or [])) if t]
                for key in ("planned", "ideas")}
