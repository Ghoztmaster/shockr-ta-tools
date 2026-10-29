/**
 * tunnel-poi-probe.js — verify TunnelPoiAnalyzer's unconfirmed getters in the live game.
 *
 * Paste into the F12 console (game tab) while the WORLD MAP is shown, with at
 * least one alliance base and one tunnel exit in view. One run, prints:
 *   1. get_OwnedPOIs(): the first entries with raw `t`, and what
 *      GetPOITypeFromWorldPOIType(t) makes of it (expected: an EPOIType 1..7 range value
 *      that matches the POI's type when you click it). If `t` is already the EPOIType,
 *      the conversion gives nonsense and the raw `t` is the one that matches.
 *   2. The first alliance base in view: $AllianceId / $PlayerId from the world object,
 *      and the region vis object's get_* methods + get_BaseLevelFloat / get_BaseLevel /
 *      get_PlayerName values (compare with the level shown when you click the base).
 *   3. The first tunnel exit in view: raw position, level, required offense.
 *
 * Result 2026-10-29 (world 477): `t` IS the EPOIType (t 4 at a PowerBonus POI);
 * base: get_AllianceId / get_PlayerId / get_PlayerName / get_BaseLevel correct,
 * no get_BaseLevelFloat; world $AllianceId held the player id, $PlayerId a small index.
 */
(() => {
    const md = ClientLib.Data.MainData.GetInstance();
    const alliance = md.get_Alliance();
    const ownId = alliance.get_Id();
    const getters = (o) => {
        const names = new Set();
        for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
            for (const k of Object.getOwnPropertyNames(p)) if (k.startsWith('get_')) names.add(k);
        }
        return [...names].sort().join(', ');
    };
    const call = (o, g) => { try { return typeof o[g] === 'function' ? o[g]() : '(none)'; } catch (e) { return `(throws ${e.message})`; } };

    // 1. Owned POIs
    try {
        const E = ClientLib.Base.EPOIType;
        const name = (v) => Object.keys(E).find(k => E[k] === v) || v;
        const owned = (alliance.get_OwnedPOIs() || []).slice(0, 5).map(p => {
            let conv;
            try { conv = ClientLib.Base.PointOfInterestTypes.GetPOITypeFromWorldPOIType(p.t); } catch (e) { conv = `throws ${e.message}`; }
            return { x: p.x, y: p.y, l: p.l, t: p.t, tAsEPOIType: name(p.t), converted: conv, convertedName: name(conv) };
        });
        console.log('[ST probe] OwnedPOIs', owned);
    } catch (e) { console.warn('[ST probe] OwnedPOIs failed', e); }

    // 2 + 3. Scan the view
    const region = ClientLib.Vis.VisMain.GetInstance().get_Region();
    const gw = region.get_GridWidth();
    const gh = region.get_GridHeight();
    const zoom = region.get_ZoomFactor() || 1;
    const x0 = Math.floor(region.get_PosX() / gw);
    const y0 = Math.floor(region.get_PosY() / gh);
    const w = Math.ceil(region.get_ViewWidth() / zoom / gw);
    const h = Math.ceil(region.get_ViewHeight() / zoom / gh);
    const world = md.get_World();
    const T = ClientLib.Vis.VisObject.EObjectType;
    let base = null;
    let tunnel = null;
    for (let y = y0; y <= y0 + h && !(base && tunnel); y++) {
        for (let x = x0; x <= x0 + w && !(base && tunnel); x++) {
            const wo = world.GetObjectFromPosition(x, y);
            const vis = region.GetObjectFromPosition(x * gw, y * gh);
            // match on the vis object's alliance id: the world object's $AllianceId is not it (seen live)
            if (!base && wo && vis && vis.get_VisObjectType() === T.RegionCityType && call(vis, 'get_AllianceId') === ownId) {
                base = {
                    pos: `${x}:${y}`, worldType: wo.Type, $AllianceId: wo.$AllianceId, $PlayerId: wo.$PlayerId,
                    get_BaseLevelFloat: call(vis, 'get_BaseLevelFloat'), get_BaseLevel: call(vis, 'get_BaseLevel'),
                    get_PlayerName: call(vis, 'get_PlayerName'), get_AllianceId: call(vis, 'get_AllianceId'),
                    get_PlayerId: call(vis, 'get_PlayerId'),
                    memberName: (alliance.get_MemberData().d[call(vis, 'get_PlayerId')] || {}).Name,
                    getters: getters(vis),
                };
            }
            if (!tunnel && vis && vis.get_VisObjectType() === T.RegionPointOfInterest && vis.get_Type() === 0) {
                const lvl = vis.get_Level();
                tunnel = {
                    pos: `${vis.get_RawX()}:${vis.get_RawY()}`, worldType: wo && wo.Type, level: lvl,
                    required: lvl - md.get_Server().get_POIActivationLevelDifference(),
                };
            }
        }
    }
    console.log('[ST probe] alliance base', base || 'none in view');
    console.log('[ST probe] tunnel exit', tunnel || 'none in view');
})();
