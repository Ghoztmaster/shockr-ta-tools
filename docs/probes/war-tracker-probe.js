/**
 * war-tracker-probe.js — what do an OFFENSE combat report and the alliance
 * role look like? Read-only.
 *
 * Paste into the F12 console (game tab, Shockr may stay on) after at least one
 * attack on a Forgotten camp/outpost, preferably one won with CY destroyed and
 * one lost. The probe fetches the newest 5 offense report headers and the full
 * report of each (1 s apart), the same route as plugins/attack-tracker.js.
 * Nothing is marked read or deleted. Copy the whole console output back.
 *
 * Answers for plugins/attack-tracker.js (War Tracker, 5.33.0):
 *   1. header fields of a won/lost/destroyed attack (s, ad.cr, obi, bi)
 *   2. which 0-argument getters an offense CombatReport has and their values -
 *      looking for "% of the CY / DF destroyed" (cyPct / dfPct are not filled yet)
 *   3. get_DefenderStart/EndHealthPercent on an offense report (verified only
 *      on defence reports so far)
 *   4. CP cost via the own base: CalculateAttackCommandPointCostToCoord(x, y)
 *   5. own role: get_IsFirstLeader / get_IsAdmin / get_IsOfficer, and whether
 *      get_MemberData().d[id] holds a Role / RoleName field (is "admin without
 *      first leader" really the Second Commander?)
 */
(() => {
    const md = ClientLib.Data.MainData.GetInstance();
    const util = webfrontend.phe.cnc.Util;
    const call = (o, n) => { try { return typeof o[n] === 'function' ? o[n]() : '(no such getter)'; } catch (e) { return `(throws: ${e.message})`; } };

    // 5. role
    const a = md.get_Alliance();
    const me = md.get_Player().get_Id ? md.get_Player().get_Id() : md.get_Player().id;
    console.log('[ST probe] own role:', {
        allianceId: call(a, 'get_Id'),
        IsFirstLeader: call(a, 'get_IsFirstLeader'),
        IsAdmin: call(a, 'get_IsAdmin'),
        IsOfficer: call(a, 'get_IsOfficer'),
        NumAdmins: call(a, 'get_NumAdmins'),
    });
    try {
        const members = a.get_MemberData().d;
        const mine = members[me];
        console.log('[ST probe] own member data keys:', mine && Object.keys(mine), mine);
        const roles = {};
        for (const m of Object.values(members)) {
            const key = `${m.Role}|${m.RoleName}`;
            roles[key] = (roles[key] || 0) + 1;
        }
        console.log('[ST probe] members per Role|RoleName:', roles);
    } catch (e) { console.warn('[ST probe] member data not readable', e); }
    try {
        const p = Object.getPrototypeOf(a);
        console.log('[ST probe] alliance role-ish getters:',
            Object.keys(p).filter(k => /Role|Leader|Admin|Officer|Rank/i.test(k) && typeof p[k] === 'function'));
    } catch { /* ignore */ }

    // 1-4. reports
    const reports = md.get_Reports();
    const pending = [];
    util.attachNetEvent(reports, 'ReportDelivered', ClientLib.Data.Reports.ReportDelivered, null, (rep) => {
        const id = call(rep, 'get_Id');
        const h = pending.find(x => x.i === id);
        if (!h) return;
        const p = Object.getPrototypeOf(rep);
        const getters = {};
        for (const k of Object.keys(p)) {
            if (typeof p[k] !== 'function' || p[k].length !== 0 || !/^(get_|Get|Is|Has)/.test(k)) continue;
            const v = call(rep, k);
            if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) getters[k] = v;
        }
        let cp = '(own base not found)';
        try {
            const own = md.get_Cities().get_AllCities().d[h.bi];
            if (own) cp = own.CalculateAttackCommandPointCostToCoord(Number(h.ad.dbx), Number(h.ad.dby));
        } catch (e) { cp = `(throws: ${e.message})`; }
        console.log(`[ST probe] report ${id}: won=${h.s} cr=${h.ad && h.ad.cr} target ${h.ad && h.ad.dbx}:${h.ad && h.ad.dby} obi=${h.obi} bi=${h.bi} cpNow=${cp}`);
        console.log('[ST probe]   header:', h);
        console.log('[ST probe]   0-arg getters:', getters);
        console.log('[ST probe]   CY/DF/Health/Building candidates:',
            Object.fromEntries(Object.entries(getters).filter(([k]) => /Construction|Defen|Facility|Health|Building|Destroy|Damage|Percent|Command|Point|Result/i.test(k))));
    });
    ClientLib.Net.CommunicationManager.GetInstance().SendSimpleCommand('GetReportHeaderAll',
        { type: 1, skip: 0, take: 5, sort: 1, ascending: false },
        util.createEventDelegate(ClientLib.Net.CommandResult, null, (ctx, data) => {
            const headers = (Array.isArray(data) ? data : []).filter(h => h.tp === 2);
            console.log(`[ST probe] ${headers.length} Forgotten report header(s)`);
            headers.forEach((h, n) => setTimeout(() => { pending.push(h); reports.RequestReportData(h.i); }, n * 1000));
        }), null);
})();
