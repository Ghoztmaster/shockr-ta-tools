# Security Design — Shockr Alliance Server

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized scan submission | API key per alliance, bcrypt hashed, checked on every POST |
| Unauthorized data access | Website + viewer API: session cookie from a login with the personal API key; admin endpoints: Basic Auth (reverse proxy) |
| Malformed/oversized payloads | Pydantic validation, 64 KB max payload, field limits |
| Scan data injection | Strict type validation, no eval, no SQL |
| Brute force | Rate limiting (10/s POST, 30/s GET per IP) |
| API key leakage | Keys bcrypt hashed in config, never logged, never in responses |
| Data leakage between alliances | All queries scoped by alliance_id derived from API key |
| Replay attacks | Timestamp validation: scans older than 1 hour rejected |
| Container escape | Non-root user, read-only filesystem, no-new-privileges |
| Lateral movement | Own Docker network, no shared networks with other stacks |
| Log leakage | Keys masked, no player data in access logs |
| Path traversal | No user-controlled file paths, filenames from validated IDs only |

## Authentication

### POST /shockr/api/enroll — enrollment code
- Code + whitelisted in-game alliance ids in `config/enrollment.json` (server only, never in repo/script); constant-time comparison
- Rate limit 5 attempts per IP per hour
- Issues a per-player key (`secrets.token_hex(16)`), stored as bcrypt hash in `data/player_keys.jsonl`; plaintext returned once

### POST /shockr/api/scan, /shockr/api/target-watch — API Key
- Header: `X-Player-Key: <personal key>` — must belong to `X-Player-Id` and the enrolled alliance (checked against one bcrypt hash, then cached by SHA-256)
- Transition: `X-Alliance-Key: <key>` (shared) until `allianceKeyUntil` in `config/enrollment.json`
- Keys in `config/keys.json` as `{ "alliance_name": "bcrypt_hash" }`
- Each key scoped to one alliance
- Generated via `python -m server.keygen add "SoO"`

### Website (/shockr/, /shockr/targets, GET /shockr/api/bases|base/{id}|targets) — session cookie
- `POST /shockr/api/login {playerName, apiKey}`: the key is checked with the same `PlayerKeyStore.verify()` as `X-Player-Key` (no second key check, no password stored); one error message for unknown player and wrong key; rate limit 10 attempts per IP per minute
- Success: random token (`secrets.token_urlsafe(32)`), kept in memory server-side, cookie `shockr_session` (HttpOnly, Secure behind https, SameSite=Lax, Path = `X-Forwarded-Prefix`), 7-day TTL; a restart logs everyone out
- A session ends at once when the player's key is revoked or re-issued (the session is bound to the stored key hash)
- No session: pages redirect to `/shockr/login`, viewer API answers 401
- The session cookie does NOT authorize scan/target-watch (those stay on `X-Player-Key`) nor the admin endpoints

### GET /shockr/api/members, DELETE /shockr/api/enroll/{id} — Basic Auth
- Admin only, enforced at the reverse proxy; the app itself has no check on these — the proxy MUST keep them behind Basic Auth (see DEPLOY.md §8)

## Input Validation

All fields validated through Pydantic: type, range, max length, character set.
Base62-encoded fields (tiles, buildings, units) checked against `[0-9A-Za-z.\-]` pattern.
Upgrades dict limited to 50 entries, values 0-20.

## Container Hardening

```yaml
security_opt: [no-new-privileges:true]
read_only: true
tmpfs: [/tmp]
user: shockr (non-root)
ports: 127.0.0.1:8920 (localhost only)
```

## Network

```
Internet → nginx (TLS; Basic Auth on admin endpoints only) → localhost:8920 → shockr-alliance container
```

Own bridge network `shockr-net`, not connected to any other stack.
