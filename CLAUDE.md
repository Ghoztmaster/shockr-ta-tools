# CLAUDE.md

## Release-regel (staande regel, niet apart vragen)
Bij elke `@version`-bump (`build.js` VERSION, ook in `package.json` en `ST_VERSION` in `lib/main.js`) hoort ook `config/version.json`:
- top-level `version` en `date` bijwerken;
- een nieuw item bovenaan `changelog` met `version`, `date` en `changes` in `en`/`de`/`nl` (korte regels);
- maximaal 5 versies in het bestand - de oudste valt eraf.

En ook `config/announcements.json` bijwerken: de aankondiging noemt de huidige versie en de nieuwste features (`message` in `en`/`de`/`nl`). De aankondiging op de info-pagina en de banner op alle pagina's tonen altijd de laatst uitgebrachte versie, nooit een oudere.

Commits doet Wilco zelf.
