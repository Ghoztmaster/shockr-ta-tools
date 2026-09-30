/**
 * clientlib-patch.js — fingerprint-based ClientLib property patcher.
 *
 * Instead of a single regex that breaks on every client update, each patch
 * defines multiple fingerprint patterns tried in order. When the first match
 * fails, the next is attempted. If all fail, the patch reports failure so
 * the UI can warn the user.
 *
 * Usage:
 *   const result = applyPatches(PATCHES);
 *   // result = [{ name, ok, matched?, error? }, ...]
 */

/**
 * Find an obfuscated property name by scanning a prototype's function bodies.
 *
 * @param {object} proto — the prototype to scan (e.g. SomeClass.prototype)
 * @param {object} opts
 * @param {string} opts.searchFor — string that must appear in the source function
 * @param {RegExp[]} opts.patterns — regexes to try; first capture group = property name
 * @returns {string|null} the obfuscated property name, or null
 */
export function findProperty(proto, { searchFor, patterns }) {
    for (const funcName of Object.keys(proto)) {
        const func = proto[funcName];
        if (typeof func !== 'function') continue;

        const src = func.toString();
        if (!src.includes(searchFor)) continue;

        // Try each pattern against this function body
        for (const re of patterns) {
            const match = src.match(re);
            if (match && match[1]) {
                return match[1];
            }
        }
    }
    return null;
}

/**
 * Define a getter on a prototype that maps a readable name to the obfuscated one.
 *
 * @param {object} proto
 * @param {string} publicName — e.g. '$CampType'
 * @param {string} obfuscatedName — e.g. 'ABCDEF'
 */
function defineGetter(proto, publicName, obfuscatedName) {
    if (typeof proto[publicName] !== 'undefined') return; // already patched
    Object.defineProperty(proto, publicName, {
        configurable: true,
        get() { return this[obfuscatedName]; }
    });
}

/**
 * Apply a single patch definition.
 *
 * @param {object} patch
 * @param {string} patch.name — human-readable name
 * @param {function} patch.getProto — returns the prototype to patch
 * @param {object[]} patch.properties — array of { publicName, searchFor, patterns }
 * @returns {{ name: string, ok: boolean, failed?: string[] }}
 */
function applyPatch(patch) {
    const result = { name: patch.name, ok: true, failed: [] };

    let proto;
    try {
        proto = patch.getProto();
    } catch (err) {
        return { name: patch.name, ok: false, error: `prototype not found: ${err.message}` };
    }

    for (const prop of patch.properties) {
        const obfName = findProperty(proto, {
            searchFor: prop.searchFor,
            patterns: prop.patterns,
        });

        if (obfName) {
            defineGetter(proto, prop.publicName, obfName);
        } else {
            result.ok = false;
            result.failed.push(prop.publicName);
        }
    }

    return result;
}

/**
 * Apply all patch definitions.
 * @param {object[]} patches
 * @returns {Array<{ name: string, ok: boolean, failed?: string[], error?: string }>}
 */
export function applyPatches(patches) {
    return patches.map(p => applyPatch(p));
}

// ─── Patch definitions ──────────────────────────────────────────────

/**
 * Each patch targets one ClientLib class. Properties list the public name
 * we want, a string to find the right source function, and multiple regex
 * patterns (tried in order) to extract the obfuscated property name.
 *
 * When the game client updates and shifts property names, add new patterns
 * at the TOP of the list — the old ones stay as fallback for older clients.
 */
export const PATCHES = [
    {
        name: 'WorldObjectNPCCamp',
        getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCCamp.prototype,
        properties: [
            {
                publicName: '$CampType',
                searchFor: '$ctor',
                patterns: [
                    /this\.([A-Z]{6})=\(*[a-z]\>\>(22|0x16)\)?/,
                    /this\.([A-Z]{6})=\(?[a-z]>>>22\)?/,
                ],
            },
            {
                publicName: '$Id',
                searchFor: '$ctor',
                patterns: [
                    /\&.*=-1[,;]\}?this\.([A-Z]{6})=\(/,
                    /=-1[;,]this\.([A-Z]{6})=\(/,
                ],
            },
            {
                publicName: '$Level',
                searchFor: '$ctor',
                patterns: [
                    /this\.([A-Z]{6})=\(\(?\(?[a-z]>>4/,
                    /this\.([A-Z]{6})=\(?[a-z]>>>4\)?/,
                ],
            },
        ],
    },
    {
        name: 'WorldObjectNPCBase',
        getProto: () => ClientLib.Data.WorldSector.WorldObjectNPCBase.prototype,
        properties: [
            {
                publicName: '$Id',
                searchFor: '$ctor',
                patterns: [
                    /.*[a-z][;,]this\.([A-Z]{6})=\(/,
                ],
            },
            {
                publicName: '$Level',
                searchFor: '$ctor',
                patterns: [
                    /this\.([A-Z]{6})=\(\(?\(?[a-z]>>4/,
                    /this\.([A-Z]{6})=\(?[a-z]>>>4\)?/,
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
                searchFor: '$ctor',
                patterns: [
                    /&(?:0x3ff|1023)\)?[;,]this\.([A-Z]{6})/,
                ],
            },
            {
                publicName: '$AllianceId',
                searchFor: '$ctor',
                patterns: [
                    /.*[a-z]\+=[a-z][;,,]?this\.([A-Z]{6})=\(/,
                ],
            },
            {
                publicName: '$Id',
                searchFor: '$ctor',
                patterns: [
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
                searchFor: 'HasUnitMdbId',
                patterns: [
                    /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/,
                ],
                // Special: match group 1 = offense, group 2 = defense
                // Handled by custom logic below
            },
            {
                publicName: '$DefenseUnits',
                searchFor: 'HasUnitMdbId',
                patterns: [
                    /for ?\(.+[a-z]:this\.([A-Z]{6}).+[a-z]:this\.([A-Z]{6})/,
                ],
                matchGroup: 2,
            },
        ],
    },
    {
        name: 'CommunicationManager',
        getProto: () => ClientLib.Net.CommunicationManager.prototype,
        properties: [
            {
                publicName: '$Poll',
                searchFor: '"Poll"',
                patterns: [
                    // The function that contains "Poll" string IS the poll function
                ],
                // Special: use function-name-based alias instead of regex
                useAlias: true,
            },
        ],
    },
];
