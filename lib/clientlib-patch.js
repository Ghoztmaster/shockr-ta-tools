// Shockr TA Tools - Copyright (C) 2026 Ghozt [SoO]
// SPDX-License-Identifier: GPL-3.0-or-later
// Free software under the GNU General Public License v3 or later; see LICENSE. No warranty.
// Portions derived from blacha/st (Shockr Tools), Copyright (c) 2020 Blayne Chard, MIT; see NOTICE.
/**
 * clientlib-patch.js — fingerprint-based ClientLib property patcher.
 *
 * Instead of a single regex that breaks on every client update, each patch
 * defines multiple fingerprint patterns tried in order. When the first match
 * fails, the next is attempted. If all fail, the patch reports failure so
 * the UI can warn the user.
 *
 * Last verified: 2026-09-30 (Perforce build unknown, properties: TBDAVQ, PSHQNJ, etc.)
 *
 * 5.51.0: also the four wrapper functions TABS V2 calls (formerly supplied by the
 * separate "infernal wrapper" userscript, NetquiK 1.52): Battleground.get_Simulation,
 * <simulation class>.DoStep, CityUnits.get_OffenseUnits and get_DefenseUnits. Defined on
 * the same globals with the same names, so TABS finds them without changes. Own
 * implementation; the wrapper's two regexes are the first fingerprint of each.
 *
 * 5.52.0: the wrapper's `window.phe = webfrontend.phe` too (globalizePhe below).
 * Its `System = $I` / `SharedLib = $I` are left out on purpose: no script we know
 * (SoO pack, MehrStrom, TAMap, TABS) uses them in code, only in comments and log text.
 */

// Any JS identifier (obfuscated names have been [A-Z]{6}, but don't rely on it in fallbacks).
const ID = '[A-Za-z_$][\\w$]*';

/**
 * Make `phe` a global, as the infernal wrapper did. Since game 22.3, phe only lives at
 * `webfrontend.phe`; many scripts (SoO pack, MehrStrom combat / CY optimizer, TAMap) still
 * call a bare `phe.cnc.Util...` and throw a ReferenceError without it.
 *
 * Started before Shockr waits for the game, so phe is global as early as possible. Polls
 * until webfrontend.phe exists, at most `maxAttempts` times - never forever: a client
 * without webfrontend.phe gives up and the caller reports it in chat. 200 x 100 ms = the
 * same 20 s horizon as waitForGame: if the game is not there by then, Shockr stops anyway.
 * An existing global `phe` (the game's own, or the wrapper still installed) is kept.
 *
 * @param {{ maxAttempts?: number, intervalMs?: number, root?: object }} [opts]
 * @returns {Promise<'existing'|'set'|false>}
 */
export function globalizePhe({ maxAttempts = 200, intervalMs = 100, root = globalThis } = {}) {
    const attempt = () => {
        if (typeof root.phe !== 'undefined') return 'existing';
        const phe = root.webfrontend?.phe;
        if (typeof phe === 'undefined') return null;
        root.phe = phe;
        return 'set';
    };
    return new Promise(resolve => {
        let tries = 0;
        const tick = () => {
            let r = null;
            try { r = attempt(); } catch { /* webfrontend half-loaded: try again */ }
            if (r) return resolve(r);
            if (++tries >= maxAttempts) return resolve(false);
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

/**
 * Find an obfuscated property name by scanning a prototype's function bodies.
 *
 * @param {object} proto — the prototype to scan
 * @param {string} funcName — function to look in (e.g. '$ctor', 'HasUnitMdbId')
 * @param {RegExp[]} patterns — regexes to try; capture group (default 1) = property name
 * @param {number} [matchGroup=1] — which capture group holds the property name
 * @returns {string|null} the obfuscated property name, or null
 */
function findInFunction(proto, funcName, patterns, matchGroup = 1) {
    const func = proto[funcName];
    if (typeof func !== 'function') return null;
    const src = func.toString();

    for (const re of patterns) {
        const m = src.match(re);
        if (m && m[matchGroup]) return m[matchGroup];
    }
    return null;
}

/**
 * Like findInFunction, but on a source string and returning the whole match of the first
 * pattern that passes `accept`, so one fingerprint can yield several names.
 *
 * @param {string} src — function source
 * @param {RegExp[]} patterns
 * @param {(m: RegExpMatchArray) => boolean} [accept]
 * @returns {RegExpMatchArray|null}
 */
function matchSource(src, patterns, accept = () => true) {
    for (const re of patterns) {
        const m = src.match(re);
        if (m && accept(m)) return m;
    }
    return null;
}

/**
 * Find a function in a prototype whose body contains a given string.
 *
 * @param {object} proto
 * @param {string} searchFor — string to look for in function body
 * @returns {{ name: string, src: string }|null}
 */
function findFunctionByContent(proto, searchFor) {
    for (const name of Object.keys(proto)) {
        if (typeof proto[name] !== 'function') continue;
        const src = proto[name].toString();
        if (src.includes(searchFor)) return { name, src };
    }
    return null;
}

/**
 * Define a getter on a prototype that maps a readable name to the obfuscated one.
 */
function defineGetter(proto, publicName, obfuscatedName) {
    if (typeof proto[publicName] !== 'undefined') return;
    Object.defineProperty(proto, publicName, {
        configurable: true,
        get() { return this[obfuscatedName]; }
    });
}

/**
 * Define a method on a prototype that returns the obfuscated field — the shape the old
 * wrapper used (`get_OffenseUnits()`), which TABS calls. A method that already exists
 * (the game's own, or the infernal wrapper's when it is still installed) is kept.
 */
function defineFieldMethod(proto, publicName, obfuscatedName) {
    if (typeof proto[publicName] === 'function') return;
    proto[publicName] = function () { return this[obfuscatedName]; };
}

/**
 * Apply all patch definitions and return results.
 * @param {object[]} patches
 * @returns {Array<{ name: string, ok: boolean, failed?: string[], matched?: object }>}
 */
export function applyPatches(patches) {
    return patches.map(patch => {
        const result = { name: patch.name, ok: true, failed: [], matched: {} };

        let proto;
        try {
            proto = patch.getProto();
        } catch (err) {
            return { name: patch.name, ok: false, error: `prototype not found: ${err.message}` };
        }

        for (const prop of patch.properties) {
            if (prop.resolver) {
                try {
                    const resolved = prop.resolver(proto);
                    if (resolved !== false) {
                        result.matched[prop.publicName] = resolved || '(custom)';
                    } else {
                        result.ok = false;
                        result.failed.push(prop.publicName);
                    }
                } catch {
                    result.ok = false;
                    result.failed.push(prop.publicName);
                }
            } else {
                const obfName = findInFunction(
                    proto,
                    prop.funcName || '$ctor',
                    prop.patterns,
                    prop.matchGroup || 1
                );
                if (obfName) {
                    if (prop.kind === 'method') defineFieldMethod(proto, prop.publicName, obfName);
                    else defineGetter(proto, prop.publicName, obfName);
                    result.matched[prop.publicName] = obfName;
                } else {
                    result.ok = false;
                    result.failed.push(prop.publicName);
                }
            }
        }

        return result;
    });
}

// ─── Shared fingerprints ────────────────────────────────────────────

// CityUnits.HasUnitMdbId walks two collections: offense first (group 1), defense second (group 2).
const UNIT_PATTERNS = [
    // 2026-09: for(t in{d:this.TBXDNO}...for(i in{d:this.IPEJRQ}
    /\{d:this\.([A-Z]{6})\}\.d\.d\).*\{d:this\.([A-Z]{6})\}/,
    // infernal wrapper 1.52: for(.+a:this.XXXX...a:this.YYYY
    /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/,
    // any name length, whitespace and newlines allowed: {d: this.X} ... {d: this.Y}
    new RegExp(String.raw`\{\s*\w+\s*:\s*this\.(${ID})\s*\}[\s\S]*\{\s*\w+\s*:\s*this\.(${ID})\s*\}`),
];

// Battleground.StartBattle creates the combat simulation and steps it:
//   this.<field>=(new $I.<SimClass>) ... {this.<field>.<step>(!1)
// Groups: 1 = field (get_Simulation), 2 = $I class, 3 = step method (DoStep).
// Greedy on purpose, as the wrapper: the LAST such call in the function is taken.
const SIM_PATTERNS = [
    // infernal wrapper 1.52 (game 22.x and later)
    /this\.([a-zA-Z]+)=\(new \$I\.([a-zA-Z]+)\)\..+\{this\.\1\.([a-zA-Z]+)\((?:false|!1)\)/,
    // optional parentheses around `new`, whitespace, newlines, any identifier
    new RegExp(String.raw`this\.(${ID})\s*=\s*\(?\s*new\s+\$I\.(${ID})\s*\)?[\s\S]+\{\s*this\.\1\.(${ID})\(\s*(?:false|!1|0)\s*\)`),
    // the step call not right after `{` (e.g. `;this.X.Y(!1)` or `while(this.X.Y(!1))`)
    new RegExp(String.raw`this\.(${ID})\s*=\s*\(?\s*new\s+\$I\.(${ID})\s*\)?[\s\S]+[;,(&|]\s*this\.\1\.(${ID})\(\s*(?:false|!1|0)\s*\)`),
];

/**
 * Locate the simulation field, its $I class and its step method on the Battleground
 * prototype: StartBattle first; if that no longer matches (renamed or restructured),
 * every other Battleground function. A match only counts when the step method really
 * is a function on `$I[class].prototype`.
 *
 * @returns {{ field: string, cls: string, step: string }|null}
 */
export function findSimulation(proto) {
    const lib = typeof $I !== 'undefined' ? $I : null;
    const accept = m => typeof lib?.[m[2]]?.prototype?.[m[3]] === 'function';
    const names = ['StartBattle', ...Object.keys(proto).filter(n => n !== 'StartBattle')];
    for (const name of names) {
        let fn;
        try { fn = proto[name]; } catch { continue; }
        if (typeof fn !== 'function') continue;
        const src = fn.toString();
        if (!src.includes('$I.')) continue;
        const m = matchSource(src, SIM_PATTERNS, accept);
        if (m) return { field: m[1], cls: m[2], step: m[3] };
    }
    return null;
}

// ─── Patch definitions ──────────────────────────────────────────────
//
// Patterns are ordered newest-first. When the game client updates and
// shifts property names, add new patterns at the TOP. Old ones stay
// as fallback for players on older client versions.
//
// Last verified: 2026-09-30
// ─────────────────────────────────────────────────────────────────────

export const PATCHES = [
    {
        name: 'WorldObjectNPCCamp',
        getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCCamp.prototype,
        properties: [
            {
                publicName: '$CampType',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: this.TBDAVQ=e>>22&$I.YKSGFB.Event
                    /this\.([A-Z]{6})=e>>22&/,
                    // older: this.XXXX=(*e*>>(22|0x16))
                    /this\.([A-Z]{6})=\(*[a-z]\>?>>(22|0x16)\)?/,
                ],
            },
            {
                publicName: '$Level',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: this.PSHQNJ=Math.floor(Math.floor(this.NXRIFD+.5))
                    /this\.([A-Z]{6})=Math\.floor\(Math\.floor\(/,
                    // older: this.XXXX=(((e>>4...
                    /this\.([A-Z]{6})=\(\(?\(?[a-z]>>>?4/,
                ],
            },
            {
                publicName: '$Id',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: first unconditional JTCQOG after conditionals
                    // o&&(...),this.YQTCJB=(u.$r=
                    /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
                    // older: &.*=-1,}?this.XXXX=(
                    /\&.*=-1[,;]\}?this\.([A-Z]{6})=\(/,
                ],
            },
        ],
    },

    {
        name: 'WorldObjectNPCBase',
        getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCBase.prototype,
        properties: [
            {
                publicName: '$Level',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: this.YPKZKK=Math.floor(Math.floor(this.HUTUEI+.5))
                    /this\.([A-Z]{6})=Math\.floor\(Math\.floor\(/,
                    /this\.([A-Z]{6})=\(\(?\(?[a-z]>>>?4/,
                ],
            },
            {
                publicName: '$Id',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: first unconditional JTCQOG — this.NZFAHM=(u.$r=
                    /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
                    /.*[a-z][;,]this\.([A-Z]{6})=\(/,
                ],
            },
        ],
    },

    {
        name: 'WorldObjectCity',
        getProto: () => ClientLib.Data.WorldSector.WorldObjectCity.prototype,
        properties: [
            // $PlayerId / $AllianceId removed in 5.31.0: seen live (2026-10-29) the field
            // matched as $PlayerId was a small index (e>>22&1023) and the one matched as
            // $AllianceId held the PLAYER id. Use the region vis object's
            // get_PlayerId() / get_AllianceId() instead (base-info, tunnel-poi-analyzer).
            {
                publicName: '$Id',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: first unconditional JTCQOG
                    /\),this\.([A-Z]{6})=\(u\.\$r=\$I\.[A-Z]{6}\.JTCQOG/,
                    /.*[a-z]\+=[a-z][;,]this\.([A-Z]{6})=\(.*[a-z]\+=[a-z].*[a-z]\+=/,
                ],
            },
        ],
    },

    {
        name: 'CityUnits',
        getProto: () => ClientLib.Data.CityUnits.prototype,
        properties: [
            {
                publicName: '$OffenseUnits',
                funcName: 'HasUnitMdbId',
                patterns: UNIT_PATTERNS,
                matchGroup: 1,  // first collection = offense
            },
            {
                publicName: '$DefenseUnits',
                funcName: 'HasUnitMdbId',
                patterns: UNIT_PATTERNS,
                matchGroup: 2,  // second collection = defense
            },
            // 5.51.0: wrapper methods for TABS — city.get_CityUnitsData().get_OffenseUnits().d
            {
                publicName: 'get_OffenseUnits',
                kind: 'method',
                funcName: 'HasUnitMdbId',
                patterns: UNIT_PATTERNS,
                matchGroup: 1,
            },
            {
                publicName: 'get_DefenseUnits',
                kind: 'method',
                funcName: 'HasUnitMdbId',
                patterns: UNIT_PATTERNS,
                matchGroup: 2,
            },
        ],
    },

    // 5.51.0: wrapper functions for TABS — bG.get_Simulation().DoStep(false)
    {
        name: 'Battleground',
        getProto: () => ClientLib.Vis.Battleground.Battleground.prototype,
        properties: [
            {
                publicName: 'get_Simulation',
                resolver(proto) {
                    const sim = findSimulation(proto);
                    if (!sim) return false;
                    defineFieldMethod(proto, 'get_Simulation', sim.field);
                    return sim.field;
                },
            },
            {
                publicName: 'DoStep',
                resolver(proto) {
                    const sim = findSimulation(proto);
                    if (!sim) return false;
                    const simProto = $I[sim.cls].prototype;
                    if (typeof simProto.DoStep !== 'function') simProto.DoStep = simProto[sim.step];
                    return `$I.${sim.cls}.prototype.${sim.step}`;
                },
            },
        ],
    },

    {
        name: 'CommunicationManager',
        getProto: () => ClientLib.Net.CommunicationManager.prototype,
        properties: [
            {
                publicName: '$Poll',
                resolver(proto) {
                    // Find the function whose body contains '"Poll"'
                    const fn = findFunctionByContent(proto, '"Poll"');
                    if (!fn) return null;
                    // The function name itself is the alias
                    // Define it as a direct method alias
                    if (typeof proto['$Poll'] === 'undefined') {
                        proto['$Poll'] = proto[fn.name];
                    }
                    return null; // skip defineGetter, we did it manually
                },
            },
        ],
    },
];
