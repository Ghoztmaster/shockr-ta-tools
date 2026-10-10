// Website session (shared by index.html and targets.html):
// - "Ingelogd als: <naam> [Uitloggen]" in the element with id="userBox"
// - any API answer 401 (session expired/revoked while the page is open) -> login page
(function () {
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const resp = await realFetch(...args);
        if (resp.status === 401) location.href = 'login';
        return resp;
    };

    async function showUser() {
        const box = document.getElementById('userBox');
        if (!box) return;
        try {
            const resp = await window.fetch('api/me', { cache: 'no-store' });
            if (!resp.ok) return;
            const me = await resp.json();
            box.textContent = 'Ingelogd als: ';
            const name = document.createElement('strong');
            name.textContent = me.playerName;
            const form = document.createElement('form');
            form.method = 'post';
            form.action = 'api/logout';
            const btn = document.createElement('button');
            btn.type = 'submit';
            btn.textContent = 'Uitloggen';
            form.appendChild(btn);
            box.append(name, ' ', form);
        } catch (e) { /* header stays empty; the page itself still works */ }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showUser);
    else showUser();
})();
