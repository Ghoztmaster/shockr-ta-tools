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

## Update

```bash
cd /opt/shockr-alliance
git pull
docker compose up -d --build
```
