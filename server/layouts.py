"""
Base Layouts page (/layouts) — the LayoutScanner's scans as a BaseScanner-style
table and layout overview.

Everything here is derived from data the server already has; nothing is
sent by the userscript for this page:

- Layout (tiles): 16 rows of 9 resource types (lib/scanner-util.js getLayout,
  3 bits per tile, base62). Rows 0-7 are the base area, 8-15 the defense area.
  Types: 0 empty, 1 crystal, 2 tiberium, 4 woods, 5 scrub, 6 oil, 7 swamp.
- Spot counts ("7|6|5|4|3 Tib/Cry/Mix"): per EMPTY field of the base area the
  number of tiberium / crystal neighbours (8-neighbourhood, inside the 9x8
  base area; edge fields count too). Tib N = exactly N tiberium neighbours
  (8 counts as 7), Cry N likewise, Mix N = N resource neighbours with both
  kinds present. Power8 = empty fields with 8 empty neighbours, picked
  row-major so that no two chosen centres touch (one power block each).
- CY / DF: the row of the Construction Yard / Defense Facility counted from
  the bottom of the base area (8 - y), from the scan's buildings (mdb ids).
- Growth: own layout score (NOT the AIO growth-rate simulation): per empty
  field (tib neighbours² + crystal neighbours²), summed, / 10. Concentrated
  clusters score higher than scattered fields.
- Loot (Tiberium / Crystal / Dollar): the average loot of the alliance's won
  attacks on that target (city id, else coordinate); without such attacks an
  estimate = the average over won attacks on the same type and level
  (rounded) in that world, flagged lootEstimated.
- CP: the CP cost of the logged-in player's newest attack on that target
  (attacks carry cpCost since 5.33.0); None when unknown - the real cost
  depends on the attacking base and only the game can compute it.
- Attack status: destroyed (an attack after the scan destroyed it), claimed
  (active WatchList claim), attacked (attack after the scan, still standing),
  else free.
"""
from server.attacks import is_destroyed
from server.storage import fg_type

BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
B62_VALUE = {c: i for i, c in enumerate(BASE62)}
GRID_W = 9
GRID_H = 16
BASE_ROWS = 8
SPOT_SIZES = (7, 6, 5, 4, 3)
# Building mdb ids (GDI / NOD / Forgotten), as the game client reports them
CY_IDS = {112, 151, 177}
DF_IDS = {131, 158, 195}
TYPE_ORDER = ("camp", "outpost", "base", "player")


def b62_unpack(s: str) -> list[int]:
    """'.'-separated base62 numbers, least significant digit first (lib/packer.js Base62)."""
    out = []
    for part in (s or "").split("."):
        value, mul = 0, 1
        for ch in part:
            digit = B62_VALUE.get(ch)
            if digit is None:
                break
            value += digit * mul
            mul *= 62
        out.append(value)
    return out


def decode_tiles(tiles: str) -> list[list[int]] | None:
    """16 rows x 9 resource types, or None when the scan holds no layout."""
    rows = b62_unpack(tiles) if tiles else []
    if len(rows) < BASE_ROWS:
        return None
    return [[(rows[y] >> (3 * x)) & 7 for x in range(GRID_W)] for y in range(min(len(rows), GRID_H))]


def decode_units(packed: str) -> list[dict]:
    """UnitPacker format: xy 8 bits (y * 9 + x), mdb id 9 bits, level 7 bits."""
    if not packed:
        return []
    out = []
    for n in b62_unpack(packed):
        xy = n & 0xFF
        out.append({"x": xy % GRID_W, "y": xy // GRID_W, "id": (n >> 8) & 0x1FF, "level": (n >> 17) & 0x7F})
    return out


def _neighbours(x: int, y: int):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dx or dy) and 0 <= x + dx < GRID_W and 0 <= y + dy < BASE_ROWS:
                yield x + dx, y + dy


def layout_metrics(grid: list[list[int]], buildings: list[dict]) -> dict:
    """Field counts, spot counts, Power8, growth score and CY/DF of one base (see module doc)."""
    base = grid[:BASE_ROWS]
    tib = {n: 0 for n in SPOT_SIZES}
    cry = {n: 0 for n in SPOT_SIZES}
    mix = {n: 0 for n in SPOT_SIZES}
    growth = 0
    power_centres: set[tuple[int, int]] = set()
    for y in range(BASE_ROWS):
        for x in range(GRID_W):
            if base[y][x] != 0:
                continue
            around = [base[ny][nx] for nx, ny in _neighbours(x, y)]
            t, c = around.count(2), around.count(1)
            growth += t * t + c * c
            if min(t, 7) in tib and not c:
                tib[min(t, 7)] += 1
            if min(c, 7) in cry and not t:
                cry[min(c, 7)] += 1
            if t and c and min(t + c, 7) in mix:
                mix[min(t + c, 7)] += 1
            if (len(around) == 8 and all(v == 0 for v in around)
                    and not any(p in power_centres for p in _neighbours(x, y))):
                power_centres.add((x, y))
    cy = next((b for b in buildings if b["id"] in CY_IDS and b["y"] < BASE_ROWS), None)
    df = next((b for b in buildings if b["id"] in DF_IDS and b["y"] < BASE_ROWS), None)
    return {
        "tibFields": sum(row.count(2) for row in base),
        "cryFields": sum(row.count(1) for row in base),
        "power8": len(power_centres),
        "tibSpots": [tib[n] for n in SPOT_SIZES],
        "crySpots": [cry[n] for n in SPOT_SIZES],
        "mixSpots": [mix[n] for n in SPOT_SIZES],
        "growth": round(growth / 10, 1),
        "cyRow": BASE_ROWS - cy["y"] if cy else None,
        "cyCol": cy["x"] if cy else None,
        "dfRow": BASE_ROWS - df["y"] if df else None,
    }


def base_type(record: dict) -> str | None:
    """camp / outpost / base (Forgotten), player (GDI/NOD), None for anything else (event camps)."""
    if record.get("faction") in (1, 2):
        return "player"
    return fg_type(record)


def _on_target(a: dict, r: dict) -> bool:
    """Attack a is on scanned city r: city id when the attack has one, else the coordinate."""
    if a.get("targetId"):
        return a["targetId"] == r["city_id"]
    return a.get("targetX") == r["x"] and a.get("targetY") == r["y"]


def _avg_loot(rows: list[dict]) -> tuple[int, int, int]:
    n = len(rows)
    return tuple(round(sum(r.get(k, 0) for r in rows) / n)
                 for k in ("lootTib", "lootCrystal", "lootCredits"))


def build_layouts(records: list[dict], attacks: list[dict], claims: list[dict], player_id: int) -> list[dict]:
    """
    One row per scanned base (records = newest scan per city), with layout,
    metrics, loot, CP and attack status. attacks = the world's attack records
    (won and lost) of the scope, claims = its active WatchList claims.
    """
    won = [a for a in attacks if a.get("won", True)]
    by_level: dict[tuple[str, int], list[dict]] = {}
    for a in won:
        by_level.setdefault((a.get("targetType"), round(a.get("targetLevel", 0))), []).append(a)
    claims_at: dict[tuple[int, int], list[str]] = {}
    for c in claims:
        claims_at.setdefault((c["targetX"], c["targetY"]), []).append(c["playerName"])

    out = []
    for r in records:
        btype = base_type(r)
        grid = decode_tiles(r.get("tiles", ""))
        if btype is None or grid is None:
            continue
        level = r.get("level_base", 0)
        scanned = r.get("timestamp", 0)
        hits = [a for a in attacks if _on_target(a, r)]
        won_hits = [a for a in hits if a.get("won", True)]
        estimated = False
        loot = (None, None, None)
        if won_hits:
            loot = _avg_loot(won_hits)
        elif btype != "player" and by_level.get((btype, round(level))):
            loot, estimated = _avg_loot(by_level[(btype, round(level))]), True
        mine = [a for a in hits if a.get("playerId") == player_id and a.get("cpCost") is not None]
        cp = max(mine, key=lambda a: a["timestamp"])["cpCost"] if mine else None

        after_scan = [a for a in hits if a.get("timestamp", 0) >= scanned]
        claimed_by = claims_at.get((r["x"], r["y"]), [])
        if any(is_destroyed(a) for a in after_scan):
            status = "destroyed"
        elif claimed_by:
            status = "claimed"
        elif after_scan:
            status = "attacked"
        else:
            status = "free"
        last = max(after_scan, key=lambda a: a["timestamp"]) if after_scan else None

        out.append({
            "cityId": r["city_id"],
            "worldId": r["world_id"],
            "name": r.get("name", ""),
            "owner": r.get("owner", ""),
            "alliance": r.get("alliance", ""),
            "faction": r.get("faction"),
            "type": btype,
            "x": r["x"],
            "y": r["y"],
            "level": level,
            "levelOff": r.get("level_off", 0),
            "levelDef": r.get("level_def", 0),
            "layout": ["".join(str(v) for v in row) for row in grid],
            **layout_metrics(grid, decode_units(r.get("buildings", ""))),
            "lootTib": loot[0],
            "lootCrystal": loot[1],
            "lootCredits": loot[2],
            "lootEstimated": estimated,
            "cp": cp,
            "status": status,
            "claimedBy": claimed_by,
            "lastAttack": {"playerName": last.get("playerName"), "timestamp": last["timestamp"]} if last else None,
            "scannedBy": r.get("scanned_by", ""),
            "scannedAt": scanned,
        })
    out.sort(key=lambda b: (TYPE_ORDER.index(b["type"]), -b["level"]))
    return out

