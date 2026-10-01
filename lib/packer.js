/**
 * packer.js — Base62, LayoutPacker, BinaryPacker, UnitPacker.
 *
 * Compatible with the original Shockr format so the server can decode
 * data from both old and new clients.
 */

// ─── Base62 ─────────────────────────────────────────────────────────

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_SEP = '.';
const BASE = BASE62_CHARS.length; // 62

const DECODE_TABLE = {};
for (let i = 0; i < BASE62_CHARS.length; i++) {
    DECODE_TABLE[BASE62_CHARS.charCodeAt(i)] = i;
}

export const Base62 = {
    encode(num, padLength = 0) {
        if (num === 0 && padLength <= 1) return BASE62_CHARS[0];
        const output = [];
        let current = num;
        while (current > 0) {
            output.push(BASE62_CHARS[current % BASE]);
            current = Math.floor(current / BASE);
        }
        while (output.length < padLength) {
            output.push(BASE62_CHARS[0]);
        }
        return output.join('');
    },

    decode(str, offset = 0, maxBytes = 6) {
        let multiplier = 1;
        let value = 0;
        let bytes = 0;
        for (let i = 0; i < maxBytes; i++) {
            bytes++;
            const idx = offset + i;
            if (idx >= str.length) break;
            const code = str.charCodeAt(idx);
            if (code === BASE62_SEP.charCodeAt(0)) break;
            const charValue = DECODE_TABLE[code];
            if (charValue === undefined) break;
            value += multiplier * charValue;
            multiplier *= BASE;
        }
        return { value, bytes };
    },

    /** Pack an array of numbers into a separator-joined string. */
    pack(data) {
        return data.map(n => this.encode(n)).join(BASE62_SEP);
    },

    /** Unpack a separator-joined string into an array of numbers. */
    unpack(str) {
        const output = [];
        let offset = 0;
        while (offset < str.length) {
            const { value, bytes } = this.decode(str, offset);
            output.push(value);
            offset += bytes;
        }
        return output;
    },
};

// ─── LayoutPacker ───────────────────────────────────────────────────

/** Pack a row of 9 resource tiles (3 bits each) into a single number. */
export const LayoutPacker = {
    pack(tiles) {
        let output = 0;
        for (let x = 0; x < tiles.length; x++) {
            output |= (tiles[x] << (3 * x));
        }
        return output;
    },
};

// ─── BinaryPacker ───────────────────────────────────────────────────

/**
 * Pack multiple fields into a single 32-bit number.
 * @param {object} format — { fieldName: bitWidth, ... }
 */
export class BinaryPacker {
    constructor(format) {
        this.fields = [];
        let offset = 0;
        for (const [name, length] of Object.entries(format)) {
            const mask = (1 << length) - 1;
            this.fields.push({ name, length, offset, mask });
            offset += length;
        }
    }

    pack(values) {
        let output = 0;
        for (const field of this.fields) {
            const value = values[field.name] || 0;
            output |= ((value & field.mask) << field.offset);
        }
        return output;
    }
}

// ─── UnitPacker ─────────────────────────────────────────────────────

/** Pack unit position + id + level into a single number. */
export const UnitPacker = new BinaryPacker({ xy: 8, id: 9, level: 7 });

/** Pack x,y into a single xy value for UnitPacker. */
export function packUnitXY(x, y) {
    return y * 9 + x;  // 9 = max X grid width
}
