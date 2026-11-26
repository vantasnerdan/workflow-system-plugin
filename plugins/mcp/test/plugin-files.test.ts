/**
 * The Claude Code plugin folder and the generated files: no hooks, every installed file documented,
 * install steps that need only the site address and the key, the generated documentation, skill and
 * single-file server current, and the plugins importing nothing from the workspace but the client.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  agentInterfaceDoc,
  docPath,
  listPluginFiles,
  pluginFiles,
  pluginsRoot,
  repoRoot,
  skillPath,
  workAQueueSkill,
} from '../scripts/agent-interface.ts';
import { bundlePath, bundleText } from '../scripts/bundle.ts';

/** A harness placeholder such as `${name}`, as the plugin files write it. */
const fill = (name: string) => ['$', '{', name, '}'].join('');

const pluginDir = join(pluginsRoot, 'claude-code');
const json = (path: string) => JSON.parse(readFileSync(join(pluginDir, path), 'utf8')) as Record<string, unknown>;

describe('US-D-33 the plugin installs no hidden hooks', () => {
  it('has no hooks directory and declares no hooks in its manifest', () => {
    expect(existsSync(join(pluginDir, 'hooks'))).toBe(false);
    const manifest = json('.claude-plugin/plugin.json');
    expect(manifest.hooks).toBeUndefined();
    expect(listPluginFiles().some((f) => /(^|\/)hooks?(\/|\.json$)/.test(f))).toBe(false);
  });

  it('documents every file it installs, and only those', () => {
    const files = listPluginFiles();
    expect(files.sort()).toEqual(Object.keys(pluginFiles).sort());
    const doc = readFileSync(docPath, 'utf8');
    for (const f of files) expect(doc).toContain(`| \`${f}\` |`);
    expect(doc).toContain('**Definition.** A hook is anything that silently reads, blocks, rewrites or injects');
  });

  it('starts one MCP server and declares its channel, and nothing else', () => {
    const mcp = json('.mcp.json') as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(mcp.mcpServers)).toEqual(['workflow']);
    expect(mcp.mcpServers.workflow?.args).toEqual([`${fill('CLAUDE_PLUGIN_ROOT')}/server/wf-agent.mjs`, 'serve']);
    const manifest = json('.claude-plugin/plugin.json') as {
      channels: { server: string }[];
      userConfig: Record<string, { sensitive?: boolean; required?: boolean }>;
    };
    expect(manifest.channels).toEqual([{ server: 'workflow', displayName: 'Workflow site' }]);
    expect(Object.keys(manifest.userConfig).sort()).toEqual(['agent_key', 'site']);
    expect(manifest.userConfig.agent_key?.sensitive).toBe(true);
    // Claude Code does not start a plugin's server while a required option is unset, so neither is
    // required: a login saved with `wf-agent login` must be enough (INSTALL.md step 2).
    expect(Object.values(manifest.userConfig).map((o) => o.required)).toEqual([false, false]);
  });
});

describe('US-D-1 install into Claude Code with only the site address and the key', () => {
  it('writes the install steps down and asks for nothing but the site address and the key', () => {
    const install = readFileSync(join(pluginDir, 'INSTALL.md'), 'utf8');
    expect(install).toContain('You need two things: the **site address**');
    expect(install).toContain('**agent key**');
    expect(install).toContain('/plugin install workflow-agent@workflow-site');
    expect(install).toContain('wf-agent.mjs check');
    expect(install).toContain('/plugin uninstall workflow-agent@workflow-site');
    const mcp = json('.mcp.json') as { mcpServers: { workflow: { env: Record<string, string> } } };
    expect(mcp.mcpServers.workflow.env).toEqual({
      WF_SITE: fill('user_config.site'),
      WF_AGENT_KEY: fill('user_config.agent_key'),
      WF_HARNESS: 'claude-code',
    });
  });

  it('ships the single-file server built from the current source', async () => {
    expect(readFileSync(bundlePath, 'utf8') === (await bundleText())).toBe(true);
    expect(statSync(bundlePath).mode & 0o111).not.toBe(0);
  }, 60_000);
});

describe('US-D-8 the interface is documented with every call, field, error and notification type', () => {
  it('the documentation page and the work-a-queue skill are current', () => {
    expect(readFileSync(docPath, 'utf8') === agentInterfaceDoc()).toBe(true);
    expect(readFileSync(skillPath, 'utf8')).toBe(workAQueueSkill());
  });

  it('the plugins import nothing from the workspace except the client', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === 'node_modules' || name === 'dist-types') continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|mts|tsx)$/.test(name)) {
          for (const ref of ts.preProcessFile(readFileSync(path, 'utf8'), true, true).importedFiles) {
            const spec = ref.fileName;
            const local = spec.startsWith('.') ? relative(repoRoot, join(dir, spec)) : '';
            if ((spec.startsWith('@wf/') && !spec.startsWith('@wf/client')) || /^(apps|packages)\//.test(local))
              offenders.push(`${relative(repoRoot, path)} -> ${spec}`);
          }
        }
      }
    };
    walk(pluginsRoot);
    expect(offenders).toEqual([]);
  });

  it('names no site address in the plugin folders', () => {
    const texts = listPluginFiles()
      .filter((f) => !f.endsWith('.mjs'))
      .map((f) => readFileSync(join(pluginDir, f), 'utf8'));
    for (const text of texts) {
      for (const url of text.match(/https?:\/\/[^\s)"'`]+/g) ?? [])
        expect(url, url).toMatch(/^https?:\/\/[^/]*\.example\.test|^http:\/\/127\.0\.0\.1/);
    }
  });
});
