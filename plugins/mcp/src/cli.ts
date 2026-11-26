#!/usr/bin/env node
/**
 * `wf-agent`: the plugin's command line.
 *
 *   wf-agent serve                     run the stdio MCP server (what a harness starts)
 *   wf-agent check [--json]            the connection check: who this agent is and what it may do
 *   wf-agent login --site <address>    save the site address and the key (read from standard input,
 *                                      never from the command line) after checking them
 *
 * Exit codes of `check` and `login`: 0 connected; 2 not configured; 3 site unreachable; 4 key
 * revoked or expired; 5 paused or suspended; 6 any other refusal.
 */
import { createClient, isWfError } from '@wf/client';
import { ConfigError, KEY_PATTERN, loadConfig, normaliseSite, saveLogin } from './config.ts';
import { connectionCheck, describeIdentity, identityOf } from './identity.ts';
import { serve } from './mcp.ts';
import { describeError } from './refusal.ts';
import { PLUGIN_VERSION } from './version.ts';

export const EXIT = { ok: 0, notConfigured: 2, unreachable: 3, keyInvalid: 4, paused: 5, refused: 6 } as const;

export function exitCodeFor(error: unknown): number {
  if (error instanceof ConfigError) return EXIT.notConfigured;
  if (!isWfError(error)) return EXIT.refused;
  if (error.code === 'site_unreachable') return EXIT.unreachable;
  if (error.code === 'key_revoked' || error.code === 'key_expired' || error.code === 'unauthenticated') return EXIT.keyInvalid;
  if (error.code === 'paused' || error.code === 'owner_inactive') return EXIT.paused;
  return EXIT.refused;
}

interface Io {
  out(text: string): void;
  err(text: string): void;
  stdin(): Promise<string>;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  stdin: readStdin,
  env: process.env,
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function check(args: string[], io: Io = defaultIo): Promise<number> {
  try {
    const config = loadConfig(io.env);
    const client = createClient({
      site: config.site,
      key: config.key,
      userAgent: config.userAgent,
      ...(io.fetch ? { fetch: io.fetch } : {}),
    });
    const { who, meta } = await connectionCheck(client);
    const push = { enabled: config.push, connected: false, channel: config.push ? 'notifications/claude/channel' : null };
    if (args.includes('--json'))
      io.out(
        JSON.stringify({ site: config.site, plugin_version: PLUGIN_VERSION, user_agent: config.userAgent, whoami: who, meta }, null, 2),
      );
    else {
      io.out(describeIdentity(who, meta, config.site, push, config.harness).join('\n'));
      if (config.push)
        io.out('Push: when the server runs inside the harness it holds the event stream open and forwards new items as channel messages.');
    }
    return who.paused || who.suspended ? EXIT.paused : EXIT.ok;
  } catch (error) {
    if (error instanceof ConfigError) io.err(error.message);
    else {
      let site = io.env.WF_SITE ?? '';
      try {
        site = loadConfig(io.env).site;
      } catch {
        // already reported
      }
      io.err(describeError(error, null, site).join('\n'));
    }
    return exitCodeFor(error);
  }
}

export async function login(args: string[], io: Io = defaultIo): Promise<number> {
  try {
    const siteArg = flag(args, '--site') ?? io.env.WF_SITE;
    if (!siteArg) throw new ConfigError('Give the site address: wf-agent login --site <address>, then paste the agent key.');
    const site = normaliseSite(siteArg);
    const key = (io.env.WF_AGENT_KEY ?? (await io.stdin())).trim();
    if (!KEY_PATTERN.test(key))
      throw new ConfigError('That is not an agent key (it starts with "wfa_"). Paste the key shown once on the agent page.');
    const config = loadConfig({ ...io.env, WF_SITE: site, WF_AGENT_KEY: key });
    const client = createClient({ site, key, userAgent: config.userAgent, ...(io.fetch ? { fetch: io.fetch } : {}) });
    const { who } = await connectionCheck(client);
    const file = saveLogin(site, key, io.env);
    const id = identityOf(who);
    io.out(
      `Saved. This machine now acts as ${id.agentName}${id.ownerName ? ` (owner ${id.ownerName})` : ''} on ${site}. The login is in ${file}, readable only by you.`,
    );
    return EXIT.ok;
  } catch (error) {
    io.err(error instanceof ConfigError ? error.message : describeError(error, null, io.env.WF_SITE ?? '').join('\n'));
    return exitCodeFor(error);
  }
}

const USAGE = `wf-agent ${PLUGIN_VERSION}
  wf-agent serve                    run the MCP server over standard input and output
  wf-agent check [--json]           show who this agent is and what it may do
  wf-agent login --site <address>   save the site address and the key (paste the key on standard input)`;

export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const [command = 'serve', ...rest] = argv;
  if (command === 'serve') {
    try {
      const config = loadConfig(io.env);
      const handle = await serve({ config, ...(io.fetch ? { fetch: io.fetch } : {}) });
      const stop = async () => {
        await handle.close();
        process.exit(0);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      process.stdin.once('end', stop);
      return -1;
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return exitCodeFor(error);
    }
  }
  if (command === 'check') return check(rest, io);
  if (command === 'login') return login(rest, io);
  io.out(USAGE);
  return command === 'help' || command === '--help' ? EXIT.ok : EXIT.refused;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  if (code >= 0) process.exitCode = code;
}
