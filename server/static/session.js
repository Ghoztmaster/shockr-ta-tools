// Website session (shared by index.html and targets.html; needs i18n.js first):
// - "Logged in as: <name> [Log out]" in the element with id="userBox", in the
//   chosen language (re-rendered on a language switch)
// - any API answer 401 (session expired/revoked while the page is open) -> login page
(function () {
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const resp = await realFetch(...args);
        if (resp.status === 401) location.href = 'login';
        return resp;
    };

    let me = null;

    function renderUser() {
        const box = document.getElementById('userBox');
        if (!box || !me) return;
        box.textContent = T('loggedInAs') + ' ';
        const name = document.createElement('strong');
        name.textContent = me.playerName;
        const form = document.createElement('form');
        form.method = 'post';
        form.action = 'api/logout';
        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.textContent = T('logout');
        form.appendChild(btn);
        box.append(name, ' ', form);
    }

    async function loadUser() {
        try {
            const resp = await window.fetch('api/me', { cache: 'no-store' });
            if (!resp.ok) return;
            me = await resp.json();
            renderUser();
        } catch (e) { /* header stays empty; the page itself still works */ }
    }

    document.addEventListener('shockr-lang', renderUser);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadUser);
    else loadUser();
})();
