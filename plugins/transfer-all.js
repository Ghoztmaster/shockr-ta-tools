// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
/**
 * transfer-all.js — "Transfer All" in the game's resource-transfer panel
 * (replaces Tiberium Alliances Transfer All Resources 1.6.2, KRS_L).
 *
 * The game's transfer panel (webfrontend.gui.trade.TradeOverlay) moves
 * resources FROM your other bases INTO the base that is open now. The
 * original adds a button there that pulls the selected resource (tib OR
 * crystal) from ALL other bases in one go. Shockr pulls tiberium AND crystal
 * (agreed with Wilco; credits are per player in the game, not per base, so
 * there is nothing to transfer - they only pay the transfer cost).
 *
 * Safety, as the original: a checkbox next to the button; ticking it shows
 * the total transfer cost (red when it exceeds your credits) and enables the
 * button; it unticks itself after each transfer. No dialog.
 *
 * Limits (the original sent everything and let the server refuse):
 *   - per resource the amount is capped at the free storage of the open base
 *     (GetResourceMaxStorage - GetResourceCount); full = that resource skipped
 *   - a source base whose transfer costs more than the credits left is skipped
 *   - only bases where both sides can trade (CanTrade() === ETradeError.None)
 *   - a refused SelfTrade is retried once, then skipped (the original's rule)
 *
 * Game API: SendCommand("SelfTrade", {targetCityId, sourceCityId,
 * resourceType, amount}) - the command the panel itself uses (the original
 * calls exactly this). Cost: CalculateTradeCostToCoord(x, y, amount) on the
 * source base. Panel position: the original's child path into the overlay
 * (getLayoutChildren()[13] → [1] → layout children [3]); not found = one
 * warning, no button. The game's own per-base transfer buttons are untouched,
 * and so is its cost label (the original wrote into it; Shockr has its own).
 */
import { t } from '../lib/i18n.js';
import { fmtNumber } from '../lib/poi-util.js';

const COST_OK = '#ffffff';
const COST_TOO_HIGH = '#ef5350';

function resourceTypes() {
    const e = ClientLib.Base.EResourceType;
    return [{ key: 'tib', type: e.Tiberium }, { key: 'cry', type: e.Crystal }];
}

function tradeOk(city) {
    try {
        return city.CanTrade() === ClientLib.Data.ETradeError.None;
    } catch {
        return false;
    }
}

function freeStorage(city, type) {
    try {
        const max = Number(city.GetResourceMaxStorage(type));
        if (!(max > 0)) return Infinity;
        return Math.max(0, Math.floor(max - Number(city.GetResourceCount(type))));
    } catch {
        return Infinity;                  // unreadable: let the server enforce it
    }
}

/**
 * The transfers for one click: [{source, type, key, amount, cost}] plus
 * {skippedFull: [key], skippedCredits: n, cost}. Pure apart from the city
 * getters, so it is testable.
 */
export function planTransfers(target, sources, credits) {
    const items = [];
    const skippedFull = [];
    let skippedCredits = 0;
    let left = Number(credits);
    if (!Number.isFinite(left)) left = Infinity;
    if (!tradeOk(target)) return { items, skippedFull, skippedCredits, cost: 0 };
    for (const { key, type } of resourceTypes()) {
        let free = freeStorage(target, type);
        if (free <= 0) {
            skippedFull.push(key);
            continue;
        }
        for (const source of sources) {
            if (free <= 0) break;
            if (source === target || !tradeOk(source)) continue;
            const amount = Math.min(Math.floor(Number(source.GetResourceCount(type)) || 0), free);
            if (amount <= 0) continue;
            const cost = Number(source.CalculateTradeCostToCoord(target.get_PosX(), target.get_PosY(), amount)) || 0;
            if (cost > left) {
                skippedCredits++;
                continue;
            }
            left -= cost;
            free -= amount;
            items.push({ source, type, key, amount, cost });
        }
    }
    return { items, skippedFull, skippedCredits, cost: items.reduce((s, i) => s + i.cost, 0) };
}

function ownCities() {
    const cities = ClientLib.Data.MainData.GetInstance().get_Cities();
    return { target: cities.get_CurrentOwnCity(), all: Object.values(cities.get_AllCities().d) };
}

function credits() {
    try { return ClientLib.Data.MainData.GetInstance().get_Player().GetCreditsCount(); } catch { return Infinity; }
}

function fmt(n) {
    try { return String(phe.cnc.gui.util.Numbers.formatNumbersCompactAfterMillion(n)); } catch { return fmtNumber(n); }
}

export class TransferAll {
    /** Short description for `/st help`. */
    get description() { return t('descTransferAll'); }

    constructor(config) {
        this.name = 'TransferAll';
        this.config = config;
        this.running = false;
        this.busy = false;
        this._widgets = null;      // {container, button, check, cost}
        this._listeners = [];      // {widget, id}
        this._timer = null;
    }

    async start() {
        this.running = true;
        if (!this._install()) {
            // the overlay class can load after Shockr: try again a few times
            let tries = 0;
            this._timer = setInterval(() => {
                if (this._install() || ++tries >= 30) {
                    clearInterval(this._timer);
                    this._timer = null;
                    if (!this._widgets) console.warn('[ST] TransferAll: transfer panel not found — no button');
                }
            }, 2000);
        }
        console.log('[ST] TransferAll: started');
    }

    stop() {
        this.running = false;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        for (const { widget, id } of this._listeners) {
            try { widget.removeListenerById(id); } catch { /* disposed */ }
        }
        this._listeners = [];
        if (this._widgets) {
            const { container, button, check, cost } = this._widgets;
            for (const w of [button, check, cost]) {
                try { container.remove(w); w.dispose(); } catch { /* gone */ }
            }
            this._widgets = null;
        }
    }

    /** The overlay's container the original adds its button to, or null. */
    static findContainer() {
        try {
            const overlay = webfrontend.gui.trade.TradeOverlay.getInstance();
            const parts = overlay.getLayoutChildren()[13].getLayoutChildren()[1].getLayout()._getLayoutChildren();
            const container = parts[3];
            return container && typeof container.add === 'function' ? { overlay, container } : null;
        } catch {
            return null;
        }
    }

    _install() {
        if (this._widgets || !this.running) return !!this._widgets;
        const found = TransferAll.findContainer();
        if (!found) return false;
        const { overlay, container } = found;
        const button = new webfrontend.ui.SoundButton(t('transferAllButton')).set({
            width: 90, enabled: false, toolTipText: t('transferAllTooltip'),
        });
        const check = new qx.ui.form.CheckBox('');
        check.setToolTipText(t('transferAllCheckTooltip'));
        const cost = new qx.ui.basic.Label('').set({ textColor: COST_OK });
        const on = (widget, type, fn) => this._listeners.push({ widget, id: widget.addListener(type, fn, this) });
        on(check, 'changeValue', () => this._onCheck());
        on(button, 'click', () => this.transfer());
        on(overlay, 'appear', () => check.setValue(false));   // a reopened panel starts unarmed
        container.add(button, { right: 2, top: 100 });
        container.add(check, { right: 96, top: 104 });
        container.add(cost, { right: 2, top: 126 });
        this._widgets = { container, button, check, cost };
        return true;
    }

    /** Checkbox: show the cost of transferring everything, arm the button. */
    _onCheck() {
        const { button, check, cost } = this._widgets;
        const armed = !!check.getValue();
        button.setEnabled(armed && !this.busy);
        if (!armed) {
            cost.setValue('');
            return;
        }
        try {
            const { target, all } = ownCities();
            const plan = planTransfers(target, all, Infinity);
            cost.setValue(t('transferAllCost', { cost: fmt(plan.cost) }));
            cost.setTextColor(plan.cost > credits() ? COST_TOO_HIGH : COST_OK);
        } catch (e) {
            cost.setValue('');
            console.warn('[ST] TransferAll: cost calculation failed', e && e.message);
        }
    }

    /** Send the plan's SelfTrade commands one by one. */
    async transfer() {
        if (this.busy) return;
        let target;
        let plan;
        try {
            const c = ownCities();
            target = c.target;
            plan = planTransfers(target, c.all, credits());
        } catch (e) {
            console.warn('[ST] TransferAll: transfer failed', e && e.message);
            return;
        }
        this.busy = true;
        if (this._widgets) {
            this._widgets.check.setValue(false);
            this._widgets.button.setEnabled(false);
        }
        const done = { tib: 0, cry: 0 };
        let failed = 0;
        for (const item of plan.items) {
            let ok = await this._send(target, item);
            if (!ok) ok = await this._send(target, item);           // the original's one retry
            if (ok) done[item.key] += item.amount;
            else failed++;
        }
        this.busy = false;
        const name = String(target.get_Name());
        const skipped = [
            ...plan.skippedFull.map(k => t('transferAllSkippedFull', { res: t(`poiShort_${k}`) })),
            ...(plan.skippedCredits ? [t('transferAllSkippedCredits', { n: plan.skippedCredits })] : []),
            ...(failed ? [t('transferAllFailed', { n: failed })] : []),
        ];
        if (done.tib || done.cry) {
            console.log(`[ST] Transferred all resources to ${name} (tib ${fmtNumber(done.tib)}, cry ${fmtNumber(done.cry)})`
                + (skipped.length ? ` — ${skipped.join(', ')}` : ''));
        } else {
            console.log(`[ST] TransferAll: nothing transferred to ${name}` + (skipped.length ? ` — ${skipped.join(', ')}` : ''));
        }
        return { done, failed, skippedFull: plan.skippedFull, skippedCredits: plan.skippedCredits };
    }

    /** One SelfTrade; resolves true when the server answered 0 (ok). */
    _send(target, item) {
        return new Promise((resolve) => {
            try {
                ClientLib.Net.CommunicationManager.GetInstance().SendCommand('SelfTrade', {
                    targetCityId: target.get_Id(),
                    sourceCityId: item.source.get_Id(),
                    resourceType: item.type,
                    amount: item.amount,
                }, phe.cnc.Util.createEventDelegate(ClientLib.Net.CommandResult, this,
                    (ctx, result) => resolve(Number(result) === 0)), null, true);
            } catch (e) {
                console.warn('[ST] TransferAll: SelfTrade failed', e && e.message);
                resolve(false);
            }
        });
    }
}
