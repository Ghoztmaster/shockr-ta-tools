/**
 * spam-block-probe.js — how does the game's mail window load and show mail?
 *
 * Paste into the F12 console (game tab, Shockr's SpamBlock may stay on), then:
 * open Mail → inbox → click two or three mails (one from a player, one
 * system mail) → open the outbox once. Nothing is sent besides what the game
 * sends itself; the probe only logs. Stop with: window.__stSpamProbeStop()
 *
 * Answers for plugins/spam-block.js:
 *   1. which webfrontend.gui.mail.* classes exist (MailTab, MailMessage, ...)?
 *   2. does the mail window go through CommunicationManager.SendSimpleCommand
 *      (IGMGetMsgHeader for the list, IGMGetMsg when a mail is opened), and is
 *      the 3rd argument a function delegate?
 *   3. which fields does a header carry (i, f, fi, s, r, d, ...)?
 *   4. after a mail is opened: which mail widgets are visible, and which buttons
 *      (objid, label, appearance, parent class) does the message view hold?
 */
(() => {
    if (window.__stSpamProbeStop) window.__stSpamProbeStop();
    const mail = webfrontend.gui.mail || {};
    console.log('[ST probe] webfrontend.gui.mail classes:', Object.keys(mail));
    try {
        const m = ClientLib.Data.MainData.GetInstance().get_Mail();
        const p = Object.getPrototypeOf(m);
        console.log('[ST probe] ClientLib.Data.Mail readable methods:',
            Object.keys(p).filter(k => /^[A-Z][a-z]/.test(k) && typeof p[k] === 'function'));
    } catch (e) { console.warn('[ST probe] no get_Mail()', e); }

    const proto = ClientLib.Net.CommunicationManager.prototype;
    const original = proto.SendSimpleCommand;
    const aliases = Object.keys(proto).filter(k => proto[k] === original);
    console.log('[ST probe] SendSimpleCommand aliases:', aliases);

    const kids = (w) => { try { return (w._getChildren ? w._getChildren() : (w.getChildren ? w.getChildren() : [])) || []; } catch { return []; } };
    const walk = (w, fn, d = 0) => { if (!w || d > 40) return; fn(w, d); for (const k of kids(w)) walk(k, fn, d + 1); };
    const seeable = (w) => { try { return w.isSeeable ? w.isSeeable() : w.isVisible(); } catch { return false; } };
    const dumpWidgets = (why) => {
        const root = qx.core.Init.getApplication().getRoot();
        const views = [];
        walk(root, (w) => { if (/^webfrontend\.gui\.mail\./.test(w.classname || '') && seeable(w)) views.push(w); });
        console.log(`[ST probe] ${why}: visible mail widgets`, views.map(v => v.classname));
        for (const v of views) {
            const buttons = [];
            walk(v, (b) => {
                if (!(b instanceof qx.ui.form.Button)) return;
                let label = ''; try { label = b.getLabel(); } catch { /* none */ }
                const parent = b.getLayoutParent();
                buttons.push({ objid: b.objid, label: String(label), appearance: b.getAppearance(),
                    visible: seeable(b), parent: parent && parent.classname, parentHasAddAfter: !!(parent && parent.addAfter) });
            });
            const lists = [];
            walk(v, (w) => { if (/table|list/i.test(w.classname || '')) lists.push(w.classname); });
            console.log(`[ST probe]   ${v.classname}: buttons`, buttons, 'tables/lists', lists);
        }
    };

    const wrapper = function (name, params, delegate, ...rest) {
        if (/^IGM/.test(name)) {
            console.log(`[ST probe] → ${name}`, params, 'delegate:', typeof delegate, 'rest:', rest);
            if (typeof delegate === 'function') {
                const d = delegate;
                delegate = function (...args) {
                    const arr = args.find(Array.isArray);
                    console.log(`[ST probe] ← ${name}`, arr ? { count: arr.length, first: arr[0] } : args);
                    const r = d.apply(this, args);
                    if (name === 'IGMGetMsg') setTimeout(() => dumpWidgets('after IGMGetMsg'), 50);
                    return r;
                };
            }
        }
        return original.call(this, name, params, delegate, ...rest);
    };
    for (const k of aliases) proto[k] = wrapper;
    window.__stSpamProbeDump = () => dumpWidgets('manual');
    // 5. (round 2) with a mail open: where does MailMessageDisplay keep the sender?
    //    SpamBlock looks for an own property (depth <= 2) holding { i, f, fi }.
    window.__stSpamProbeSender = () => {
        const root = qx.core.Init.getApplication().getRoot();
        walk(root, (v) => {
            if (v.classname !== 'webfrontend.gui.mail.MailMessageDisplay' || !seeable(v)) return;
            const hits = [];
            const look = (o, p, d) => {
                if (!o || typeof o !== 'object' || d > 3) return;
                let keys = []; try { keys = Object.keys(o); } catch { return; }
                if ('fi' in o || 'f' in o) hits.push({ path: p, keys: keys.slice(0, 20), f: o.f, fi: o.fi, i: o.i });
                for (const k of keys) {
                    let x; try { x = o[k]; } catch { continue; }
                    if (x && typeof x === 'object' && !x.classname && !x.nodeType) look(x, `${p}.${k}`, d + 1);
                }
            };
            look(v, 'view', 0);
            const getters = [];
            for (let p = v; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
                for (const k of Object.getOwnPropertyNames(p)) if (/from|sender|mail|message|header/i.test(k) && !getters.includes(k)) getters.push(k);
            }
            console.log('[ST probe] MailMessageDisplay header-like objects:', hits, 'members:', getters);
        });
    };
    window.__stSpamProbeStop = () => {
        for (const k of aliases) proto[k] = original;
        delete window.__stSpamProbeStop;
        delete window.__stSpamProbeDump;
        delete window.__stSpamProbeSender;
        console.log('[ST probe] stopped');
    };
    console.log('[ST probe] logging IGM* commands; window.__stSpamProbeDump() lists the mail widgets now');
})();
