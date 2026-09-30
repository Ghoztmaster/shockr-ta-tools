/**
 * clientlib-patch.js — fingerprint-based ClientLib property patcher.
 *
 * Instead of a single regex that breaks on every client update, each patch
 * defines multiple fingerprint patterns tried in order. When the first match
 * fails, the next is attempted. If all fail, the patch reports failure so
 * the UI can warn the user.
 *
 * Last verified: 2026-09-30 (Perforce build unknown, properties: TBDAVQ, PSHQNJ, etc.)
 */

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
                    defineGetter(proto, prop.publicName, obfName);
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
            {
                publicName: '$PlayerId',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: this.PMHSXF=e>>22&1023
                    /this\.([A-Z]{6})=e>>22&(?:1023|0x3ff)/,
                    // older: &(0x3ff|1023))?;this.XXXX
                    /&(?:0x3ff|1023)\)?[;,]this\.([A-Z]{6})/,
                ],
            },
            {
                publicName: '$AllianceId',
                funcName: '$ctor',
                patterns: [
                    // 2026-09: this.YMHXCE=t.KZYIAU(this.PMHSXF)
                    // AllianceId is always a method call on the result of PlayerId
                    /this\.([A-Z]{6})=t\.[A-Z]{6}\(this\.[A-Z]{6}\)/,
                    /.*[a-z]\+=[a-z][;,,]?this\.([A-Z]{6})=\(/,
                ],
            },
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
                patterns: [
                    // 2026-09: for(t in{d:this.TBXDNO}...for(i in{d:this.IPEJRQ}
                    /\{d:this\.([A-Z]{6})\}\.d\.d\).*\{d:this\.([A-Z]{6})\}/,
                    // older: for(.+a:this.XXXX...a:this.YYYY
                    /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/,
                ],
                matchGroup: 1,  // first collection = offense
            },
            {
                publicName: '$DefenseUnits',
                funcName: 'HasUnitMdbId',
                patterns: [
                    // same regex, second capture group
                    /\{d:this\.([A-Z]{6})\}\.d\.d\).*\{d:this\.([A-Z]{6})\}/,
                    /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/,
                ],
                matchGroup: 2,  // second collection = defense
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
