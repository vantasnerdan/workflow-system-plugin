/**
 * `wf-agent check` and `wf-agent login` where no site answers (US-D-1, US-D-6): configuration, a key
 * that is not an agent key, an unreachable site. Against the real site (account, owner, paused,
 * revoked, and a saved login) they are proven in live-site.db.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { check, EXIT, login } from '../src/cli.ts';
import { loadConfig } from '../src/config.ts';
import { tempDir } from './harness.ts';

/** A harness placeholder such as `${name}`, as the plugin files write it. */
const fill = (name: string) => ['$', '{', name, '}'].join('');

const KEY = 'wfa_testkey1_secretsecretsecret';
const NOWHERE = 'http://127.0.0.1:9';

function io(env: NodeJS.ProcessEnv, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t), stdin: async () => stdin, env } };
}

describe('US-D-1 the login is kept on this machine only', () => {
  it('refuses a key that is not an agent key without calling the site', async () => {
    const t = io({ XDG_CONFIG_HOME: tempDir() }, 'not-a-key');
    // An unreachable address: had the site been called, the answer would be "site unreachable".
    expect(await login(['--site', NOWHERE], t.io)).toBe(EXIT.notConfigured);
    expect(t.err[0]).toContain('That is not an agent key');
  });

  it('an option placeholder the harness left unfilled is never taken for a site address', () => {
    const config = tempDir();
    expect(() =>
      loadConfig({ XDG_CONFIG_HOME: config, WF_SITE: fill('user_config.site'), WF_AGENT_KEY: fill('user_config.agent_key') }),
    ).toThrow(/No site address/);
  });
});

describe('US-D-6 the check gives a distinct message and exit code for each refusal', () => {
  it('site unreachable', async () => {
    const t = io({ WF_SITE: NOWHERE, WF_AGENT_KEY: KEY, XDG_CONFIG_HOME: tempDir() });
    expect(await check([], t.io)).toBe(EXIT.unreachable);
    expect(t.err.join('\n')).toContain('This is not an empty queue: nothing was read.');
  });

  it('not configured', async () => {
    const t = io({ XDG_CONFIG_HOME: tempDir() });
    expect(await check([], t.io)).toBe(EXIT.notConfigured);
    expect(t.err[0]).toContain('No site address. Set WF_SITE, or run "wf-agent login --site <address>".');
  });
});
