# Contributing to Shockr TA Tools

Thanks for your interest! This project is maintained by Ghozt [SoO] and welcomes contributions.

## Reporting Issues

- Use [GitHub Issues](https://github.com/Ghoztmaster/shockr-ta-tools/issues)
- Include: game client version, browser, what happened vs what you expected
- If a patch broke: include the error from the browser console (F12)

## Client Updates

The game client updates regularly and obfuscated property names shift. If the script breaks:

1. Open F12 → Console, look for `[ST] Patch failed: ...` messages
2. Report the failed fingerprint in an issue
3. If you can identify the new obfuscated name, submit a PR with the updated pattern in `lib/clientlib-patch.js`

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b fix/camp-tracker-offset`)
3. Test in-game with Tampermonkey
4. Commit with a clear message
5. Open a PR against `main`

## Build

```bash
npm install
node build.js
```

Output: `dist/shockr-ta-tools.user.js` — install in Tampermonkey.

## Code Style

- Vanilla JS, no frameworks
- ES modules (`import`/`export`), bundled by esbuild
- ClientLib access via fingerprint-based patching, never hardcoded property names
- Chat feedback via `chatMessage('[ST] ...')` for user-visible events
- Console logging via `console.log('[ST] ...')` for debug

## Alliance Server

The `server/` directory contains the alliance scanner backend (FastAPI). It runs as a separate Docker stack. See `docs/DEPLOY.md` for setup.

## License

MIT — see [LICENSE](LICENSE).
