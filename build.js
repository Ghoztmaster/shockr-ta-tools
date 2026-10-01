#!/usr/bin/env node
/**
 * build.js — bundles lib/ + plugins/ into dist/shockr-ta-tools.user.js
 *
 * Usage: node build.js
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const VERSION = '5.3.0';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name            Shockr - Tiberium Alliances Tools
// @author          Ghozt [SoO] (original: Shockr, fixed by NetquiK [SoO])
// @description     Camp tracker, kill info, player status, alliance recon & upgrade calculator for C&C Tiberium Alliances
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @grant           none
// @version         ${VERSION}
// @homepage        https://github.com/Ghoztmaster/shockr-ta-tools
// ==/UserScript==
`;

async function build() {
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

    const result = await esbuild.build({
        entryPoints: ['lib/main.js'],
        bundle: true,
        format: 'iife',
        globalName: 'ShockrTools',
        outfile: 'dist/shockr-ta-tools.user.js',
        target: 'es2020',
        minify: false,          // readable output for debugging
        sourcemap: false,
        write: false,
    });

    const code = result.outputFiles[0].text;
    const output = USERSCRIPT_HEADER + '\n' + code;
    fs.writeFileSync('dist/shockr-ta-tools.user.js', output, 'utf8');

    console.log(`[build] shockr-ta-tools v${VERSION} → dist/shockr-ta-tools.user.js (${(output.length / 1024).toFixed(1)} kB)`);
}

build().catch(err => {
    console.error('[build] FAILED:', err);
    process.exit(1);
});
