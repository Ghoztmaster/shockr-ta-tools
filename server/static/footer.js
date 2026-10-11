// Version footer on every page (needs i18n.js first; public, also on the login page):
//   "Shockr Alliance Tools v5.10.0 — 11 oktober 2026"
// Source: GET api/version (config/version.json, re-read by the server on change).
// The date follows the chosen language and re-renders on a language switch.
// No version file / no answer -> no footer (never a made-up version).
(function () {
    const LOCALES = { en: 'en-GB', de: 'de-DE', nl: 'nl-NL' };
    let info = null;

    // "2026-10-11" -> "11 oktober 2026" (nl) / "11. Oktober 2026" (de) / "11 October 2026" (en).
    // Parsed as UTC so the day never shifts with the browser's time zone.
    function formatDate(iso, lang) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return iso ? String(iso) : '';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        try {
            return d.toLocaleDateString(LOCALES[lang] || 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        } catch (e) {
            return String(iso);
        }
    }

    function lang() {
        return (window.ShockrI18n && window.ShockrI18n.getLang()) || 'en';
    }

    function render() {
        if (!info || !info.version) return;
        let el = document.getElementById('stFooter');
        if (!el) {
            el = document.createElement('footer');
            el.id = 'stFooter';
            el.className = 'st-footer';
            document.body.appendChild(el);
        }
        const date = formatDate(info.date, lang());
        el.textContent = 'Shockr Alliance Tools v' + info.version + (date ? ' — ' + date : '');
    }

    async function load() {
        try {
            const resp = await fetch('api/version', { cache: 'no-store' });
            if (!resp.ok) return;
            info = await resp.json();
            render();
        } catch (e) { /* no footer; the page itself still works */ }
    }

    const style = document.createElement('style');
    style.textContent = `
        .st-footer {
            margin-top: 24px; padding: 10px 20px; border-top: 1px solid #333;
            color: #777; font-size: 11px; text-align: center;
        }
    `;
    document.head.appendChild(style);

    window.ShockrFooter = { formatDate };
    document.addEventListener('shockr-lang', render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
})();
