/**
 * The conformance script: drives a plugin's MCP server over stdio against a running test site, as an
 * agent would, and reports each step. Every harness plugin must pass it.
 *
 *   WF_SITE=<test site> WF_AGENT_KEY=<key> node plugins/mcp/conformance/run.ts [--allow-not-built]
 *
 * Steps: check, read queue, read map (summary and mermaid), claim, upload, attempt with evidence, ask
 * a blocking question, read and acknowledge the inbox, create a draft and edit it as text and by a
 * block operation, start a run.
 *
 * Each step ends in one of four outcomes:
 *   PASS       the plugin did what the step asks and the site answered
 *   FAIL       the plugin or the site answered wrongly
 *   NOT BUILT  the site answered `not_implemented`: that part of the site is not built yet
 *   SKIPPED    the step needs something an earlier step did not produce (named in the line)
 *
 * Options (environment):
 *   WF_CONFORMANCE_SERVER   the server command, default `node <this folder>/../src/cli.ts serve`
 *   WF_CONFORMANCE_STEP     the step id to work on; default the first unclaimed step in my queues
 *   WF_CONFORMANCE_RUN      the run (id or reference) to read; default the run of that step
 *   WF_CONFORMANCE_ASK      `<kind>:<id>` to ask; default the owner of the step's run
 *   WF_CONFORMANCE_TEMPLATE the template key to start; default the first startable one
 *   WF_CONFORMANCE_START_INPUTS  JSON of start inputs for it (default {})
 * Exit code 0 when every step passed. With `--allow-not-built`, also 0 when no step FAILED and at least
 * one is NOT BUILT (steps may then be SKIPPED); the last line then says it was not a full pass.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));

export type Outcome = 'pass' | 'fail' | 'not_built' | 'skipped';

export interface StepReport {
  step: string;
  outcome: Outcome;
  detail: string;
}

export interface ChannelMessage {
  content: string;
  meta: Record<string, string>;
}

export interface PluginServerOptions {
  /** The server command; default this plugin's own `node src/cli.ts serve`. */
  command?: string;
  args?: string[];
  env: Record<string, string>;
}

/** An MCP session with a plugin's server over stdio, the way a harness starts it. */
export interface PluginSession {
  client: McpClient;
  /** Calls a tool; the text of the result and whether it is a tool error. */
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  /** Every `notifications/claude/channel` message received so far. */
  channel: ChannelMessage[];
  /** What the server wrote to standard error. */
  stderr(): string;
  close(): Promise<void>;
}

export async function connectPlugin(options: PluginServerOptions): Promise<PluginSession> {
  const transport = new StdioClientTransport({
    command: options.command ?? process.execPath,
    args: options.args ?? [resolve(here, '../src/cli.ts'), 'serve'],
    env: options.env,
    stderr: 'pipe',
  });
  let errors = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString('utf8');
  });
  const client = new McpClient({ name: 'wf-conformance', version: '1.0.0' });
  const channel: ChannelMessage[] = [];
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === 'notifications/claude/channel') channel.push(n.params as unknown as ChannelMessage);
  };
  await client.connect(transport);
  return {
    client,
    channel,
    stderr: () => errors,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
    },
    close: () => client.close(),
  };
}

class StepFailed extends Error {}
class NotBuilt extends Error {}
class Skipped extends Error {}

/** The JSON part of a tool result (between the summary and the inbox line). */
export function dataOf<T>(text: string): T {
  const at = [text.indexOf('\n\n{'), text.indexOf('\n\n[')].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) throw new StepFailed(`no data in the answer: ${text.slice(0, 200)}`);
  let body = text.slice(at + 2);
  const inbox = body.lastIndexOf('\n\ninbox: ');
  if (inbox >= 0) body = body.slice(0, inbox);
  return JSON.parse(body) as T;
}

export interface ConformanceOptions extends PluginServerOptions {
  log?: (line: string) => void;
}

export async function runConformance(options: ConformanceOptions): Promise<StepReport[]> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const session = await connectPlugin(options);
  const reports: StepReport[] = [];

  async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const { text, isError } = await session.call(name, args);
    if (isError && text.includes('Reason code: not_implemented')) throw new NotBuilt(`${name}: the site does not build this yet`);
    if (isError) throw new StepFailed(text.split('\n').slice(0, 4).join(' / '));
    return text;
  }

  function need<T>(value: T | null | undefined | '', what: string): T {
    if (value === null || value === undefined || value === '') throw new Skipped(`needs ${what}`);
    return value;
  }

  async function step(name: string, body: () => Promise<string>): Promise<void> {
    let outcome: Outcome = 'pass';
    let detail: string;
    try {
      detail = await body();
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      outcome = error instanceof NotBuilt ? 'not_built' : error instanceof Skipped ? 'skipped' : 'fail';
    }
    reports.push({ step: name, outcome, detail });
    log(`${{ pass: 'PASS', fail: 'FAIL', not_built: 'NOT BUILT', skipped: 'SKIPPED' }[outcome]} ${name}: ${detail}`);
  }

  const env = options.env;
  let stepId = env.WF_CONFORMANCE_STEP ?? '';
  let runRef = env.WF_CONFORMANCE_RUN ?? '';
  let askTo: { kind: string; id: string } | null = env.WF_CONFORMANCE_ASK
    ? { kind: env.WF_CONFORMANCE_ASK.split(':')[0] ?? '', id: env.WF_CONFORMANCE_ASK.split(':')[1] ?? '' }
    : null;
  let artifactId = '';
  let draftId = '';

  try {
    await step('check', async () => {
      const text = await call('whoami');
      if (!text.includes('Connected as:') || !text.includes('Owner:')) throw new StepFailed('whoami did not name the account and owner');
      return text.split('\n')[1] ?? '';
    });
    await step('read queue', async () => {
      const text = await call('queue_list');
      const work = dataOf<{ items: { view: string; step: { id: string; owner: unknown }; run: { ref: string } }[] }>(text);
      const pick = stepId ? work.items.find((i) => i.step.id === stepId) : work.items.find((i) => i.view === 'queues' && !i.step.owner);
      if (!pick && !stepId) throw new StepFailed('no unclaimed step in my queues (set WF_CONFORMANCE_STEP)');
      stepId ||= pick?.step.id ?? '';
      runRef ||= pick?.run.ref ?? '';
      return `${work.items.length} item(s); using step ${stepId}`;
    });
    await step('read map (summary)', async () => {
      if (!runRef) {
        const view = dataOf<{ run: { ref: string } }>(
          await call('step_open', { step: need(stepId, 'a step (WF_CONFORMANCE_STEP)'), detail: 'summary' }),
        );
        runRef = view.run.ref;
      }
      const text = await call('run_map', { run: runRef });
      const map = dataOf<{ run: { owner: { kind: string; id: string } | null }; nodes: unknown[] }>(text);
      if (map.run.owner && !askTo) askTo = { kind: map.run.owner.kind, id: map.run.owner.id };
      return `${map.nodes.length} block(s) on ${runRef}`;
    });
    await step('read map (mermaid)', async () => {
      const text = await call('run_map', { run: need(runRef, 'a run (WF_CONFORMANCE_RUN)'), format: 'mermaid' });
      if (!/^flowchart (TD|TB|LR)/m.test(text)) throw new StepFailed('the answer is not mermaid flowchart text');
      return `${text.split('\n').length} line(s)`;
    });
    await step('claim', async () => {
      const text = await call('step_claim', { step: need(stepId, 'a step (WF_CONFORMANCE_STEP)') });
      return text.split('\n')[0] ?? '';
    });
    await step('upload', async () => {
      const target = need(stepId, 'a step (WF_CONFORMANCE_STEP)');
      const dir = mkdtempSync(join(tmpdir(), 'wf-conformance-'));
      const file = join(dir, 'conformance-evidence.txt');
      writeFileSync(file, `Conformance evidence written at ${new Date().toISOString()}\n`.repeat(200));
      const text = await call('artifact_upload', {
        step: target,
        path: file,
        label: 'guideline',
        note: 'Written by the conformance script',
      });
      artifactId = dataOf<{ artifact: { id: string } }>(text).artifact.id;
      return text.split('\n')[0] ?? '';
    });
    await step('attempt with evidence', async () => {
      // With the file of the upload step when that passed; the attempt is checked either way.
      const text = await call('attempt_add', {
        step: need(stepId, 'a step (WF_CONFORMANCE_STEP)'),
        result: {},
        explanation: 'Conformance run: an attempt with evidence.',
        evidence: artifactId
          ? [{ kind: 'file', ref: artifactId, note: 'The uploaded file' }]
          : [{ kind: 'text', ref: 'Checked by the conformance script', note: 'No file: the upload step did not pass' }],
        artifact_ids: artifactId ? [artifactId] : [],
      });
      return text.split('\n')[0] ?? '';
    });
    await step('ask a blocking question', async () => {
      const text = await call('question_ask', {
        step: need(stepId, 'a step (WF_CONFORMANCE_STEP)'),
        body: 'Conformance run: is this the right rule set?',
        addressed_to: need(askTo, 'somebody to ask (WF_CONFORMANCE_ASK=<kind>:<id>, or the run map)'),
        blocking: true,
      });
      return text.split('\n')[0] ?? '';
    });
    await step('read and acknowledge the inbox', async () => {
      const text = await call('inbox_read', { unacked_only: true });
      const page = dataOf<{ items: { id: string }[]; unread: number }>(text);
      if (page.items.length) await call('inbox_ack', { ids: page.items.map((i) => i.id) });
      return `${page.items.length} item(s) read and acknowledged`;
    });
    await step('create a draft', async () => {
      const key = `conformance-${Date.now().toString(36)}`;
      const text = await call('draft_create', { key, name: `Conformance ${key}` });
      draftId = dataOf<{ draft: { id: string } }>(text).draft.id;
      return text.split('\n')[0] ?? '';
    });
    await step('edit the draft as text', async () => {
      const text = await call('draft_edit', {
        draft: need(draftId, 'the draft'),
        text: 'flowchart TD\n  S([Request arrives]) --> A1[Check the request]\n  A1 --> F(((Done)))\n',
      });
      return text.split('\n')[0] ?? '';
    });
    await step('edit the draft by block operation', async () => {
      const text = await call('draft_edit', {
        draft: need(draftId, 'the draft'),
        ops: [{ op: 'rename_block', id: 'A1', label: 'Check the request and reply' }],
      });
      return text.split('\n')[0] ?? '';
    });
    await step('start a run', async () => {
      const key = need(
        env.WF_CONFORMANCE_TEMPLATE ??
          dataOf<{ items: { key: string; startable: boolean }[] }>(await call('template_list')).items.find((t) => t.startable)?.key,
        'a startable template (WF_CONFORMANCE_TEMPLATE)',
      );
      const inputs = JSON.parse(env.WF_CONFORMANCE_START_INPUTS ?? '{}') as Record<string, unknown>;
      const text = await call('run_start', { template: key, start_inputs: inputs });
      return text.split('\n')[0] ?? '';
    });
  } finally {
    await session.close();
  }
  return reports;
}

/** Whether the run counts as passed: every step passed, or with `allowNotBuilt` none failed and some part of the site is not built. */
export function conformancePassed(reports: StepReport[], allowNotBuilt: boolean): boolean {
  if (reports.some((r) => r.outcome === 'fail')) return false;
  if (!allowNotBuilt) return reports.every((r) => r.outcome === 'pass');
  return reports.some((r) => r.outcome === 'not_built') || reports.every((r) => r.outcome === 'pass');
}

if (import.meta.main) {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const custom = env.WF_CONFORMANCE_SERVER?.split(' ').filter(Boolean);
  const allowNotBuilt = process.argv.includes('--allow-not-built');
  const reports = await runConformance({ env, ...(custom?.length ? { command: custom[0], args: custom.slice(1) } : {}) });
  const count = (o: Outcome) => reports.filter((r) => r.outcome === o).length;
  process.stdout.write(
    `${count('pass')} of ${reports.length} steps passed; ${count('fail')} failed, ${count('not_built')} not built on this site, ${count('skipped')} skipped\n`,
  );
  const passed = conformancePassed(reports, allowNotBuilt);
  if (passed && count('pass') < reports.length)
    process.stdout.write('Not a full pass: some steps wait on parts of the site that are not built yet.\n');
  process.exitCode = passed ? 0 : 1;
}
