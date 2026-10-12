# CLAUDE.md

## Release-regel (staande regel, niet apart vragen)
Bij elke `@version`-bump (`build.js` VERSION, ook in `package.json` en `ST_VERSION` in `lib/main.js`) hoort ook `config/version.json`:
- top-level `version` en `date` bijwerken;
- een nieuw item bovenaan `changelog` met `version`, `date` en `changes` in `en`/`de`/`nl` (korte regels);
- maximaal 5 versies in het bestand - de oudste valt eraf.

Commits doet Wilco zelf.
