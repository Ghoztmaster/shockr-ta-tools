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

# Should return 401 without a website session (see §8; was Basic Auth)
curl https://packetlab.nl/shockr/api/bases
curl https://packetlab.nl/shockr/api/targets
# Should redirect to login (303) without a website session
curl -i https://packetlab.nl/shockr/targets

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

## 8. Website login via persoonlijke API key (vervangt Basic Auth op /shockr/)

De website (`/shockr/`, `/shockr/targets`) en de viewer-API (`/api/bases`, `/api/base/{id}`, `/api/targets`) checken nu zelf een sessie-cookie (`shockr_session`), verkregen via `/shockr/login` met speler-naam + de key uit `/st register`. Nginx hoeft daar dus geen Basic Auth meer te doen; alleen de admin-endpoints houden Basic Auth.

**Volgorde: eerst `git pull && docker compose up -d --build`, dan pas nginx aanpassen** — anders staat de site even zonder enige auth open.

### Verwijderen
- `auth_basic` / `auth_basic_user_file` op `location /shockr/` (website)
- `auth_basic` / `auth_basic_user_file` op het viewer-API-blok (`location /shockr/api/` of losse blokken voor `/shockr/api/bases`, `/shockr/api/targets`) — anders krijgt de browser bij elke fetch alsnog een wachtwoord-popup

### Behouden / expliciet maken: admin op Basic Auth
De app controleert de admin-endpoints NIET zelf. Zodra de Basic Auth van het brede `/shockr/api/`-blok weg is, moeten ze een eigen blok hebben:

```nginx
    # Shockr Alliance — admin (Basic Auth blijft)
    location = /shockr/api/members {
        auth_basic "Shockr admin";
        auth_basic_user_file /etc/nginx/.htpasswd-shockr;   # bestaand bestand
        proxy_pass http://127.0.0.1:8920/api/members;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location ~ ^/shockr/api/enroll/[0-9]+$ {
        auth_basic "Shockr admin";
        auth_basic_user_file /etc/nginx/.htpasswd-shockr;
        rewrite ^/shockr(/.*)$ $1 break;
        proxy_pass http://127.0.0.1:8920;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
```

`location = /shockr/api/enroll` (publiek, POST enrollment), `/shockr/api/scan` en `/shockr/api/target-watch` blijven precies zoals ze zijn (CORS ongewijzigd).

### Website-blok (zonder Basic Auth)

```nginx
    # Shockr Alliance — website + viewer-API + login (sessie-cookie in de app)
    location /shockr/ {
        proxy_pass http://127.0.0.1:8920/;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /shockr;    # cookie-pad /shockr/ i.p.v. het hele domein
    }
    location = /shockr { return 301 /shockr/; }
```

`/shockr/login`, `/shockr/api/login`, `/shockr/api/logout`, `/shockr/api/me` en `/shockr/static/session.js` vallen hier gewoon onder; een aparte publieke `location = /shockr/login` / `location /shockr/static/` is alleen nodig als `/shockr/` zelf toch achter Basic Auth blijft (dan zou de login onbereikbaar zijn). Zonder `X-Forwarded-Proto: https` krijgt de cookie geen `Secure`-vlag.

```bash
nginx -t && systemctl reload nginx
```

### Verifiëren

```bash
# Zonder cookie -> 303 naar login
curl -si https://packetlab.nl/shockr/ | grep -i '^location'          # location: login
curl -s -o /dev/null -w '%{http_code}\n' https://packetlab.nl/shockr/api/bases   # 401

# Login (verkeerde key -> 401 {"error":"Onbekende speler of ongeldige key"})
curl -si -c /tmp/shockr.jar https://packetlab.nl/shockr/api/login \
  -H 'Content-Type: application/json' -d '{"playerName":"GhoztMasters","apiKey":"<key>"}'
curl -s -b /tmp/shockr.jar https://packetlab.nl/shockr/api/me        # {"playerName":"GhoztMasters",...}

# Uitloggen -> 303 naar ../login, cookie gewist
curl -si -b /tmp/shockr.jar -X POST https://packetlab.nl/shockr/api/logout | grep -i '^location\|^set-cookie'

# Admin blijft Basic Auth (zonder -u: 401 van nginx, MET sessie-cookie ook 401)
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/shockr.jar https://packetlab.nl/shockr/api/members   # 401
curl -u ghozt https://packetlab.nl/shockr/api/members

# Scan/target-watch blijven op X-Player-Key (zonder key: 403, niet 401)
curl -s -o /dev/null -w '%{http_code}\n' https://packetlab.nl/shockr/api/target-watch/477   # 403
```

Sessies staan in het geheugen: na `docker compose up -d --build` moet iedereen opnieuw inloggen. Een speler die de alliance verlaat: `DELETE /shockr/api/enroll/{id}` — zijn website-sessie vervalt direct.

## Update

```bash
cd /opt/shockr-alliance
git pull
docker compose up -d --build
```
