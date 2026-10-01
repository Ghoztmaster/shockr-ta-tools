#!/usr/bin/env python3
"""
Generate and manage alliance API keys.

Usage:
    python -m server.keygen add <alliance_name>
    python -m server.keygen list
    python -m server.keygen remove <alliance_name>
"""
import json
import secrets
import sys
from pathlib import Path

import bcrypt

KEYS_FILE = Path("/app/config/keys.json")

# Allow override for local development
if not KEYS_FILE.parent.exists():
    KEYS_FILE = Path(__file__).parent.parent / "config" / "keys.json"


def load_keys() -> dict:
    if KEYS_FILE.exists():
        with open(KEYS_FILE) as f:
            return json.load(f)
    return {}


def save_keys(keys: dict):
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(KEYS_FILE, "w") as f:
        json.dump(keys, f, indent=2)


def add_key(alliance_name: str):
    keys = load_keys()
    if alliance_name in keys:
        print(f"Alliance '{alliance_name}' already has a key. Remove it first.")
        sys.exit(1)

    raw_key = secrets.token_hex(16)
    hashed = bcrypt.hashpw(raw_key.encode(), bcrypt.gensalt()).decode()
    keys[alliance_name] = hashed
    save_keys(keys)

    print(f"Alliance: {alliance_name}")
    print(f"API Key:  {raw_key}")
    print()
    print("Give this key to alliance members for their script config:")
    print(f"  /st config set api.key {raw_key}")
    print()
    print("This key is shown ONCE. It is stored as a bcrypt hash.")


def list_keys():
    keys = load_keys()
    if not keys:
        print("No keys configured.")
        return
    print("Configured alliances:")
    for name in sorted(keys):
        print(f"  - {name}")


def remove_key(alliance_name: str):
    keys = load_keys()
    if alliance_name not in keys:
        print(f"Alliance '{alliance_name}' not found.")
        sys.exit(1)
    del keys[alliance_name]
    save_keys(keys)
    print(f"Key for '{alliance_name}' removed.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "add" and len(sys.argv) == 3:
        add_key(sys.argv[2])
    elif cmd == "list":
        list_keys()
    elif cmd == "remove" and len(sys.argv) == 3:
        remove_key(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
