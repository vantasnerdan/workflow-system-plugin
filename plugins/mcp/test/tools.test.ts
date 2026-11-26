/**
 * The tools of the queues, runs and steps areas through the MCP binding, against the stand-in for lane
 * L7 (run screens, not merged yet; fake-site.ts). Every tool that reaches a merged lane is proven
 * against the real site in live-site.db.test.ts. Titles carry the story IDs they prove.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataOf, type Harness, startHarness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

describe('US-D-6 honest refusals on step actions', () => {
  it('says when an action is outside the agent limits and who can change them', async () => {
    const { text, isError } = await h.call('step_claim', { step: h.site.steps.limited.id });
    expect(isError).toBe(true);
    expect(text).toContain('Refused: Outside your limits.');
    expect(text).toContain('can change the templates and steps this agent may act on');
  });

  it('says the site is unreachable, never an empty list', async () => {
    const dead = await startHarness({ siteUrl: 'http://127.0.0.1:9' });
    try {
      const { text, isError } = await dead.call('queue_list');
      expect(isError).toBe(true);
      expect(text).toContain('Reason code: site_unreachable');
      expect(text).toContain('This is not an empty queue: nothing was read.');
      expect(text).toContain('http://127.0.0.1:9');
    } finally {
      await dead.close();
    }
  });
});

describe('US-D-24 a refused action returns the reason and who can change it', () => {
  it("completing another owner's step names the missing permission and who can grant it", async () => {
    const { text, isError } = await h.call('step_complete', { step: h.site.steps.others.id });
    expect(isError).toBe(true);
    expect(text).toContain('This step belongs to Designer One');
    expect(text).toContain('Missing permission: act.complete_for_others');
    expect(text).toContain('Who can change this: Org admin (role), Purchasing Lead One (person)');
  });
});

describe('US-D-9 the agent reads its own queue', () => {
  it('lists assigned steps with run, step, state, due date and who it waits on, and an empty list as empty', async () => {
    const { text, isError } = await h.call('queue_list', { view: 'assigned' });
    expect(isError).toBe(false);
    expect(text).toContain('[assigned] Package design PD-1 (PD-1) / Collect the files; state in_progress; owner Compliance Agent One');
    expect(text).toContain('My work: 1 assigned');
  });
});

describe('US-D-10 the agent reads the queues of its roles', () => {
  it('lists the role queues it belongs to and their unclaimed steps', async () => {
    const queues = await h.call('queue_list', { list_queues: true });
    expect(queues.text).toContain('Compliance agent (role');
    const queue = await h.call('queue_list', { queue: { kind: 'role', subject: h.site.steps.queued.assignee?.id } });
    expect(queue.text).toContain('Queue Compliance agent');
    expect(queue.text).toContain('Check the artwork');
  });
});

describe('US-D-11 the agent claims a step from a role queue', () => {
  it('becomes the owner, and a step someone else holds is refused with who has it', async () => {
    const claimed = await h.call('step_claim', { step: h.site.steps.queued.id });
    expect(claimed.text).toContain('Claimed "Check the artwork". Owner is now Compliance Agent One.');
    const taken = await h.call('step_claim', { step: h.site.steps.others.id });
    expect(taken.isError).toBe(true);
    expect(taken.text).toContain('Designer One claimed this step first.');
  });
});

describe('US-D-12 the agent hands a step back or reassigns it', () => {
  it('releases to the queue and reassigns with a note', async () => {
    await h.call('step_claim', { step: h.site.steps.queued.id });
    const released = await h.call('step_release', { step: h.site.steps.queued.id, note: 'Needs a person' });
    expect(released.text).toContain('back to its queue');
    const reassigned = await h.call('step_reassign', {
      step: h.site.steps.queued.id,
      to: { kind: 'account', id: h.site.steps.others.owner?.id },
      note: 'Over to the designer',
    });
    expect(reassigned.text).toContain('Reassigned "Check the artwork" to Designer One');
  });
});

describe('US-D-14 the whole map of an accessible run', () => {
  it('answers short first: state, owner and accepted result per block', async () => {
    const { text } = await h.call('run_map', { run: 'PD-1' });
    expect(text).toContain('Run Package design PD-1 (PD-1), running');
    expect(text).toContain('- Review the text: in_progress, owner Designer One');
    expect(text).not.toContain('"attempts"');
  });

  it('refuses a run the agent cannot see with a clear message', async () => {
    const { text, isError } = await h.call('run_map', { run: 'XX-9' });
    expect(isError).toBe(true);
    expect(text).toContain('Reason code: not_found');
  });
});

describe('US-D-18 the run map in mermaid form', () => {
  it('returns the mermaid text with state and owner on each block', async () => {
    const { text } = await h.call('run_map', { run: 'PD-1', format: 'mermaid' });
    expect(text.startsWith('flowchart TD')).toBe(true);
    expect(text).toContain('Review the text · in_progress · Designer One');
  });
});

describe('US-D-15 open any block of a run', () => {
  it('shows component, instructions, inputs, who it waits on and what the agent may do', async () => {
    const { text } = await h.call('step_open', { step: h.site.steps.queued.id, detail: 'summary' });
    expect(text).toContain('Check the artwork in Package design PD-1 (PD-1): Agent check, state ready');
    expect(text).toContain('waits on Compliance agent since');
    expect(text).toContain('Inputs: artwork');
    expect(text).toContain('I may: claim, add_attempt, complete, comment, ask_question');
    expect(dataOf<{ settings: { instructions: string } }>(text).settings.instructions).toContain('rule set');
  });
});

describe('US-D-19 attempt with result, files, evidence and explanation', () => {
  it('records the attempt with its result, evidence, explanation and the files already uploaded', async () => {
    const file = '00000000-0000-4000-8000-0000000000f1';
    const { text, isError } = await h.call('attempt_add', {
      step: h.site.steps.queued.id,
      result: { outcome: 'pass' },
      explanation: 'Checked every panel against the rule set.',
      evidence: [{ kind: 'rule', ref: 'rule-1', note: 'Applied version 3' }],
      artifact_ids: [file],
    });
    expect(isError).toBe(false);
    expect(text).toMatch(/Attempt recorded \(id [0-9a-f-]+\) with 1 file\(s\) and 1 evidence item\(s\)\./);
    expect(dataOf<{ artifactIds: string[] }>(text).artifactIds).toEqual([file]);
  });
});

describe('US-D-16 open any attempt on demand', () => {
  it('opens an attempt with its files, evidence and explanation', async () => {
    const added = await h.call('attempt_add', {
      step: h.site.steps.queued.id,
      result: {},
      explanation: 'See file',
      artifact_ids: ['00000000-0000-4000-8000-0000000000f2'],
    });
    const attemptId = dataOf<{ id: string }>(added.text).id;
    const opened = await h.call('attempt_open', { attempt: attemptId });
    expect(opened.text).toContain('Files: 00000000-0000-4000-8000-0000000000f2');
  });
});

describe('US-D-20 an attempt where others attempted', () => {
  it('adds a second attempt without replacing the first', async () => {
    await h.call('attempt_add', { step: h.site.steps.queued.id, result: { outcome: 'pass' }, explanation: 'First try' });
    await h.call('attempt_add', { step: h.site.steps.queued.id, result: { outcome: 'findings' }, explanation: 'Second try' });
    const view = await h.call('step_open', { step: h.site.steps.queued.id });
    expect(view.text).toContain('Attempts: 2; none accepted');
  });
});

describe('US-D-23 complete when the gate is met; told plainly when not', () => {
  it('completes and names the next steps; a gate not met is refused with its unmet parts', async () => {
    const done = await h.call('step_complete', { step: h.site.steps.queued.id });
    expect(done.text).toContain('Completed "Check the artwork". Now ready: Review the text.');
    const gated = await h.call('step_complete', { step: h.site.steps.gated.id });
    expect(gated.isError).toBe(true);
    expect(gated.text).toContain('Not met yet:\n- At least one final file is attached');
  });

  it('an approval the template keeps with a person is refused as human required', async () => {
    const { text } = await h.call('approval_decide', { step: h.site.steps.limited.id, decision: 'approved' });
    expect(text).toContain('Reason code: human_required');
  });
});

describe('US-D-48 the agent starts a run', () => {
  it('refuses missing start inputs by name, and starts a run', async () => {
    const missing = await h.call('run_start', { template: 'package-design', start_inputs: {} });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('- start_inputs.product_name: Required');
    const started = await h.call('run_start', { template: 'package-design', start_inputs: { product_name: 'Sample Product' } });
    expect(started.text).toContain('Started "Package design Sample Product" (PD-2)');
  });
});

describe('US-D-8 the plugin speaks only the documented interface', () => {
  it('sends its own User-Agent and an idempotency key on every change', async () => {
    await h.call('step_claim', { step: h.site.steps.queued.id });
    const claim = h.site.requests.find((r) => r.op === 'step_claim');
    expect(claim?.userAgent).toBe('wf-plugin/claude-code/1.0.0');
    expect(claim?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.site.requests.every((r) => r.userAgent === 'wf-plugin/claude-code/1.0.0')).toBe(true);
  });
});
