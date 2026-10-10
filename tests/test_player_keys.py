"""player_keys.jsonl: one line per player — re-registering overwrites, never appends.

Run: python -m pytest tests/test_player_keys.py
"""
import json

from server.player_keys import PlayerKeyStore


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def lines(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def test_reregister_overwrites_line(tmp_path):
    path = tmp_path / "player_keys.jsonl"
    clock = Clock()
    store = PlayerKeyStore(path, clock=clock)
    old = store.enroll(164, "GhoztMasters", 100, "SoO")
    store.enroll(200, "Other", 100, "SoO")
    clock.t += 60
    new = store.enroll(164, "GhoztMasters", 100, "SoO")

    on_disk = lines(path)
    assert sorted(e["playerId"] for e in on_disk) == [164, 200]
    assert [e["createdAt"] for e in on_disk if e["playerId"] == 164] == [1_000_060]
    assert store.verify(164, new) is not None
    assert store.verify(164, old) is None

    # After a restart the new key is still the one that counts
    reloaded = PlayerKeyStore(path)
    assert reloaded.verify(164, new) is not None
    assert reloaded.verify(164, old) is None
    assert len(reloaded.players) == 2


def test_revoke_removes_line(tmp_path):
    path = tmp_path / "player_keys.jsonl"
    store = PlayerKeyStore(path)
    store.enroll(164, "GhoztMasters", 100, "SoO")
    store.enroll(200, "Other", 100, "SoO")
    assert store.revoke(164)
    assert [e["playerId"] for e in lines(path)] == [200]
    assert 164 not in PlayerKeyStore(path).players


def test_old_append_only_file_newest_created_at_wins(tmp_path):
    """Files written before the fix: several lines per player, newest createdAt wins
    even when it is not the last line; the file is rewritten to one line per player."""
    path = tmp_path / "player_keys.jsonl"
    rows = [
        {"playerId": 164, "playerName": "Ghozt", "allianceId": 100, "scope": "SoO", "playerKey": "hash-new", "createdAt": 300},
        {"playerId": 164, "playerName": "Ghozt", "allianceId": 100, "scope": "SoO", "playerKey": "hash-old", "createdAt": 100},
        {"playerId": 200, "playerName": "Other", "allianceId": 100, "scope": "SoO", "playerKey": "hash-a", "createdAt": 100},
        {"playerId": 200, "playerName": "Other", "allianceId": 100, "scope": "SoO", "playerKey": "hash-b", "createdAt": 200},
    ]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))

    store = PlayerKeyStore(path)
    assert store.players[164]["playerKey"] == "hash-new"
    assert store.players[200]["playerKey"] == "hash-b"
    on_disk = lines(path)
    assert len(on_disk) == 2
    assert {e["playerId"]: e["playerKey"] for e in on_disk} == {164: "hash-new", 200: "hash-b"}


def test_old_file_tombstones_by_time(tmp_path):
    path = tmp_path / "player_keys.jsonl"
    rows = [
        {"playerId": 1, "playerName": "A", "allianceId": 100, "scope": "SoO", "playerKey": "h1", "createdAt": 100},
        {"playerId": 1, "revoked": True, "revokedAt": 200},          # revoked after registering
        {"playerId": 2, "revoked": True, "revokedAt": 100},
        {"playerId": 2, "playerName": "B", "allianceId": 100, "scope": "SoO", "playerKey": "h2", "createdAt": 200},  # re-registered
        {"playerId": 3, "playerName": "C", "allianceId": 100, "scope": "SoO", "playerKey": "h3", "createdAt": 100},
        "not json",
    ]
    path.write_text("".join((r if isinstance(r, str) else json.dumps(r)) + "\n" for r in rows))
    store = PlayerKeyStore(path)
    assert sorted(store.players) == [2, 3]
    assert sorted(e["playerId"] for e in lines(path)) == [2, 3]


def test_same_timestamp_later_line_wins(tmp_path):
    path = tmp_path / "player_keys.jsonl"
    rows = [
        {"playerId": 1, "playerName": "A", "allianceId": 100, "scope": "SoO", "playerKey": "first", "createdAt": 100},
        {"playerId": 1, "playerName": "A", "allianceId": 100, "scope": "SoO", "playerKey": "second", "createdAt": 100},
    ]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert PlayerKeyStore(path).players[1]["playerKey"] == "second"


def test_clean_file_not_rewritten(tmp_path):
    path = tmp_path / "player_keys.jsonl"
    PlayerKeyStore(path).enroll(1, "A", 100, "SoO")
    before = path.stat().st_mtime_ns
    PlayerKeyStore(path)
    assert path.stat().st_mtime_ns == before
    assert not (tmp_path / "player_keys.jsonl.tmp").exists()
