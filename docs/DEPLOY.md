# Deployment — Shockr Alliance Server

## Prerequisites
- VPS with Docker + Docker Compose
- Caddy as reverse proxy (TLS)
- Git access to the repo

## 1. Clone to VPS

```bash
cd /opt
git clone git@github-ghozt:Ghoztmaster/shockr-ta-tools.git shockr-alliance
cd shockr-alliance
```

## 2. Generate API key

```bash
# Install bcrypt locally first
pip install bcrypt --break-system-packages

python -m server.keygen add "SoO"
# Output: the raw API key (give to alliance members)
# Stored as bcrypt hash in config/keys.json
```

## 3. Build and start

```bash
docker compose up -d --build
```

## 4. Test

```bash
# Health check
curl http://localhost:8920/api/health

# Test scan (replace KEY with the raw key from step 2)
curl -X POST http://localhost:8920/api/scan \
  -H "Content-Type: application/json" \
  -H "X-Alliance-Key: KEY" \
  -d '{"city_id":1,"world_id":477,"x":100,"y":200,"name":"Test","owner":"Ghozt","owner_id":1,"faction":1,"level_base":10,"level_off":8,"level_def":9,"tiles":"abc","scanned_by":"Ghozt","version":1,"timestamp":'$(date +%s000)'}'
```

## 5. Caddy config

Add to the `packetlab.nl` block in the Caddyfile:

```
    # Shockr Alliance — scan endpoint (API key auth in app)
    handle /shockr/api/scan {
        uri strip_prefix /shockr
        reverse_proxy localhost:8920
    }

    # Shockr Alliance — Target Watcher (API key auth in app; called by the
    # userscript, so it must NOT sit behind Basic Auth)
    handle /shockr/api/target-watch* {
        uri strip_prefix /shockr
        reverse_proxy localhost:8920
    }

    # Shockr Alliance — health check (no auth)
    handle /shockr/api/health {
        uri strip_prefix /shockr
        reverse_proxy localhost:8920
    }

    # Shockr Alliance — viewer endpoints (Basic Auth)
    handle /shockr/api/* {
        basic_auth {
            # Generate: caddy hash-password
            # ghozt <hash>
        }
        uri strip_prefix /shockr
        reverse_proxy localhost:8920
    }

    # Shockr Alliance — website (fase 3, Basic Auth)
    handle /shockr/* {
        basic_auth {
            # same credentials
        }
        uri strip_prefix /shockr
        reverse_proxy localhost:8920
    }
```

Reload Caddy:
```bash
systemctl reload caddy
```

## 6. Verify end-to-end

```bash
# Should return {"status":"ok","keys_loaded":1}
curl https://packetlab.nl/shockr/api/health

# Should return 403 without key
curl -X POST https://packetlab.nl/shockr/api/scan

# Should return 401 without Basic Auth
curl https://packetlab.nl/shockr/api/bases
curl https://packetlab.nl/shockr/api/targets
curl https://packetlab.nl/shockr/targets

# Should return 403 with a wrong key (not 401 — Target Watcher bypasses Basic Auth)
curl -H "X-Alliance-Key: wrong" https://packetlab.nl/shockr/api/target-watch/477/1
```

## 7. Per-player keys (enrollment, v5.6.0)

### Enrollment code

Create `config/enrollment.json` on the VPS (not in git — `.gitignore`d):

```bash
nano /opt/shockr-alliance/config/enrollment.json
```

```json
{
  "code": "CHANGE-ME",
  "allianceIds": [100],
  "scope": "SoO",
  "allianceKeyUntil": "2026-11-01"
}
```

| Field | Meaning |
|-------|---------|
| `code` | Enrollment code — share it only in the alliance chat |
| `allianceIds` | In-game alliance ids allowed to enroll |
| `scope` | Optional. Storage scope for player-key requests — use the alliance name from `config/keys.json` so they share data with shared-key users. Default: that name if `keys.json` has exactly one alliance |
| `allianceKeyUntil` | Optional. Last day (UTC) the shared `X-Alliance-Key` is accepted. Leave out during the transition; set a past date to switch the shared key off |

The server re-reads the file on the next request after it changes — no restart. To rotate the code, edit `code` and post the new one in the alliance chat (existing personal keys stay valid).

### Proxy: enroll endpoint

`POST /shockr/api/enroll` must be public (no Basic Auth — the code is the auth) and needs the same CORS handling as `/shockr/api/scan`. Admin endpoints `/shockr/api/enroll/{playerId}` and `/shockr/api/members` must stay behind Basic Auth, so use an **exact** match. nginx:

```nginx
    # Shockr Alliance — enrollment (public; code checked in the app, 5 attempts/IP/hour)
    location = /shockr/api/enroll {
        # same CORS block as /shockr/api/scan, with:
        #   Access-Control-Allow-Methods: POST, OPTIONS
        #   Access-Control-Allow-Headers: Content-Type
        proxy_pass http://127.0.0.1:8920/api/enroll;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
```

Also add `X-Player-Key` to `Access-Control-Allow-Headers` in the `/shockr/api/scan` and `/shockr/api/target-watch` blocks (next to `X-Alliance-Key`, `X-Player-Id`, `X-Player-Name`, `X-Alliance-Id`). Caddy equivalent: `handle /shockr/api/enroll { uri strip_prefix /shockr; reverse_proxy localhost:8920 }` before the Basic Auth `/shockr/api/*` block.

```bash
nginx -t && systemctl reload nginx
```

### Admin

```bash
# Registered players (the API returns no keys or hashes)
curl -u ghozt https://packetlab.nl/shockr/api/members
cat data/player_keys.jsonl

# Revoke a player's key (no restart needed)
curl -u ghozt -X DELETE https://packetlab.nl/shockr/api/enroll/164

# Test enrollment (wrong code → 403 "Invalid enrollment code")
curl -X POST https://packetlab.nl/shockr/api/enroll -H "Content-Type: application/json" \
  -d '{"playerId":1,"playerName":"Test","allianceId":100,"worldId":477,"enrollmentCode":"wrong"}'
```

`/api/health` shows `player_keys` (number of registered players).

## Update

```bash
cd /opt/shockr-alliance
git pull
docker compose up -d --build
```
