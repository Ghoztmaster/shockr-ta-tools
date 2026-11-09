// Chat enrichment (lib/chat-enrich.js): url / mention segments, url safety, colour setting.
// The DOM part (enrich) was verified live on a copy of the real chat (CHANGELOG 5.48.0).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = await esbuild.build({
    stdin: { contents: `export * from './lib/chat-enrich.js';`, resolveDir: root },
    bundle: true, format: 'esm', write: false,
});
const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));

test('segments: url (trailing punctuation off) and mention, case-insensitive, whole word only', () => {
    const s = mod.segments('hi GHOZTMASTERS, see https://example.com/a?b=1. ok', { name: 'GhoztMasters' });
    assert.deepEqual(s, [
        { type: 'text', value: 'hi ' },
        { type: 'mention', value: 'GHOZTMASTERS' },
        { type: 'text', value: ', see ' },
        { type: 'url', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
        { type: 'text', value: '. ok' },
    ]);
    assert.deepEqual(mod.segments('xGhoztMasters2 ghoztmasters_x', { name: 'GhoztMasters' }), [{ type: 'text', value: 'xGhoztMasters2 ghoztmasters_x' }]);
});

test('segments: linkify off, no name, a name with regex characters, a name inside a url', () => {
    assert.deepEqual(mod.segments('https://a.b', { linkify: false }), [{ type: 'text', value: 'https://a.b' }]);
    assert.deepEqual(mod.segments('plain text'), [{ type: 'text', value: 'plain text' }]);
    assert.deepEqual(mod.segments('yo [x]+y!', { name: '[x]+y' }).map(p => p.type), ['text', 'mention', 'text']);
    assert.deepEqual(mod.segments('https://site/bob', { name: 'bob' }).map(p => p.type), ['url']);
});

test('safeUrl: only http(s); javascript:, data: and junk are refused; not linked', () => {
    assert.equal(mod.safeUrl('https://x.y/z'), 'https://x.y/z');
    assert.equal(mod.safeUrl('http://x.y'), 'http://x.y/');
    assert.equal(mod.safeUrl('javascript:alert(1)'), null);
    assert.equal(mod.safeUrl('data:text/html,hi'), null);
    assert.equal(mod.safeUrl('nope'), null);
    assert.deepEqual(mod.segments('javascript:alert(1) data:x').map(p => p.type), ['text']);
});

test('mentionColor: default yellow, hex and colour words, none/off/empty = off, junk = default', () => {
    assert.equal(mod.mentionColor(undefined), '#ffff00');
    assert.equal(mod.mentionColor('#f80'), '#f80');
    assert.equal(mod.mentionColor('#ff8800'), '#ff8800');
    assert.equal(mod.mentionColor('orange'), 'orange');
    assert.equal(mod.mentionColor('none'), null);
    assert.equal(mod.mentionColor('OFF'), null);
    assert.equal(mod.mentionColor(''), null);
    assert.equal(mod.mentionColor('red;background:url(x)'), '#ffff00');
});
