#!/usr/bin/env node
/**
 * build.js — bundles lib/ + plugins/ into dist/shockr-ta-tools.user.js
 *
 * Usage: node build.js
 *
 * 5.25.0: the bundle is wrapped in `function __stBundle() {...}` and started by
 * lib/bootstrap.js, which runs in the userscript sandbox (GM storage) and
 * injects the bundle into the page.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const VERSION = '5.26.0';
/**
 * 5.25.0: where Tampermonkey checks for updates (daily by default) and fetches
 * the new version from. An update through this URL keeps the script id and its
 * GM storage (the config mirror); "Import" in the Tampermonkey dashboard does
 * not. Branch `main`, the built file in dist/.
 */
const UPDATE_URL = 'https://raw.githubusercontent.com/Ghoztmaster/shockr-ta-tools/main/dist/shockr-ta-tools.user.js';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name            Shockr - Tiberium Alliances Tools
// @author          Ghozt [SoO] (original: Shockr, fixed by NetquiK [SoO])
// @description     Camp tracker, kill info, player status, alliance recon, upgrade calculator, target watcher, attack tracker, watchlist, base info, attack range, map labels, tunnel info, formation saver, wavy, loot summary, chat helper & PvP alert for C&C Tiberium Alliances
// @match           https://*.alliances.commandandconquer.com/*/index.aspx*
// @grant           GM_getValue
// @grant           GM_setValue
// @version         ${VERSION}
// @homepage        https://github.com/Ghoztmaster/shockr-ta-tools
// @updateURL       ${UPDATE_URL}
// @downloadURL     ${UPDATE_URL}
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
    const bootstrap = fs.readFileSync(path.join(__dirname, 'lib', 'bootstrap.js'), 'utf8');
    const output = USERSCRIPT_HEADER + '\n'
        + '(function () {\n'
        + 'function __stBundle() {\n' + code + '}\n\n'
        + bootstrap + '\n'
        + 'stBootstrap(__stBundle);\n'
        + '})();\n';
    fs.writeFileSync('dist/shockr-ta-tools.user.js', output, 'utf8');

    console.log(`[build] shockr-ta-tools v${VERSION} → dist/shockr-ta-tools.user.js (${(output.length / 1024).toFixed(1)} kB)`);
}

build().catch(err => {
    console.error('[build] FAILED:', err);
    process.exit(1);
});
