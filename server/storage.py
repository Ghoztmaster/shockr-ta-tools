"""
JSONL storage with deduplication and retention.

Structure: data/alliance/{alliance_id}/{world_id}.jsonl
"""
import gzip
import json
import time
import logging
from datetime import datetime, timezone
from pathlib import Path

from server.models import ScanPayload

log = logging.getLogger("shockr-alliance")


class ScanStorage:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.alliance_dir = data_dir / "alliance"
        self.archive_dir = data_dir / "archive"
        self.alliance_dir.mkdir(parents=True, exist_ok=True)
        self.archive_dir.mkdir(parents=True, exist_ok=True)

    def _get_file(self, alliance_id: str, world_id: int) -> Path:
        safe_id = "".join(c for c in alliance_id if c.isalnum() or c in "-_")
        if not safe_id:
            safe_id = "unknown"
        dir_path = self.alliance_dir / safe_id
        dir_path.mkdir(parents=True, exist_ok=True)
        return dir_path / f"{world_id}.jsonl"

    def _is_duplicate(self, file_path: Path, city_id: int, version: int) -> bool:
        if not file_path.exists():
            return False
        try:
            with open(file_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                        if record.get("city_id") == city_id and record.get("version") == version:
                            return True
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass
        return False

    def store(self, alliance_id: str, scan: ScanPayload) -> bool:
        file_path = self._get_file(alliance_id, scan.world_id)
        if self._is_duplicate(file_path, scan.city_id, scan.version):
            return False

        record = scan.model_dump()
        record["alliance_key_id"] = alliance_id
        record["stored_at"] = datetime.now(timezone.utc).isoformat()

        with open(file_path, "a") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
        return True

    def list_bases(
        self,
        world_id: int | None = None,
        min_level: float | None = None,
        max_age_hours: int = 168,
    ) -> list[dict]:
        cutoff_ms = int((time.time() - max_age_hours * 3600) * 1000)
        latest: dict[tuple[int, int], dict] = {}

        for alliance_dir in self.alliance_dir.iterdir():
            if not alliance_dir.is_dir():
                continue
            for jsonl_file in alliance_dir.glob("*.jsonl"):
                file_world_id = int(jsonl_file.stem)
                if world_id is not None and file_world_id != world_id:
                    continue
                try:
                    with open(jsonl_file) as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                record = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if record.get("timestamp", 0) < cutoff_ms:
                                continue
                            if min_level is not None and record.get("level_base", 0) < min_level:
                                continue
                            key = (record["city_id"], record["world_id"])
                            existing = latest.get(key)
                            if existing is None or record.get("version", 0) > existing.get("version", 0):
                                latest[key] = record
                except Exception as e:
                    log.warning("Error reading %s: %s", jsonl_file, e)

        result = []
        for record in latest.values():
            result.append({
                "city_id": record["city_id"],
                "world_id": record["world_id"],
                "x": record["x"],
                "y": record["y"],
                "name": record["name"],
                "owner": record["owner"],
                "alliance": record.get("alliance", ""),
                "faction": record["faction"],
                "level_base": record["level_base"],
                "level_off": record["level_off"],
                "level_def": record["level_def"],
                "scanned_by": record.get("scanned_by", ""),
                "scanned_at": record.get("stored_at", ""),
                "version": record["version"],
            })
        result.sort(key=lambda r: r["scanned_at"], reverse=True)
        return result

    def get_base(self, city_id: int, world_id: int | None = None) -> dict | None:
        scans = []
        for alliance_dir in self.alliance_dir.iterdir():
            if not alliance_dir.is_dir():
                continue
            for jsonl_file in alliance_dir.glob("*.jsonl"):
                file_world_id = int(jsonl_file.stem)
                if world_id is not None and file_world_id != world_id:
                    continue
                try:
                    with open(jsonl_file) as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                record = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if record.get("city_id") == city_id:
                                scans.append(record)
                except Exception:
                    continue

        if not scans:
            return None

        scans.sort(key=lambda r: r.get("version", 0), reverse=True)
        latest = scans[0]
        return {
            "city_id": city_id,
            "world_id": latest["world_id"],
            "x": latest["x"],
            "y": latest["y"],
            "name": latest["name"],
            "owner": latest["owner"],
            "alliance": latest.get("alliance", ""),
            "faction": latest["faction"],
            "level_base": latest["level_base"],
            "level_off": latest["level_off"],
            "level_def": latest["level_def"],
            "tiles": latest["tiles"],
            "buildings": latest.get("buildings", ""),
            "defense_units": latest.get("defense_units", ""),
            "offense_units": latest.get("offense_units", ""),
            "upgrades": latest.get("upgrades", {}),
            "scanned_by": latest.get("scanned_by", ""),
            "scanned_at": latest.get("stored_at", ""),
            "version": latest["version"],
            "scan_count": len(scans),
            "history": [
                {"version": s["version"], "scanned_by": s.get("scanned_by", ""), "scanned_at": s.get("stored_at", "")}
                for s in scans[:20]
            ],
        }

    def archive_old(self, max_age_days: int = 7):
        cutoff_ms = int((time.time() - max_age_days * 86400) * 1000)
        for alliance_dir in self.alliance_dir.iterdir():
            if not alliance_dir.is_dir():
                continue
            for jsonl_file in alliance_dir.glob("*.jsonl"):
                active, archive = [], []
                try:
                    with open(jsonl_file) as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                record = json.loads(line)
                                (archive if record.get("timestamp", 0) < cutoff_ms else active).append(line)
                            except json.JSONDecodeError:
                                continue
                except Exception:
                    continue
                if not archive:
                    continue
                arch_path = self.archive_dir / alliance_dir.name
                arch_path.mkdir(parents=True, exist_ok=True)
                with gzip.open(arch_path / f"{jsonl_file.stem}_{int(time.time())}.jsonl.gz", "wt") as f:
                    for line in archive:
                        f.write(line + "\n")
                with open(jsonl_file, "w") as f:
                    for line in active:
                        f.write(line + "\n")
                log.info("Archived %d records from %s, %d active", len(archive), jsonl_file, len(active))
