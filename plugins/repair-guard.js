/**
 * repair-guard.js — block "Repair All" so units are not fully repaired by accident.
 *
 * On Forgotten Attack worlds partial (or no) repair saves crystal. While the
 * guard is active, bulk repair does nothing; repairing a single unit still works.
 *
 * Off by default — enable with `/st plugin enable repair-guard`.
 *
 * Two layers, neither depends on obfuscated names:
 *
 * 1. Function patch — every readable `RepairAll*` method on the city data
 *    prototypes is wrapped with a no-op. Obfuscated aliases are found by
 *    reference (any prototype key pointing at the same function), so the
 *    UI is blocked whichever name it calls.
 * 2. Button patch — fallback if the client exposes no readable `RepairAll*`
 *    name: qooxdoo `Button.execute` is wrapped and only refuses buttons whose
 *    label/tooltip matches "Repair All" (scoped per button, no DOM observer
 *    or document-wide listener).
 *
 * Both patches are removed on stop().
 */
import { chatMessage } from '../lib/main.js';

/** Readable bulk-repair method names (RepairAll, RepairAllOffense, ...). */
const REPAIR_ALL_FN = /^RepairAll/;

/** Bulk-repair button text; per-unit "Repair" does not match. */
const REPAIR_ALL_TEXT = /repair\s*all|alle[s]?\s*repar|tout\s*r[ée]parer/i;

/** Min. time between "blocked" chat messages. */
const NOTIFY_INTERVAL_MS = 3000;

export class RepairGuard {
    constructor(config) {
        this.name = 'RepairGuard';
        this.defaultEnabled = false;
        this.config = config;
        this.running = false;
        this._patches = [];     // { proto, key, original }
        this._lastNotify = 0;
    }

    async start() {
        this.running = true;

        const fnCount = this._patchRepairFunctions();
        const btnPatched = this._patchButtons();

        chatMessage('[ST] Repair Guard actief — Repair All geblokkeerd');
        console.log(`[ST] RepairGuard: started (functions: ${fnCount}, button fallback: ${btnPatched})`);
    }

    stop() {
        for (const p of this._patches) {
            p.proto[p.key] = p.original;
        }
        this._patches = [];
        this.running = false;
        console.log('[ST] RepairGuard: stopped');
    }

    /** One-line status for `/st status`. */
    statusText() {
        if (!this.running) return 'Repair All toegestaan';
        return `Repair All geblokkeerd (${this._patches.length} patches)`;
    }

    /** Wrap every RepairAll* method (plus its obfuscated aliases) on city prototypes. */
    _patchRepairFunctions() {
        let count = 0;
        for (const proto of this._cityPrototypes()) {
            const keys = Object.keys(proto);
            const targets = new Set();
            for (const key of keys) {
                if (REPAIR_ALL_FN.test(key) && typeof proto[key] === 'function') {
                    targets.add(proto[key]);
                }
            }
            for (const fn of targets) {
                for (const key of keys) {
                    if (proto[key] !== fn) continue;
                    this._wrap(proto, key, () => () => {
                        this._notifyBlocked();
                        return undefined;
                    });
                    count++;
                }
            }
        }
        return count;
    }

    /** Wrap qooxdoo Button.execute so only "Repair All" buttons are refused. */
    _patchButtons() {
        let proto;
        try {
            proto = qx.ui.form.Button.prototype;
        } catch {
            return false;
        }
        if (typeof proto.execute !== 'function') return false;

        const guard = this;
        this._wrap(proto, 'execute', (original) => function (...args) {
            if (isRepairAllButton(this)) {
                guard._notifyBlocked();
                return undefined;
            }
            return original.apply(this, args);
        });
        return true;
    }

    /** Replace proto[key] with makeWrapper(original) and remember the original. */
    _wrap(proto, key, makeWrapper) {
        const original = proto[key];
        this._patches.push({ proto, key, original });
        proto[key] = makeWrapper(original);
    }

    _cityPrototypes() {
        const protos = [];
        const candidates = [
            () => ClientLib.Data.City.prototype,
            () => ClientLib.Data.CityUnits.prototype,
            () => ClientLib.Data.CityBuildings.prototype,
        ];
        for (const get of candidates) {
            try {
                const p = get();
                if (p) protos.push(p);
            } catch { /* class not present */ }
        }
        return protos;
    }

    _notifyBlocked() {
        const now = Date.now();
        if (now - this._lastNotify < NOTIFY_INTERVAL_MS) return;
        this._lastNotify = now;
        chatMessage('[ST] Repair Guard: Repair All geblokkeerd — repareer per unit of /st plugin disable repair-guard');
    }
}

/** True if a qooxdoo button's label or tooltip reads "Repair All". */
function isRepairAllButton(btn) {
    const texts = [];
    try { texts.push(String(btn.getLabel() || '')); } catch { /* no label */ }
    try { texts.push(String(btn.getToolTipText() || '')); } catch { /* no tooltip */ }
    return texts.some(t => REPAIR_ALL_TEXT.test(t));
}
