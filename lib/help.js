/**
 * help.js — `/st help` text, built from the registered plugins and commands.
 *
 * Rendered as one monospace chat block so the columns line up. Plugins are
 * listed by their hyphenated name (CampTracker → camp-tracker, which
 * `/st plugin enable` accepts) with their translated `description`.
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
 * @param {string} version
 * @param {Array<{name: string, description?: string}>} plugins
 * @param {object} commands — Cli.commands (registered command names)
 * @returns {string} HTML for chatMessage
 */
export function buildHelp(version, plugins, commands) {
    const row = (left, right, indent = 2) => ' '.repeat(indent) + left.padEnd(COL - indent) + ' ' + right;
    const section = (title) => ['', `  ${title}`, `  ${'─'.repeat(title.length)}`];

    const names = plugins.map(p => kebab(p.name));
    const nameWidth = Math.max(...names.map(n => n.length)) + 1;

    const lines = [
        RULE,
        `  ${t('helpHeader', { version })}`,
        RULE,
        ...section(t('helpPlugins')),
        row('/st plugin enable <name>', t('helpEnable')),
        row('/st plugin disable <name>', t('helpDisable')),
        '',
        `  ${t('helpAvailablePlugins')}`,
        ...plugins.map((p, i) => `    ${names[i].padEnd(nameWidth)}— ${p.description || ''}`),
    ];

    const tools = TOOL_COMMANDS.filter(c => commands[c.cmd]);
    if (tools.length) {
        lines.push(...section(t('helpTools')));
        for (const c of tools) lines.push(row(c.usage, t(c.key)));
    }

    lines.push(
        ...section(t('helpSettings')),
        row('/st config set <key> <val>', t('helpConfigSet')),
        row('/st config get <key>', t('helpConfigGet')),
        row('/st config list', t('helpConfigList')),
        row('/st status', t('helpStatus')),
        row('/st version', t('helpVersion')),
        '',
        `  ${t('helpUsefulSettings')}`,
        ...USEFUL_SETTINGS.map(([key, desc]) => row(key, t(desc), 4)),
        '',
        row('/st help', t('helpHelp')),
        RULE,
    );

    const body = lines.map(escapeHtml).join('<br>');
    return `<span style="font-family:Consolas,'Courier New',monospace;white-space:pre;">${body}</span>`;
}

/** CampTracker → camp-tracker */
export function kebab(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
