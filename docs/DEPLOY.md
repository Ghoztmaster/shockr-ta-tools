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

## 9. Attack Tracker (`/api/attack`, `/attacks`)

`POST /shockr/api/attack` is called from the game page (cross-origin) with `X-Player-Key`, so it needs a CORS block like `/shockr/api/scan`. Put it **before** the broad `/shockr/` block:

```nginx
    # Shockr Alliance — attack tracker (userscript POST, X-Player-Key checked in the app)
    location = /shockr/api/attack {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;
            add_header Access-Control-Max-Age 86400;
            return 204;
        }
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;

        proxy_pass http://127.0.0.1:8920/api/attack;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

**Exact match (`location =`)**, not a prefix: `location /shockr/api/attack` would also catch `GET /shockr/api/attacks` (the dashboard data). That still reaches the app, but without the `X-Forwarded-Prefix` of the website block and with CORS headers it doesn't need. With `=` the dashboard API and the page `/shockr/attacks` stay under the existing `/shockr/` website block (session cookie) — no extra nginx config for them.

```bash
nginx -t && systemctl reload nginx

# CORS preflight -> 204 with the allow headers
curl -si -X OPTIONS https://packetlab.nl/shockr/api/attack -H 'Origin: https://www.alliances.commandandconquer.com' | head -5
# Without a key -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://packetlab.nl/shockr/api/attack -H 'Content-Type: application/json' -d '{}'
# Dashboard data without a session -> 401
curl -s -o /dev/null -w '%{http_code}\n' https://packetlab.nl/shockr/api/attacks
```

Storage: `data/attacks/{worldId}.jsonl` (same `./data` volume). Records older than 7 days are removed at container start.

## 10. WatchList (`/api/watchlist`, `/watchlist`)

`POST /shockr/api/watchlist` is called from the game page (cross-origin) with `X-Player-Key` — claim, unclaim and the claims list all go through this one POST. CORS block, **before** the broad `/shockr/` block:

```nginx
    # Shockr Alliance — watchlist (userscript POST, X-Player-Key)
    location = /shockr/api/watchlist {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;
            add_header Access-Control-Max-Age 86400;
            return 204;
        }
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;

        proxy_pass http://127.0.0.1:8920/api/watchlist;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

The website's own calls (`GET /shockr/api/watchlist?worldId=` and `DELETE /shockr/api/watchlist/{id}`, session cookie) go through the exact-match block resp. the broad `/shockr/` block — no extra config. The GET has no CORS need (same origin); the extra CORS headers the exact block adds are harmless.

**Admin delete** (`DELETE /shockr/api/admin/watchlist/{id}`, any player's claim): the app checks the website session but NOT the admin role — that is nginx's Basic Auth, like `/api/members`. Without this block every logged-in member can delete any claim (never an outsider):

```nginx
    # Shockr Alliance — admin: delete any watchlist claim (Basic Auth)
    location ~ ^/shockr/api/admin/ {
        auth_basic "Shockr admin";
        auth_basic_user_file /etc/nginx/.htpasswd-shockr;
        rewrite ^/shockr(/.*)$ $1 break;
        proxy_pass http://127.0.0.1:8920;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

On the page, the "Admin" checkbox shows ✕ on every claim; the browser asks for the admin password on the first admin delete.

```bash
nginx -t && systemctl reload nginx

# CORS preflight -> 204
curl -si -X OPTIONS https://packetlab.nl/shockr/api/watchlist -H 'Origin: https://www.alliances.commandandconquer.com' | head -5
# Without a key -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://packetlab.nl/shockr/api/watchlist -H 'Content-Type: application/json' -d '{"action":"list","worldId":477}'
# Website data without a session -> 401; admin path without Basic Auth -> 401 (nginx)
curl -s -o /dev/null -w '%{http_code}\n' https://packetlab.nl/shockr/api/watchlist
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE https://packetlab.nl/shockr/api/admin/watchlist/x
```

Storage: `data/watchlist/{worldId}.json` (same `./data` volume). Claims older than 24 h are dropped on the next access.

## 11. Alliance attacks for Map Labels (`/api/attacks/alliance`, v5.17.0)

`GET /shockr/api/attacks/alliance?worldId=` is called from the game page (cross-origin) with `X-Player-Key`: the won attacks of the caller's own alliance over the last 24 h (player name, target, time - **no loot**). CORS block, **before** the broad `/shockr/` block:

```nginx
    # Shockr Alliance — alliance attacks for Map Labels (userscript GET, X-Player-Key checked in the app)
    location = /shockr/api/attacks/alliance {
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;
            add_header Access-Control-Max-Age 86400;
            return 204;
        }
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Headers "Content-Type, X-Alliance-Key, X-Player-Id, X-Player-Name, X-Alliance-Id, X-Player-Key" always;

        proxy_pass http://127.0.0.1:8920/api/attacks/alliance;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

`proxy_pass` with a URI path keeps the query string (`?worldId=477`). `/shockr/api/attacks` (website data) and `/shockr/api/attacks/targets` (loot) stay under the `/shockr/` website block.

```bash
nginx -t && systemctl reload nginx

curl -si -X OPTIONS https://packetlab.nl/shockr/api/attacks/alliance -H 'Origin: https://www.alliances.commandandconquer.com' | head -5   # 204
curl -s -o /dev/null -w '%{http_code}\n' 'https://packetlab.nl/shockr/api/attacks/alliance?worldId=477'                              # 403
curl -s 'https://packetlab.nl/shockr/api/attacks/alliance?worldId=477'   -H 'X-Player-Key: <key>' -H 'X-Player-Id: <id>' -H 'X-Player-Name: <name>' -H 'X-Alliance-Id: <alliance id>'
```

Note: the membership check needs the identity headers too (`X-Player-Id`, `X-Player-Name`, `X-Alliance-Id`) - a curl with only `X-Player-Key` gets 403, just like `/api/watchlist`.

## 12. Auto-revoke of keys (v5.17.0)

No nginx change: the member list rides along on `POST /api/scan` (`allianceMembers`, first scan batch after login, then hourly). At most once per hour per alliance the server compares the lists with the registered keys; a key holder that **at least 3 different scanners** no longer see is revoked (`INFO Key revoked: name (id) — no longer in alliance`), fewer scanners only log `WARNING name not in alliance list (reported by 1/3 required scanners)`. The lists live in memory: after a restart it takes up to an hour (and three scanners) again. A revoked player registers again with `/st register`; lists from before the new key don't count against it.

```bash
docker compose logs -f | grep -E 'Key revoked|not in alliance list'
```

## 13. Key restore + in-game update notice (v5.25.0)

Two new calls come from the GAME PAGE (cross-origin), and neither has - nor needs - an nginx CORS block:

- `POST /shockr/api/enroll/restore` (`/st register` → "I still have my key"): `{playerId, key}`, checked against the stored bcrypt hash; 200 `{"status":"ok"}` and nothing changes, else always 403 `Key not valid` (unknown player, revoked or wrong key - no enumeration). Own rate limit: **5 attempts per IP per hour**, right key included (`restore_limiter`).
- `GET /shockr/api/version` (already public, used by the website footer): the userscript reads it after loading and shows one chat line when the `version` in `config/version.json` is semver-higher than the running script.

**No nginx change.** Both paths fall under the plain `location /shockr/` website block (the `=`/regex blocks for `/api/enroll` and `/api/enroll/[0-9]+` don't match them), so they reach the app without Basic Auth - and the app sets the CORS headers itself (`game_cors_headers()` in `server/main.py`): `Access-Control-Allow-Origin` echoed only for `https://*.alliances.commandandconquer.com`, also on the 403/429 answers (without it the userscript only sees a network error), plus an `OPTIONS /api/enroll/restore` preflight (204). **Do not add an nginx CORS block for these two paths**: a second `Access-Control-Allow-Origin` header makes the browser refuse the response. The `X-Forwarded-For` the website block already sets is what the rate limiter keys on.

```bash
# Preflight -> 204 with the allow headers (origin must be a game host)
curl -si -X OPTIONS https://packetlab.nl/shockr/api/enroll/restore \
  -H 'Origin: https://prodgame40.alliances.commandandconquer.com' -H 'Access-Control-Request-Method: POST' | head -6
# Wrong key -> 403 {"detail":"Key not valid"}, WITH access-control-allow-origin
curl -si -X POST https://packetlab.nl/shockr/api/enroll/restore -H 'Content-Type: application/json' \
  -H 'Origin: https://prodgame40.alliances.commandandconquer.com' -d '{"playerId":1,"key":"wrong"}' | head -8
# 6th attempt within the hour -> 429
# Version for the game page -> 200 with access-control-allow-origin; without Origin header no CORS header
curl -si https://packetlab.nl/shockr/api/version -H 'Origin: https://prodgame40.alliances.commandandconquer.com' | grep -i 'access-control\|"version"'
```

Logs: `Key restored: name (id)` on success, `Key restore refused from <ip>: player <id>` on a miss, `Key restore rate limit hit from <ip>` at the limit.

## 14. War Tracker (`/war`, `/api/attacks/summary`, v5.33.0)

**No nginx change.** The game page keeps posting to `POST /shockr/api/attack` (existing exact-match CORS block, section 9); the extra fields ride in the same JSON body, no new headers. The page `/shockr/war` and `GET /shockr/api/attacks/summary` are website calls (session cookie) under the broad `/shockr/` block.

Access: alliance role CIC / Second Commander / Officer (sent by the userscript at `/st register` and with every attack), or the whitelist - a file edited by hand on the VPS, picked up on the next request (no restart):

```bash
# inside the data volume: data/alliance/war-whitelist.json
echo '{"playerIds": [123456]}' > data/alliance/war-whitelist.json
```

A player who registered before 5.33.0 has no role on the server until their first attack with 5.33.0 (or a new `/st register`); until then only the whitelist gives access. Logs: `Alliance role of name (id): - -> officer`, `War whitelist loaded: N player(s)`.

Retention of `data/attacks/*.jsonl` is now 30 days (pruned at startup).

```bash
curl -si https://packetlab.nl/shockr/war | grep -i '^location'                        # no session -> location: login
curl -s -b /tmp/shockr.jar https://packetlab.nl/shockr/api/me                          # ... "warAccess": true|false
curl -s -b /tmp/shockr.jar 'https://packetlab.nl/shockr/api/attacks/summary?days=7' | head -c 400   # 403 without access
```

## Update

```bash
cd /opt/shockr-alliance
git pull
docker compose up -d --build
```

## Info-pagina: versie, aankondigingen, roadmap (`config/*.json`)

`/info` (achter de sessie-login) en de versie-footer op elke pagina lezen drie bestanden in `config/`:
`version.json`, `announcements.json` en `roadmap.json`. De server herleest een bestand zodra het verandert
(mtime) - **geen restart nodig**. Een ontbrekend of kapot bestand geeft een lege sectie, geen fout.

- Actieve aankondigingen staan ook als banner onder de kop van Bases, Target Watch en Attacks
  (`/api/announcements`, achter de sessie).
- Changelog-items zijn per taal: `"changes": {"en": [...], "de": [...], "nl": [...]}`. Ontbreekt een taal,
  dan toont de pagina de Engelse tekst; een oude platte lijst wordt in elke taal getoond.

```bash
nano /opt/shockr-alliance/config/announcements.json   # "active": false verbergt zonder te verwijderen
curl -s https://packetlab.nl/shockr/api/version        # publiek: alleen versie + datum + changelog
```

Deze drie bestanden staan **wel** in git (in tegenstelling tot `keys.json`/`enrollment.json`). Bewerk je ze
op de VPS, commit dan dezelfde wijziging in de repo - anders botst de volgende `git pull` met de lokale
wijziging.
