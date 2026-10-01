# Security Design — Shockr Alliance Server

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized scan submission | API key per alliance, bcrypt hashed, checked on every POST |
| Unauthorized data access | Basic Auth on all GET endpoints (Caddy) |
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

### POST /shockr/api/scan — API Key
- Header: `X-Alliance-Key: <key>`
- Keys in `config/keys.json` as `{ "alliance_name": "bcrypt_hash" }`
- Each key scoped to one alliance
- Generated via `python -m server.keygen add "SoO"`

### GET /shockr/api/* — Basic Auth
- Caddy handles auth at the reverse proxy level
- Backend never sees passwords

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
Internet → Caddy (TLS + Basic Auth) → localhost:8920 → shockr-alliance container
```

Own bridge network `shockr-net`, not connected to any other stack.
