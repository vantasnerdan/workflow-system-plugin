/** The tool registry against the interface document's own list of agent tools (US-D-8). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentToolCalls, operations } from '@wf/client';
import { describe, expect, it } from 'vitest';
import { toolGroups, tools } from '../src/tools/index.ts';
import { PLUGIN_VERSION } from '../src/version.ts';

describe('US-D-8 the plugin uses only the documented interface', () => {
  it('offers exactly the agent tools the interface document lists, each making exactly the calls it lists', () => {
    const offered = Object.fromEntries(tools.map((t) => [t.name, [...t.calls].sort()]));
    const listed = Object.fromEntries(Object.entries(agentToolCalls).map(([name, calls]) => [name, [...calls].sort()]));
    for (const name of Object.keys(listed)) expect(offered[name], name).toBeDefined();
    // Calls a tool makes besides those the contract table lists for it, each for a stated reason.
    const extra: Record<string, string[]> = {
      whoami: ['meta_get'], // the site's interface version, next to the plugin's
      attempt_add: ['file_version_register', 'upload_append', 'upload_create', 'upload_status'], // local files are uploaded first
      draft_edit: ['draft_get'], // the current revision when base_rev is omitted
      draft_settings_set: ['draft_get'],
      draft_fix_propose: ['draft_get'],
      draft_publish: ['draft_get'],
    };
    for (const [name, calls] of Object.entries(offered)) {
      expect(calls, name).toEqual([...new Set([...(listed[name] ?? []), ...(extra[name] ?? [])])].sort());
    }
    expect(Object.keys(offered).sort()).toEqual(Object.keys(listed).sort());
  });

  it('names only calls that exist in the interface', () => {
    for (const tool of tools) for (const call of tool.calls) expect(Object.keys(operations), `${tool.name} -> ${call}`).toContain(call);
  });

  it('has unique tool names in the documented groups, with a description and an input for each', () => {
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(toolGroups).toContain(tool.group);
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.input.shape).toBeDefined();
    }
  });

  it('reports the version it speaks, kept equal to its package version', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../../claude-code/.claude-plugin/plugin.json'), 'utf8')) as {
      version: string;
    };
    expect(PLUGIN_VERSION).toBe(pkg.version);
    expect(manifest.version).toBe(pkg.version);
  });
});
