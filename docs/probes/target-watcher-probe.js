/**
 * target-watcher-probe.js — verify TargetWatcher's city detection in the live game.
 *
 * Paste into the F12 console (game tab), then: open an FG camp, another FG base,
 * an enemy player base, an alliance mate's base, your own base and the world map.
 * Each change of mode/city logs one line. Stop with: clearInterval(window.__stProbe)
 *
 * TargetWatcher assumes: viewing a non-own base → mode City / CombatSetup /
 * Battleground and currentCity = that base (IsOwnBase false, not ghost).
 */
(() => {
    clearInterval(window.__stProbe);
    const modeName = (m) => Object.keys(ClientLib.Vis.Mode).find(k => ClientLib.Vis.Mode[k] === m) || m;
    let last = '';
    window.__stProbe = setInterval(() => {
        try {
            const md = ClientLib.Data.MainData.GetInstance();
            const cities = md.get_Cities();
            const c = cities.get_CurrentCity();
            const own = cities.get_CurrentOwnCity();
            const sel = ClientLib.Vis.VisMain.GetInstance().get_SelectedObject();
            const row = {
                mode: modeName(ClientLib.Vis.VisMain.GetInstance().get_Mode()),
                currentCityId: cities.get_CurrentCityId(),
                currentOwnId: own && own.get_Id(),
                name: c && c.get_Name(),
                isOwn: c && c.IsOwnBase(),
                ghost: c && c.get_IsGhostMode(),
                faction: c && c.get_CityFaction(),
                ownerId: c && c.get_OwnerId(),
                allianceId: c && c.get_OwnerAllianceId(),
                pos: c && `${c.get_PosX()}:${c.get_PosY()}`,
                lvl: c && c.get_LvlBase(),
                selected: sel && typeof sel.get_Id === 'function' ? sel.get_Id() : null,
            };
            const key = JSON.stringify(row);
            if (key !== last) { last = key; console.log('[ST probe]', row); }
        } catch (e) {
            console.warn('[ST probe] error', e);
        }
    }, 1000);
    console.log('[ST probe] running — clearInterval(window.__stProbe) to stop');
})();
