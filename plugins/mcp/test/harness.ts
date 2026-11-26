/** Test harness: the MCP server of this plugin against the fake site, with an MCP client in memory. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.ts';
import { type ServerHandle, serve } from '../src/mcp.ts';
import { type FakeSite, KEY, startFakeSite } from './fake-site.ts';

export interface Harness {
  site: FakeSite;
  handle: ServerHandle;
  client: Client;
  channel: { content: string; meta: Record<string, string> }[];
  stateDir: string;
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

export function tempDir(prefix = 'wf-agent-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function startHarness(options: { push?: boolean; siteUrl?: string } = {}): Promise<Harness> {
  const site = await startFakeSite();
  const stateDir = tempDir();
  const config = loadConfig({
    WF_SITE: options.siteUrl ?? site.url,
    WF_AGENT_KEY: KEY,
    WF_HARNESS: 'claude-code',
    WF_STATE_DIR: stateDir,
    WF_PUSH: options.push === false ? 'off' : 'on',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = await serve({ config, transport: serverTransport });
  const client = new Client({ name: 'test-harness', version: '1.0.0' });
  const channel: Harness['channel'] = [];
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === 'notifications/claude/channel') channel.push(n.params as Harness['channel'][number]);
  };
  await client.connect(clientTransport);
  return {
    site,
    handle,
    client,
    channel,
    stateDir,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
    },
    async close() {
      await client.close();
      await handle.close();
      await site.close();
    },
  };
}

/** Waits until a condition holds (for push, which arrives on its own time). */
export async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The JSON part of a tool result (between the summary and the inbox line). */
export function dataOf<T = unknown>(text: string): T {
  const start = text.indexOf('\n\n{');
  const startArr = text.indexOf('\n\n[');
  const at = [start, startArr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) throw new Error(`no data in: ${text}`);
  let body = text.slice(at + 2);
  const inbox = body.lastIndexOf('\n\ninbox: ');
  if (inbox >= 0) body = body.slice(0, inbox);
  return JSON.parse(body) as T;
}
