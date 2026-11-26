/**
 * The conformance script's steps on the queues, runs and steps areas, through a real stdio server
 * process, against the stand-in for lane L7 (fake-site.ts), which answers every other area as not
 * built. The other steps run against the real site in live-site.db.test.ts; together the two runs pass
 * every step once.
 */
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conformancePassed, runConformance } from '../conformance/run.ts';
import { type FakeSite, KEY, startFakeSite } from './fake-site.ts';
import { tempDir } from './harness.ts';

let site: FakeSite;
beforeEach(async () => {
  site = await startFakeSite();
});
afterEach(async () => {
  await site.close();
});

const env = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  HOME: tempDir('wf-home-'),
  WF_SITE: site.url,
  WF_AGENT_KEY: KEY,
  WF_HARNESS: 'claude-code',
  WF_PUSH: 'off',
  WF_CONFORMANCE_TEMPLATE: 'package-design',
  WF_CONFORMANCE_START_INPUTS: '{"product_name":"Sample Product"}',
  ...extra,
});

/** The steps whose calls lane L7 answers; the stand-in answers every other area as not built. */
const L7_STEPS = ['check', 'read queue', 'read map (summary)', 'read map (mermaid)', 'claim', 'attempt with evidence', 'start a run'];

describe('US-D-1 install into Claude Code: the plugin passes the conformance script', () => {
  it('passes the queue, map, claim, attempt and run start steps with the single file the Claude Code plugin installs', async () => {
    const bundle = resolve(join(import.meta.dirname, '../../claude-code/server/wf-agent.mjs'));
    const lines: string[] = [];
    const reports = await runConformance({ env: env(), command: process.execPath, args: [bundle, 'serve'], log: (l) => lines.push(l) });
    const outcome = Object.fromEntries(reports.map((r) => [r.step, r.outcome]));
    for (const step of L7_STEPS) expect(outcome[step], lines.join('\n')).toBe('pass');
    for (const r of reports.filter((x) => !L7_STEPS.includes(x.step)))
      expect(['not_built', 'skipped'], lines.join('\n')).toContain(r.outcome);
    expect(site.requests.every((r) => r.userAgent === 'wf-plugin/claude-code/1.0.0')).toBe(true);
    // Not a full pass on a site where some parts are not built, unless that is allowed explicitly.
    expect(conformancePassed(reports, false)).toBe(false);
    expect(conformancePassed(reports, true)).toBe(true);
  }, 60_000);

  it('reports a failed step instead of hiding it', async () => {
    const reports = await runConformance({
      env: env({ WF_CONFORMANCE_STEP: '00000000-0000-4000-8000-00000000dead' }),
      log: () => undefined,
    });
    const claim = reports.find((r) => r.step === 'claim');
    expect(claim?.outcome).toBe('fail');
    expect(claim?.detail).toContain('Reason code: not_found');
    expect(conformancePassed(reports, true)).toBe(false);
  }, 60_000);
});
