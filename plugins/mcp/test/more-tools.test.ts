/** The remaining step and run tools against the stand-in for lane L7: accept, override, skip, signal. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataOf, type Harness, startHarness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await startHarness({ push: false });
});
afterEach(async () => {
  await h.close();
});

describe('US-D-20 only one attempt at a time is accepted', () => {
  it('accepting another attempt replaces the accepted one', async () => {
    const a = dataOf<{ id: string }>(
      (await h.call('attempt_add', { step: h.site.steps.queued.id, result: {}, explanation: 'One' })).text,
    ).id;
    const b = dataOf<{ id: string }>(
      (await h.call('attempt_add', { step: h.site.steps.queued.id, result: {}, explanation: 'Two' })).text,
    ).id;
    await h.call('attempt_accept', { attempt: a });
    const second = await h.call('attempt_accept', { attempt: b });
    expect(second.text).toContain(`Accepted attempt ${b} on "Check the artwork".`);
    const view = await h.call('step_open', { step: h.site.steps.queued.id });
    expect(dataOf<{ step: { acceptedAttemptId: string } }>(view.text).step.acceptedAttemptId).toBe(b);
  });
});

describe('US-D-23 an agent cannot override a gate without a manager role', () => {
  it('is refused naming the permission and the role that has it', async () => {
    const { text, isError } = await h.call('gate_override', { step: h.site.steps.gated.id, reason: 'Urgent' });
    expect(isError).toBe(true);
    expect(text).toContain('Missing permission: act.override_gate');
    expect(text).toContain('Who can change this: Manager (role)');
  });

  it('skipping first shows what later steps would miss, then skips with the values', async () => {
    const preview = await h.call('step_skip', { step: h.site.steps.queued.id, reason: 'Not needed' });
    expect(preview.text).toContain('Not skipped yet. Later steps would miss these inputs:\n- Review the text: artwork_check (required)');
    const skipped = await h.call('step_skip', { step: h.site.steps.queued.id, reason: 'Not needed', values: { artwork_check: 'pass' } });
    expect(skipped.text).toContain('Skipped "Check the artwork".');
  });

  it('sends a signal to a run', async () => {
    const { text } = await h.call('run_signal', { run: 'PD-1', name: 'goods_arrived' });
    expect(text).toContain('Signal "goods_arrived" delivered; 1 step(s) woke.');
  });
});
