/**
 * help.js — `/st help` content, built from the registered plugins and commands.
 *
 * getHelpModel() collects the (translated) content once; two renderers show it:
 *   - buildHelp()      — one monospace chat block so the columns line up
 *   - buildHelpPanel() — HTML for the popup panel (help-panel.js)
 * Plugins are listed by their hyphenated name (CampTracker → camp-tracker,
 * which `/st plugin enable` accepts) with their translated `description`.
 */
import { t, escapeHtml } from './i18n.js';

const RULE = '═'.repeat(44);
const COL = 30;

/** Plugin commands shown under "Tools" — only when that plugin registered them. */
const TOOL_COMMANDS = [
    { cmd: 'plunder', usage: '/st plunder', key: 'helpCmdPlunder' },
    { cmd: 'scan', usage: '/st scan', key: 'helpCmdScan' },
    { cmd: 'scanalliance', usage: '/st scanalliance', key: 'helpCmdScanAlliance' },
];

const USEFUL_SETTINGS = [
    ['language', 'helpSetLanguage'],
    ['api.url', 'helpSetApiUrl'],
    ['api.key', 'helpSetApiKey'],
    ['UpgradeCalc.buttonLeft', 'helpSetButtonLeft'],
    ['UpgradeCalc.buttonTop', 'helpSetButtonTop'],
];

/**
 * Help content as data: sections of [command, description] rows, each with an
 * optional sub-list (available plugins / useful settings).
 * @param {string} version
 * @param {Array<{name: string, description?: string}>} plugins
 * @param {object} commands — Cli.commands (registered command names)
 */
export function getHelpModel(version, plugins, commands) {
    const sections = [{
        title: t('helpPlugins'),
        rows: [
            ['/st plugin enable <name>', t('helpEnable')],
            ['/st plugin disable <name>', t('helpDisable')],
        ],
        sub: {
            kind: 'plugins',
            title: t('helpAvailablePlugins'),
            rows: plugins.map(p => [kebab(p.name), p.description || '']),
        },
    }];

    const tools = TOOL_COMMANDS.filter(c => commands[c.cmd]);
    if (tools.length) {
        sections.push({ title: t('helpTools'), rows: tools.map(c => [c.usage, t(c.key)]) });
    }

    sections.push({
        title: t('helpSettings'),
        rows: [
            ['/st config set <key> <val>', t('helpConfigSet')],
            ['/st config get <key>', t('helpConfigGet')],
            ['/st config list', t('helpConfigList')],
            ['/st register', t('helpRegister')],
            ['/st status', t('helpStatus')],
            ['/st version', t('helpVersion')],
        ],
        sub: {
            kind: 'settings',
            title: t('helpUsefulSettings'),
            rows: USEFUL_SETTINGS.map(([key, desc]) => [key, t(desc)]),
        },
    });

    return {
        header: t('helpHeader', { version }),
        sections,
        footer: ['/st help', t('helpHelp')],
    };
}

/** Chat rendering: one monospace block. @returns {string} HTML for chatMessage */
export function buildHelp(version, plugins, commands) {
    const model = getHelpModel(version, plugins, commands);
    const row = ([left, right], indent = 2) => ' '.repeat(indent) + left.padEnd(COL - indent) + ' ' + right;

    const lines = [RULE, `  ${model.header}`, RULE];
    for (const section of model.sections) {
        lines.push('', `  ${section.title}`, `  ${'─'.repeat(section.title.length)}`);
        lines.push(...section.rows.map(r => row(r)));
        if (section.sub) {
            lines.push('', `  ${section.sub.title}`);
            if (section.sub.kind === 'plugins') {
                const nameWidth = Math.max(...section.sub.rows.map(([name]) => name.length)) + 1;
                lines.push(...section.sub.rows.map(([name, desc]) => `    ${name.padEnd(nameWidth)}— ${desc}`));
            } else {
                lines.push(...section.sub.rows.map(r => row(r, 4)));
            }
        }
    }
    lines.push('', row(model.footer), RULE);

    const body = lines.map(escapeHtml).join('<br>');
    return `<span style="font-family:Consolas,'Courier New',monospace;white-space:pre;">${body}</span>`;
}

/** Popup rendering: sections with headings and command | description tables. @returns {string} HTML */
export function buildHelpPanel(version, plugins, commands) {
    const model = getHelpModel(version, plugins, commands);
    const mono = "font-family:Consolas,'Courier New',monospace;";
    // Column width + mobile stacking come from the panel stylesheet (help-panel.js, .st-cmd / .st-sub)
    const cmdCell = `padding:2px 12px 2px 0;${mono}font-size:12px;color:#81d4fa;white-space:nowrap;vertical-align:top;`;
    const descCell = 'padding:2px 0;color:#999;vertical-align:top;';
    const table = (rows, sub = false) =>
        `<table class="${sub ? 'st-sub' : ''}" style="border-collapse:collapse;">`
        + rows.map(([cmd, desc]) =>
            `<tr><td class="st-cmd" style="${cmdCell}">${escapeHtml(cmd)}</td><td style="${descCell}">${escapeHtml(desc)}</td></tr>`).join('')
        + '</table>';
    const heading = (text) =>
        `<div style="margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #444;color:#fff;font-weight:bold;">${escapeHtml(text)}</div>`;

    let html = `<div style="font-size:14px;font-weight:bold;color:#fff;">${escapeHtml(model.header)}</div>`;
    for (const section of model.sections) {
        html += heading(section.title) + table(section.rows);
        if (section.sub) {
            html += `<div style="margin:8px 0 2px;color:#bbb;">${escapeHtml(section.sub.title)}</div>`
                + table(section.sub.rows, true);
        }
    }
    html += `<div style="margin-top:12px;padding-top:6px;border-top:1px solid #444;">${table([model.footer])}</div>`;
    html += `<div style="margin-top:6px;color:#777;font-size:11px;">${escapeHtml(t('helpCloseHint'))}</div>`;
    return html;
}

/** CampTracker → camp-tracker */
export function kebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
