// Website texts in English, German and Dutch (login, base overview, target watch).
//
// - Language: localStorage 'shockr_lang'; without a stored choice the browser
//   language (de/nl), else English. Missing keys fall back to English, then the key.
// - Fixed HTML: data-i18n="key" (textContent), data-i18n-placeholder,
//   data-i18n-title. Text built in JS: T('key', {vars}).
// - Switcher: an element with id="langSwitch" gets three flag buttons; a switch
//   re-applies the fixed HTML and fires the 'shockr-lang' event so a page can
//   re-render what it built itself.
// Game terms (Camp/Outpost/Base, faction and unit names, Lv) stay as the game shows them.
(function () {
    const LANGS = ['en', 'de', 'nl'];
    // Inline SVG, not flag emoji: Windows has no flag glyphs and would show "GB DE NL"
    const FLAG_SVG = {
        en: '<svg viewBox="0 0 60 30" preserveAspectRatio="none"><clipPath id="lf-uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
            '<rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>' +
            '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#lf-uk-t)" stroke="#C8102E" stroke-width="4"/>' +
            '<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>',
        de: '<svg viewBox="0 0 5 3" preserveAspectRatio="none"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#D00"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg>',
        nl: '<svg viewBox="0 0 9 6" preserveAspectRatio="none"><rect width="9" height="2" fill="#AE1C28"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#21468B"/></svg>',
    };
    const NAMES = { en: 'English', de: 'Deutsch', nl: 'Nederlands' };
    const STORAGE_KEY = 'shockr_lang';

    const STRINGS = {
        en: {
            // Common
            loggedInAs: 'Logged in as:',
            logout: 'Log out',
            loading: 'Loading...',
            refresh: '↻ Refresh',
            error: 'Error: {msg}',
            justNow: 'just now',
            minutesAgo: '{n}m ago',
            hoursAgo: '{n}h ago',
            daysAgo: '{n}d ago',
            minAgo: '{n} min ago',
            world: 'World:',
            all: 'All',
            // Login
            loginPageTitle: 'Shockr — Log in',
            loginIntro: 'Log in with your player name and the API key you got in the game via /st register.',
            loginName: 'Player name',
            loginNamePlaceholder: 'Your in-game name',
            loginKey: 'API key',
            loginKeyPlaceholder: '32-character key from /st register',
            loginButton: 'Log in',
            loginFailed: 'Unknown player or invalid key',
            loginRateLimited: 'Too many login attempts — try again in a minute',
            loginUnreachable: 'Server not reachable',
            // Base overview
            basesPageTitle: 'Shockr Alliance Scanner',
            navTargetWatch: '🎯 Target Watch',
            filterType: 'Type:',
            filterMinLevel: 'Min Level:',
            filterAny: 'any',
            filterAge: 'Age:',
            age1h: '< 1 hour',
            age6h: '< 6 hours',
            age24h: '< 24 hours',
            age7d: '< 7 days',
            filterButton: '🔍 Filter',
            colName: 'Name',
            colOwner: 'Owner',
            colBase: 'Base',
            colOff: 'Off',
            colDef: 'Def',
            colFaction: 'Faction',
            colCoords: 'Coords',
            colScanner: 'Scanner',
            colScanned: 'Scanned',
            noBases: 'No bases found',
            basesStats: '{bases} bases | {worlds} world(s) | {scanners} scanner(s)',
            overviewTypes: 'Types:',
            overviewTypeCounts: '{camp} camps, {outpost} outposts, {base} bases',
            overviewOther: ', {n} other',
            overviewScanners: 'Scanners:',
            scanHistory: 'Scan History ({n} scans)',
            detailOwner: 'Owner:',
            detailAlliance: 'Alliance:',
            detailFaction: 'Faction:',
            detailCoords: 'Coords:',
            detailBaseLevel: 'Base Level:',
            detailOffense: 'Offense:',
            detailDefense: 'Defense:',
            detailVersion: 'Version:',
            detailScannedBy: 'Scanned by:',
            detailScanned: 'Scanned:',
            baseLayout: 'Base Layout (9×16)',
            unitSymbols: 'Unit symbols',
            modeAbbr: 'Abbreviations',
            modeEmoji: 'Emoji',
            modeColor: 'Colour',
            modeNato: 'NATO',
            noTiles: 'No tile data available',
            defenseUnits: '🛡 Defense Units',
            offenseUnits: '⚔ Offense Units',
            // Target watch
            targetsPageTitle: 'Shockr Target Watch',
            targetsTitle: '🎯 Alliance Target Watch',
            navBases: '⚔ Bases',
            updated: 'Updated {time} · auto-refresh every {s}s',
            refreshFailed: 'Refresh failed: {msg} — retrying in {s}s',
            worldOption: 'World {id} ({n})',
            worldTitle: '— World {id}',
            targetsStats: '{targets} target(s) | {watchers} watcher(s)',
            targetsDoubles: ' | ⚠️ {n} double',
            noWatchers: 'No active watchers — enable Target Watcher in Shockr Tools to start tracking.',
            colTarget: 'Target',
            colCoord: 'Coord',
            colLevel: 'Level',
            colType: 'Type',
            colWatchers: 'Watchers',
            doubleFlag: '⚠️ {n} watchers!',
        },
        de: {
            loggedInAs: 'Angemeldet als:',
            logout: 'Abmelden',
            loading: 'Lädt...',
            refresh: '↻ Aktualisieren',
            error: 'Fehler: {msg}',
            justNow: 'gerade eben',
            minutesAgo: 'vor {n} Min.',
            hoursAgo: 'vor {n} Std.',
            daysAgo: 'vor {n} T.',
            minAgo: 'vor {n} Min.',
            world: 'Welt:',
            all: 'Alle',
            loginPageTitle: 'Shockr — Anmelden',
            loginIntro: 'Melde dich mit deinem Spielernamen und dem API-Key an, den du im Spiel über /st register bekommen hast.',
            loginName: 'Spielername',
            loginNamePlaceholder: 'Dein Name im Spiel',
            loginKey: 'API-Key',
            loginKeyPlaceholder: '32-stelliger Key aus /st register',
            loginButton: 'Anmelden',
            loginFailed: 'Unbekannter Spieler oder ungültiger Key',
            loginRateLimited: 'Zu viele Anmeldeversuche — versuche es in einer Minute erneut',
            loginUnreachable: 'Server nicht erreichbar',
            basesPageTitle: 'Shockr Allianz-Scanner',
            navTargetWatch: '🎯 Zielbeobachtung',
            filterType: 'Typ:',
            filterMinLevel: 'Min. Level:',
            filterAny: 'alle',
            filterAge: 'Alter:',
            age1h: '< 1 Stunde',
            age6h: '< 6 Stunden',
            age24h: '< 24 Stunden',
            age7d: '< 7 Tage',
            filterButton: '🔍 Filtern',
            colName: 'Name',
            colOwner: 'Besitzer',
            colBase: 'Basis',
            colOff: 'Off',
            colDef: 'Def',
            colFaction: 'Fraktion',
            colCoords: 'Koordinaten',
            colScanner: 'Scanner',
            colScanned: 'Gescannt',
            noBases: 'Keine Basen gefunden',
            basesStats: '{bases} Basen | {worlds} Welt(en) | {scanners} Scanner',
            overviewTypes: 'Typen:',
            overviewTypeCounts: '{camp} Camps, {outpost} Outposts, {base} Basen',
            overviewOther: ', {n} sonstige',
            overviewScanners: 'Scanner:',
            scanHistory: 'Scan-Verlauf ({n} Scans)',
            detailOwner: 'Besitzer:',
            detailAlliance: 'Allianz:',
            detailFaction: 'Fraktion:',
            detailCoords: 'Koordinaten:',
            detailBaseLevel: 'Basis-Level:',
            detailOffense: 'Offensive:',
            detailDefense: 'Defensive:',
            detailVersion: 'Version:',
            detailScannedBy: 'Gescannt von:',
            detailScanned: 'Gescannt:',
            baseLayout: 'Basis-Layout (9×16)',
            unitSymbols: 'Einheitensymbole',
            modeAbbr: 'Abkürzungen',
            modeEmoji: 'Emoji',
            modeColor: 'Farbe',
            modeNato: 'NATO',
            noTiles: 'Keine Felddaten vorhanden',
            defenseUnits: '🛡 Verteidigungseinheiten',
            offenseUnits: '⚔ Angriffseinheiten',
            targetsPageTitle: 'Shockr Zielbeobachtung',
            targetsTitle: '🎯 Allianz-Zielbeobachtung',
            navBases: '⚔ Basen',
            updated: 'Aktualisiert {time} · automatisch alle {s} s',
            refreshFailed: 'Aktualisierung fehlgeschlagen: {msg} — neuer Versuch in {s} s',
            worldOption: 'Welt {id} ({n})',
            worldTitle: '— Welt {id}',
            targetsStats: '{targets} Ziel(e) | {watchers} Beobachter',
            targetsDoubles: ' | ⚠️ {n} doppelt',
            noWatchers: 'Keine aktiven Beobachter — aktiviere den Target Watcher in Shockr Tools.',
            colTarget: 'Ziel',
            colCoord: 'Koord.',
            colLevel: 'Level',
            colType: 'Typ',
            colWatchers: 'Beobachter',
            doubleFlag: '⚠️ {n} Beobachter!',
        },
        nl: {
            loggedInAs: 'Ingelogd als:',
            logout: 'Uitloggen',
            loading: 'Laden...',
            refresh: '↻ Vernieuwen',
            error: 'Fout: {msg}',
            justNow: 'zojuist',
            minutesAgo: '{n} min geleden',
            hoursAgo: '{n} u geleden',
            daysAgo: '{n} d geleden',
            minAgo: '{n} min geleden',
            world: 'Wereld:',
            all: 'Alle',
            loginPageTitle: 'Shockr — Inloggen',
            loginIntro: 'Log in met je speler-naam en de API key die je via /st register in de game hebt gekregen.',
            loginName: 'Speler-naam',
            loginNamePlaceholder: 'Je naam in de game',
            loginKey: 'API key',
            loginKeyPlaceholder: 'Key van 32 tekens uit /st register',
            loginButton: 'Inloggen',
            loginFailed: 'Onbekende speler of ongeldige key',
            loginRateLimited: 'Te veel inlogpogingen — probeer het over een minuut opnieuw',
            loginUnreachable: 'Server niet bereikbaar',
            basesPageTitle: 'Shockr Alliance Scanner',
            navTargetWatch: '🎯 Target Watch',
            filterType: 'Type:',
            filterMinLevel: 'Min. level:',
            filterAny: 'alle',
            filterAge: 'Leeftijd:',
            age1h: '< 1 uur',
            age6h: '< 6 uur',
            age24h: '< 24 uur',
            age7d: '< 7 dagen',
            filterButton: '🔍 Filteren',
            colName: 'Naam',
            colOwner: 'Eigenaar',
            colBase: 'Basis',
            colOff: 'Off',
            colDef: 'Def',
            colFaction: 'Factie',
            colCoords: 'Coördinaten',
            colScanner: 'Scanner',
            colScanned: 'Gescand',
            noBases: 'Geen bases gevonden',
            basesStats: '{bases} bases | {worlds} wereld(en) | {scanners} scanner(s)',
            overviewTypes: 'Types:',
            overviewTypeCounts: '{camp} camps, {outpost} outposts, {base} bases',
            overviewOther: ', {n} overig',
            overviewScanners: 'Scanners:',
            scanHistory: 'Scangeschiedenis ({n} scans)',
            detailOwner: 'Eigenaar:',
            detailAlliance: 'Alliance:',
            detailFaction: 'Factie:',
            detailCoords: 'Coördinaten:',
            detailBaseLevel: 'Basislevel:',
            detailOffense: 'Offense:',
            detailDefense: 'Defense:',
            detailVersion: 'Versie:',
            detailScannedBy: 'Gescand door:',
            detailScanned: 'Gescand:',
            baseLayout: 'Basis-layout (9×16)',
            unitSymbols: 'Unit-symbolen',
            modeAbbr: 'Afkortingen',
            modeEmoji: 'Emoji',
            modeColor: 'Kleur',
            modeNato: 'NATO',
            noTiles: 'Geen velddata beschikbaar',
            defenseUnits: '🛡 Defense-units',
            offenseUnits: '⚔ Offense-units',
            targetsPageTitle: 'Shockr Target Watch',
            targetsTitle: '🎯 Alliance Target Watch',
            navBases: '⚔ Bases',
            updated: 'Bijgewerkt {time} · ververst elke {s} s',
            refreshFailed: 'Verversen mislukt: {msg} — nieuwe poging over {s} s',
            worldOption: 'Wereld {id} ({n})',
            worldTitle: '— Wereld {id}',
            targetsStats: '{targets} target(s) | {watchers} kijker(s)',
            targetsDoubles: ' | ⚠️ {n} dubbel',
            noWatchers: 'Geen actieve kijkers — zet de Target Watcher aan in Shockr Tools.',
            colTarget: 'Target',
            colCoord: 'Coörd.',
            colLevel: 'Level',
            colType: 'Type',
            colWatchers: 'Kijkers',
            doubleFlag: '⚠️ {n} kijkers!',
        },
    };

    function readStored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function initialLang() {
        const stored = readStored();
        if (LANGS.includes(stored)) return stored;
        const nav = String(navigator.language || '').slice(0, 2).toLowerCase();
        return LANGS.includes(nav) ? nav : 'en';
    }

    let lang = initialLang();

    function T(key, vars) {
        let s = STRINGS[lang][key];
        if (s === undefined) s = STRINGS.en[key];
        if (s === undefined) return key;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
        return s;
    }

    function applyI18n(root) {
        root = root || document;
        root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = T(el.dataset.i18nPlaceholder); });
        root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle); });
        const titleKey = document.documentElement.dataset.i18nDoctitle;
        if (titleKey) document.title = T(titleKey);
        document.documentElement.lang = lang;
        renderSwitch();
    }

    function setLang(next) {
        if (!LANGS.includes(next) || next === lang) return;
        lang = next;
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* not remembered, still applied */ }
        applyI18n();
        document.dispatchEvent(new CustomEvent('shockr-lang', { detail: { lang } }));
    }

    function renderSwitch() {
        const box = document.getElementById('langSwitch');
        if (!box) return;
        box.textContent = '';
        for (const l of LANGS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lang-flag' + (l === lang ? ' active' : '');
            b.innerHTML = FLAG_SVG[l];   // static markup from this file
            b.title = NAMES[l];
            b.setAttribute('aria-label', NAMES[l]);
            b.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
            b.addEventListener('click', () => setLang(l));
            box.appendChild(b);
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        .lang-switch { display: inline-flex; gap: 2px; align-items: center; }
        .lang-flag {
            background: none; border: 1px solid transparent; border-radius: 3px;
            padding: 2px; line-height: 0; cursor: pointer; opacity: 0.5;
        }
        .lang-flag svg { width: 21px; height: 14px; display: block; border-radius: 1px; }
        .lang-flag:hover { opacity: 0.85; }
        .lang-flag.active { opacity: 1; border-color: #888; }
    `;
    document.head.appendChild(style);

    window.ShockrI18n = { T, setLang, applyI18n, getLang: () => lang, LANGS };
    window.T = T;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyI18n());
    else applyI18n();
})();
