/**
 * The Grok Bot plugin folder (`plugins/grokbot`), a Cursor Plugin: the manifest and `mcp.json` follow
 * the Cursor plugin reference (cursor.com/docs/reference/plugins and the schema in the cursor/plugins
 * repository), the skills and the single-file server are current, there are no hooks, every file is
 * documented, no site address is written into it, and the server starts the way the host starts it
 * (`${CURSOR_PLUGIN_ROOT}` and the variables filled in, or left unfilled with a saved login) and answers
 * as the Grok Bot harness with push off.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPlugin, type PluginSession } from '../conformance/run.ts';
import {
  grokbotAuthorAFlowSkill,
  grokbotAuthorSkillPath,
  grokbotRoot,
  grokbotSkillPath,
  grokbotWorkAQueueSkill,
  listPluginFiles,
  repoRoot,
} from '../scripts/agent-interface.ts';
import { bundlePath, bundleText, grokbotBundlePath } from '../scripts/bundle.ts';
import { saveLogin } from '../src/config.ts';
import { tools } from '../src/tools/index.ts';
import { PLUGIN_VERSION } from '../src/version.ts';
import { type FakeSite, KEY, startFakeSite } from './fake-site.ts';
import { tempDir } from './harness.ts';

/** A placeholder such as `${name}`, as the plugin files write it. */
const fill = (name: string) => ['$', '{', name, '}'].join('');

const json = <T = Record<string, unknown>>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

interface Manifest {
  name: string;
  version: string;
  skills: string;
  mcpServers: string;
  hooks?: unknown;
  variables: {
    type: string;
    properties: Record<string, { type: string; title: string; writeOnly?: boolean; format?: string }>;
    required?: string[];
  };
  [field: string]: unknown;
}
interface McpServer {
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const manifest = json<Manifest>(join(grokbotRoot, '.cursor-plugin/plugin.json'));
const mcp = json<{ mcpServers: Record<string, McpServer> }>(join(grokbotRoot, 'mcp.json'));

/** The top-level fields of `.cursor-plugin/plugin.json` (schemas/plugin.schema.json in cursor/plugins; it allows no others). */
const MANIFEST_FIELDS = [
  'name',
  'displayName',
  'description',
  'version',
  'minClientVersions',
  'author',
  'publisher',
  'homepage',
  'repository',
  'license',
  'logo',
  'keywords',
  'category',
  'tags',
  'commands',
  'agents',
  'skills',
  'rules',
  'hooks',
  'variables',
  'mcpServers',
];

describe('the Grok Bot plugin manifest follows the Cursor plugin format', () => {
  it('has a valid name and version, and only fields the manifest schema allows', () => {
    expect(manifest.name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    expect(manifest.name).toBe('workflow-agent');
    expect(manifest.version).toBe(PLUGIN_VERSION);
    for (const field of Object.keys(manifest)) expect(MANIFEST_FIELDS, field).toContain(field);
  });

  it('points only at relative paths inside the folder that exist', () => {
    for (const path of [manifest.skills, manifest.mcpServers]) {
      expect(path).toMatch(/^\.\//);
      expect(path).not.toContain('..');
      expect(existsSync(join(grokbotRoot, path))).toBe(true);
    }
  });

  it('declares the site address and the key as variables, the key entered masked, neither required', () => {
    expect(manifest.variables.type).toBe('object');
    expect(Object.keys(manifest.variables.properties).sort()).toEqual(['WF_AGENT_KEY', 'WF_SITE']);
    expect(manifest.variables.properties.WF_AGENT_KEY).toMatchObject({ type: 'string', writeOnly: true, format: 'password' });
    expect(manifest.variables.properties.WF_SITE?.writeOnly).toBeUndefined();
    // A login saved with `wf-agent login` must be enough (INSTALL.md, Option 2), as in the Claude Code plugin.
    expect(manifest.variables.required ?? []).toEqual([]);
  });

  it('the marketplace at the repository root lists this folder under the same name', () => {
    const market = json<{ name: string; owner: { name: string }; plugins: { name: string; source: string }[] }>(
      join(repoRoot, '.cursor-plugin/marketplace.json'),
    );
    expect(market.name).toMatch(/^[a-z0-9-]+$/);
    expect(market.owner.name).toBeTruthy();
    expect(market.plugins).toEqual([expect.objectContaining({ name: manifest.name, source: 'plugins/grokbot' })]);
  });
});

describe('the Grok Bot plugin starts one MCP server, with push off', () => {
  it('starts node server/wf-agent.mjs serve with the variables, WF_HARNESS=grokbot and WF_PUSH=off', () => {
    expect(Object.keys(mcp.mcpServers)).toEqual(['workflow']);
    expect(mcp.mcpServers.workflow).toEqual({
      type: 'stdio',
      command: 'node',
      args: [`${fill('CURSOR_PLUGIN_ROOT')}/server/wf-agent.mjs`, 'serve'],
      env: { WF_SITE: fill('WF_SITE'), WF_AGENT_KEY: fill('WF_AGENT_KEY'), WF_HARNESS: 'grokbot', WF_PUSH: 'off' },
    });
  });

  it('declares every variable mcp.json uses in the manifest', () => {
    const used = [...JSON.stringify(mcp).matchAll(/\$\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] as string);
    for (const name of used.filter((n) => n !== 'CURSOR_PLUGIN_ROOT')) expect(Object.keys(manifest.variables.properties)).toContain(name);
  });
});

describe('the Grok Bot plugin installs no hooks, and documents every file', () => {
  it('has no hooks, rules, commands or agents', () => {
    for (const dir of ['hooks', 'rules', 'commands', 'agents']) expect(existsSync(join(grokbotRoot, dir)), dir).toBe(false);
    for (const field of ['hooks', 'rules', 'commands', 'agents']) expect(manifest[field], field).toBeUndefined();
    expect(listPluginFiles(grokbotRoot).some((f) => /(^|\/)hooks?(\/|\.json$)/.test(f))).toBe(false);
  });

  it('lists every file it installs in INSTALL.md, and only those', () => {
    const install = readFileSync(join(grokbotRoot, 'INSTALL.md'), 'utf8');
    const documented = [...install.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] as string);
    expect(documented.sort()).toEqual(listPluginFiles(grokbotRoot));
  });

  it('writes the install steps down and asks for nothing but the site address and the key', () => {
    const install = readFileSync(join(grokbotRoot, 'INSTALL.md'), 'utf8');
    expect(install).toContain('You need two things: the **site address** and the **agent key**.');
    for (const heading of [
      '## Before you start',
      '## Option 1: from Connect apps',
      '## Option 2: custom connector',
      '### Check it works',
      '## For Grok Bot agents',
      '## Getting new work',
      '## Updating',
      '## Removing',
      '## Troubleshooting',
      '## Files it installs',
    ])
      expect(install, heading).toContain(heading);
    expect(install).toContain('wf-agent.mjs login --site https://workflow.example.test');
    expect(install).toContain('WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs check');
    expect(install).toContain('WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs serve');
    expect(install).not.toMatch(/\u2014|\u2013/);
  });

  it('names no site address in the folder (links to the format documentation and this repository aside)', () => {
    for (const file of listPluginFiles(grokbotRoot).filter((f) => !f.endsWith('.mjs'))) {
      const text = readFileSync(join(grokbotRoot, file), 'utf8');
      for (const url of text.match(/https?:\/\/[^\s)"'`]+/g) ?? [])
        expect(url, `${file}: ${url}`).toMatch(
          file === 'README.md'
            ? /^https?:\/\/[^/]*\.example\.test|^https:\/\/cursor\.com\/docs\//
            : file === 'INSTALL.md'
              ? /^https?:\/\/[^/]*\.example\.test|^https:\/\/github\.com\/vantasnerdan\/workflow-system-plugin$/
              : /^https?:\/\/[^/]*\.example\.test|^http:\/\/127\.0\.0\.1/,
        );
    }
  });
});

describe('the Grok Bot plugin ships current generated files', () => {
  it('the skills are current: work-a-queue generated, author-a-flow equal to the Claude Code one', () => {
    expect(readFileSync(grokbotSkillPath, 'utf8')).toBe(grokbotWorkAQueueSkill());
    expect(readFileSync(grokbotAuthorSkillPath, 'utf8')).toBe(grokbotAuthorAFlowSkill());
    expect(grokbotWorkAQueueSkill()).not.toContain('<channel');
    expect(grokbotWorkAQueueSkill()).toContain('push is off');
  });

  it('ships the single-file server built from the current source, the same as the Claude Code one', async () => {
    const text = await bundleText();
    expect(readFileSync(grokbotBundlePath, 'utf8') === text).toBe(true);
    expect(readFileSync(bundlePath, 'utf8') === text).toBe(true);
    // No executable bit is needed: mcp.json and INSTALL.md always start it as `node server/wf-agent.mjs`.
  }, 60_000);
});

describe('the Grok Bot plugin server, started as the host starts it', () => {
  let site: FakeSite;
  beforeAll(async () => {
    site = await startFakeSite();
  });
  afterAll(async () => {
    await site.close();
  });

  /** Starts the server from mcp.json as the host does: `${CURSOR_PLUGIN_ROOT}` and the given variables filled in. */
  async function start(variables: Record<string, string>, env: Record<string, string>): Promise<PluginSession> {
    const server = mcp.mcpServers.workflow as McpServer;
    const expand = (value: string) =>
      value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
        name === 'CURSOR_PLUGIN_ROOT' ? grokbotRoot : (variables[name] ?? whole),
      );
    return connectPlugin({
      // The test's own Node.js 24 stands in for the `node` on the Bot's PATH.
      command: server.command === 'node' ? process.execPath : server.command,
      args: server.args.map(expand),
      env: {
        ...Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, expand(v)])),
        XDG_CONFIG_HOME: tempDir(),
        WF_STATE_DIR: tempDir(),
        ...env,
      },
    });
  }

  it('offers every registry tool under its own name and answers whoami as grokbot, inbox only', async () => {
    const session = await start({ WF_SITE: site.url, WF_AGENT_KEY: KEY }, {});
    try {
      const listed = (await session.client.listTools()).tools.map((t) => t.name);
      expect(listed).toEqual(tools.map((t) => t.name));
      const who = await session.call('whoami');
      expect(who.isError).toBe(false);
      expect(who.text).toContain('Notifications: inbox only (push is turned off with WF_PUSH=off)');
      const queue = await session.call('queue_list');
      expect(queue.isError).toBe(false);
      expect(site.requests.at(-1)?.userAgent).toBe(`wf-plugin/grokbot/${PLUGIN_VERSION}`);
      expect(session.channel).toEqual([]);
    } finally {
      await session.close();
    }
  }, 30_000);

  it('uses the saved login when the host leaves the variables unfilled', async () => {
    const config = tempDir();
    saveLogin(site.url, KEY, { XDG_CONFIG_HOME: config });
    const session = await start({}, { XDG_CONFIG_HOME: config });
    try {
      const who = await session.call('whoami');
      expect(who.isError).toBe(false);
      expect(who.text).toContain(`Site: ${site.url}`);
    } finally {
      await session.close();
    }
  }, 30_000);
});
