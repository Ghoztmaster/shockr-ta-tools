# CLAUDE.md

## Release-regel (staande regel, niet apart vragen)
Bij elke `@version`-bump (`build.js` VERSION, ook in `package.json` en `ST_VERSION` in `lib/main.js`) hoort ook `config/version.json`:
- top-level `version` en `date` bijwerken;
- een nieuw item bovenaan `changelog` met `version`, `date` en `changes` in `en`/`de`/`nl` (korte regels);
- maximaal 5 versies in het bestand - de oudste valt eraf.

En ook `config/announcements.json` bijwerken: de aankondiging noemt de huidige versie en de nieuwste features (`message` in `en`/`de`/`nl`). De aankondiging op de info-pagina en de banner op alle pagina's tonen altijd de laatst uitgebrachte versie, nooit een oudere.

Commits doet Wilco zelf.

## Deploy-regel (staande regel)
De repo is de single source of truth. Config-bestanden (`config/version.json`, `config/announcements.json`, `config/roadmap.json`) worden ALLEEN in de repo bewerkt, nooit op de VPS. Elke release - ook userscript-only zonder server-wijzigingen - wordt op de VPS gedeployd met:

```bash
git pull && docker compose build --no-cache && docker compose up -d
```

Dus nooit "geen VPS-update nodig" melden: elke release noemt deze deploy-stap.
