/**
 * wavy-move-probe.js — what does the game give us while moving a base?
 *
 * Paste into the F12 console (game tab), then: world map → own base → "Move
 * base" → hover/click a few target cells (also one far from the base).
 * Stop with: window.__stWavyProbeStop()
 *
 * Answers for plugins/wavy.js:
 *   1. does webfrontend.gui.region.RegionCityMoveInfo exist, is it a singleton
 *      (getInstance) and does it fire appear/disappear?
 *   2. at appear: does get_SelectedObject() give the TARGET cell or the base
 *      being moved (compare with the own base's position)?
 *   3. which getters on the widget / its parent carry the target coordinate?
 */
(() => {
    if (window.__stWavyProbeStop) window.__stWavyProbeStop();
    const region = webfrontend.gui.region;
    const names = Object.keys(region).filter(n => /Move/i.test(n));
    console.log('[ST probe] region widgets with "Move":', names);
    const cls = region.RegionCityMoveInfo;
    if (!cls || typeof cls.getInstance !== 'function') {
        console.warn('[ST probe] RegionCityMoveInfo has no getInstance()', cls);
        return;
    }
    const w = cls.getInstance();
    const getters = (o) => {
        const out = [];
        for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
            for (const k of Object.getOwnPropertyNames(p)) {
                if (/^(get_|get)[A-Z]/.test(k) && /X|Y|Pos|Coord|Target|City|Object/.test(k) && !out.includes(k)) out.push(k);
            }
        }
        return out;
    };
    const tryCall = (o, ks) => {
        const r = {};
        for (const k of ks) {
            try { if (typeof o[k] === 'function' && o[k].length === 0) r[k] = String(o[k]()); } catch (e) { r[k] = '!' + e.message; }
        }
        return r;
    };
    const dump = (ev) => {
        const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
        const own = ClientLib.Data.MainData.GetInstance().get_Cities().get_CurrentOwnCity();
        const parent = w.getLayoutParent();
        console.log(`[ST probe] ${ev}`, {
            selected: sel && typeof sel.get_RawX === 'function' ? `${sel.get_RawX()}:${sel.get_RawY()}` : sel,
            selectedType: sel && typeof sel.get_VisObjectType === 'function' ? sel.get_VisObjectType() : null,
            currentOwnCity: own ? `${own.get_PosX()}:${own.get_PosY()}` : null,
            widget: tryCall(w, getters(w)),
            parent: parent ? { cls: parent.classname, ...tryCall(parent, getters(parent)) } : null,
        });
    };
    const ids = [
        w.addListener('appear', () => dump('appear')),
        w.addListener('disappear', () => dump('disappear')),
    ];
    window.__stWavyProbeStop = () => { ids.forEach(id => w.removeListenerById(id)); delete window.__stWavyProbeStop; };
    console.log('[ST probe] listening on RegionCityMoveInfo; widget getters:', getters(w));
})();
