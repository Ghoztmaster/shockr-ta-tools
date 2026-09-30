/**
 * kill-info.js — show plunder value (repair cost) tooltip on mouseover in battle view.
 *
 * When hovering a defense unit in Default mouse mode, the tooltip shows the
 * unit's repair requirements = what you plunder by destroying it.
 *
 * Approach: find the tooltip handler function via fingerprint, wrap it to
 * append plunder info after the original tooltip renders.
 *
 * Last verified: 2026-09-30
 *   $I.VOEYIO.OHZBHT — tooltip handler
 *   this.MZWKJT — tooltip widget
 *   MKSILI — show(name, desc, upgraded)
 *   PEODKX — setStatusText(text)
 *   n.VSZLQT() — get unit details
 *   get_UnitLevelRepairRequirements() — [{Type, Count}, ...]
 */

/** Resource type IDs from the game client */
const RES_NAMES = {
    1: 'Tib',
    2: 'Crystal', // not typically in repair costs but just in case
    3: 'Power',
    4: 'Credits',
    6: 'Crystal',
    7: 'Research',
};

export class KillInfo {
    constructor() {
        this.name = 'KillInfo';
        this.running = false;
        this._proto = null;
        this._funcName = null;
        this._oldFunction = null;
    }

    async start() {
        const found = this._findTooltipFunction();
        if (!found) {
            console.warn('[ST] KillInfo: tooltip function not found — feature disabled');
            this.running = true; // mark running so stop() works
            return;
        }

        const { proto, funcName } = found;
        this._proto = proto;
        this._funcName = funcName;
        this._oldFunction = proto[funcName];

        const oldFn = this._oldFunction;

        proto[funcName] = function(n) {
            // Always call original first
            oldFn.call(this, n);

            // Only enhance in Default mouse mode
            try {
                if (ClientLib.Vis.VisMain.GetInstance().get_MouseMode() !== 0) return;
            } catch { return; }

            // Only for defense units (NGRTYA check — DefenseUnitType)
            try {
                if (typeof n.VSZLQT !== 'function') return;
                const unit = n.VSZLQT();
                if (!unit) return;

                const repairReqs = unit.get_UnitLevelRepairRequirements();
                if (!repairReqs || repairReqs.length === 0) return;

                // Format plunder string
                const parts = [];
                for (let i = 0; i < repairReqs.length; i++) {
                    const req = repairReqs[i];
                    if (req && req.Count > 0) {
                        const name = RES_NAMES[req.Type] || `Res${req.Type}`;
                        parts.push(`${name}: ${req.Count.toLocaleString()}`);
                    }
                }

                if (parts.length === 0) return;

                const plunderText = `Plunder: ${parts.join(' | ')}`;

                // Find the tooltip widget and set status text
                // Walk 'this' properties to find the tooltip object with PEODKX
                const tooltipKeys = Object.keys(this).filter(k =>
                    this[k] && typeof this[k] === 'object' &&
                    typeof this[k].PEODKX === 'function'
                );

                for (const key of tooltipKeys) {
                    this[key].PEODKX(plunderText);
                }
            } catch (e) {
                // Silent — don't break the tooltip
            }
        };

        this.running = true;
        console.log('[ST] KillInfo: started');
    }

    stop() {
        if (this._proto && this._funcName && this._oldFunction) {
            this._proto[this._funcName] = this._oldFunction;
            this._oldFunction = null;
        }
        this.running = false;
    }

    /**
     * Find the tooltip handler function by fingerprint.
     * Searches $I.*.prototype for a function containing both:
     *   - '"tnf:full hp needed to upgrade"'
     *   - 'DefenseTerrainFieldType'
     */
    _findTooltipFunction() {
        const target = '"tnf:full hp needed to upgrade"';
        const filter = 'DefenseTerrainFieldType';

        for (const className of Object.keys($I)) {
            const cls = $I[className];
            if (!cls || !cls.prototype) continue;

            for (const funcName of Object.keys(cls.prototype)) {
                if (funcName.length !== 6) continue;
                const func = cls.prototype[funcName];
                if (typeof func !== 'function') continue;

                const src = func.toString();
                if (src.includes(target) && src.includes(filter)) {
                    console.log(`[ST] KillInfo: found tooltip at $I.${className}.${funcName}`);
                    return { proto: cls.prototype, funcName };
                }
            }
        }
        return null;
    }
}
