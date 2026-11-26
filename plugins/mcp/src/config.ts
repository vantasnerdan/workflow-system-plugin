/**
 * Where the plugin finds the site and the key, and where it keeps its small local state.
 *
 * - `WF_SITE` and `WF_AGENT_KEY` from the environment win (the harness sets them).
 * - Otherwise the file written by `wf-agent login`: `$XDG_CONFIG_HOME/wf-agent/config.json`
 *   (default `~/.config/wf-agent/config.json`), readable by its owner only.
 * - Local state (the last `changes_since` time, unfinished uploads, the last event seen) lives in
 *   `$XDG_STATE_HOME/wf-agent/<site host>/` (default `~/.local/state/wf-agent/...`).
 * - `WF_HARNESS` names the harness in the `User-Agent` (`wf-plugin/<harness>/<version>`).
 * - `WF_PUSH=off` turns the forwarding of the event stream off; the inbox stays the baseline.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PLUGIN_VERSION } from './version.ts';

export interface PluginConfig {
  site: string;
  key: string;
  harness: string;
  push: boolean;
  userAgent: string;
  stateDir: string;
  configFile: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'wf-agent', 'config.json');
}

function stateBase(env: NodeJS.ProcessEnv): string {
  return env.WF_STATE_DIR || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'wf-agent');
}

export function readSavedLogin(env: NodeJS.ProcessEnv = process.env): { site?: string; key?: string } {
  const file = configFile(env);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { site?: unknown; key?: unknown };
    return {
      ...(typeof parsed.site === 'string' ? { site: parsed.site } : {}),
      ...(typeof parsed.key === 'string' ? { key: parsed.key } : {}),
    };
  } catch {
    throw new ConfigError(`The saved login in ${file} cannot be read. Run "wf-agent login" again.`);
  }
}

export function saveLogin(site: string, key: string, env: NodeJS.ProcessEnv = process.env): string {
  const file = configFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ site, key }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** A site address is an http or https origin; a path, query or credentials in it are refused. */
export function normaliseSite(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new ConfigError(`"${input}" is not a web address. Give the site address, for example https://workflow.example.test.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new ConfigError('The site address must start with https:// (or http:// for a test site).');
  if (parsed.username || parsed.password) throw new ConfigError('The site address must not contain a user name or password.');
  return parsed.origin;
}

export const KEY_PATTERN = /^wfa_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/;

/** A value the harness left as an unfilled `${...}` placeholder counts as not set. */
function given(value: string | undefined): string | undefined {
  return value && !/^\$\{[^}]*\}$/.test(value.trim()) ? value : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PluginConfig {
  const envSite = given(env.WF_SITE);
  const envKey = given(env.WF_AGENT_KEY);
  const saved = envSite && envKey ? {} : readSavedLogin(env);
  const siteText = envSite || saved.site;
  const key = envKey || saved.key;
  if (!siteText) throw new ConfigError('No site address. Set WF_SITE, or run "wf-agent login --site <address>".');
  if (!key) throw new ConfigError('No agent key. Set WF_AGENT_KEY, or run "wf-agent login --site <address>" and paste the key.');
  if (!KEY_PATTERN.test(key))
    throw new ConfigError('The agent key does not look like an agent key (it starts with "wfa_"). Ask the agent owner for the key.');
  const site = normaliseSite(siteText);
  const harness = env.WF_HARNESS || 'mcp';
  return {
    site,
    key,
    harness,
    push: env.WF_PUSH !== 'off',
    userAgent: `wf-plugin/${harness}/${PLUGIN_VERSION}`,
    stateDir: join(stateBase(env), new URL(site).host.replace(/[^A-Za-z0-9.-]/g, '_')),
    configFile: configFile(env),
  };
}
