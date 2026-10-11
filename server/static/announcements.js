// Announcement banner under the page header (Bases, Target Watch, Attacks; /info
// shows the same announcements in its own section). Needs i18n.js first.
// Source: GET api/announcements (config/announcements.json, active ones only,
// re-read by the server on change). No announcements -> no banner.
// Colours: info = blue, warning = orange, update = green (same as /info).
(function () {
    let list = [];

    function render() {
        let box = document.getElementById('stAnnouncements');
        if (!list.length) {
            if (box) box.remove();
            return;
        }
        if (!box) {
            box = document.createElement('div');
            box.id = 'stAnnouncements';
            box.className = 'st-announcements';
            const header = document.querySelector('.header');
            if (header) header.after(box);
            else document.body.prepend(box);
        }
        box.textContent = '';
        for (const a of list) {
            const div = document.createElement('div');
            div.className = 'st-announcement ' + a.type;
            div.textContent = '📢 ' + ShockrI18n.pick(a.message);
            box.appendChild(div);
        }
    }

    async function load() {
        try {
            const resp = await fetch('api/announcements', { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            list = Array.isArray(data.announcements) ? data.announcements : [];
            render();
        } catch (e) { /* no banner; the page itself still works */ }
    }

    const style = document.createElement('style');
    style.textContent = `
        .st-announcements { padding: 8px 20px 0; }
        .st-announcement {
            border-left: 4px solid #4fc3f7; background: #1d2a33; color: #e0e0e0;
            padding: 7px 12px; border-radius: 3px; margin-bottom: 6px; font-size: 13px;
        }
        .st-announcement.warning { border-left-color: #ffa726; background: #33281a; }
        .st-announcement.update { border-left-color: #66bb6a; background: #1e2e1f; }
    `;
    document.head.appendChild(style);

    document.addEventListener('shockr-lang', render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
})();
