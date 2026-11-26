/**
 * Working, talking and deciding tools (US-D-19 to US-D-25, US-D-29). Every refusal comes back from
 * the site with its reason (missing permission, unmet gate parts, human required, outside limits)
 * and is shown as such; the plugin adds no check and no gate of its own.
 */
import { z } from 'zod';
import { Subject } from './queues.ts';
import { defineTool } from './types.ts';

const LocalFile = z.object({
  path: z.string().describe('Local path of the file on this machine'),
  name: z.string().optional().describe('File name on the step; the same name becomes the next version of that file'),
  label: z.enum(['guideline', 'final', 'superseded']).optional(),
  note: z.string().optional(),
});

const Evidence = z.object({
  kind: z.enum(['file', 'record', 'url', 'text', 'rule']),
  ref: z.string().describe('Artifact id, step id, address, quoted text or rule id'),
  note: z.string().optional(),
});

const Visibility = z
  .enum(['internal', 'shared'])
  .optional()
  .describe('internal: own organisation only; shared: also the partners on this step');

export const artifact_upload = defineTool({
  name: 'artifact_upload',
  group: 'working',
  title: 'Upload a file',
  description:
    'Upload a file from this machine to a step, resumably (an interrupted upload continues where it stopped), and attach it as the next version of the file with that name, with a status label and note. Returns the artifact id to use in attempt_add.',
  input: z.object({
    step: z.string(),
    path: z.string().describe('Local path of the file'),
    name: z.string().optional(),
    label: z.enum(['guideline', 'final', 'superseded']).optional(),
    note: z.string().optional(),
    role: z.enum(['input', 'output', 'evidence']).optional().describe('Default output'),
    visibility: Visibility,
  }),
  calls: ['upload_create', 'upload_append', 'upload_status', 'file_version_register'],
  readOnly: false,
  async handler(input, ctx) {
    const { step, path, ...options } = input;
    const result = await ctx.files.upload(step, path, options);
    const { artifact, version } = result.registered;
    return {
      summary: `Uploaded ${result.size} bytes${result.resumedFrom ? ` (resumed at byte ${result.resumedFrom})` : ''} as "${version.originalName}" version ${version.number}${
        version.label ? ` (${version.label})` : ''
      }. Artifact id ${artifact.id}.`,
      data: result.registered,
    };
  },
});

export const attempt_add = defineTool({
  name: 'attempt_add',
  group: 'working',
  title: 'Submit an attempt',
  description:
    'Record an attempt on a step: the result (values for the outputs of the component), an explanation of what was done (required), evidence (sources, earlier steps, rules), and files. Files can be artifact ids already uploaded, or local paths that are uploaded first. Adding an attempt never replaces or hides another one.',
  input: z.object({
    step: z.string(),
    result: z.record(z.string(), z.unknown()).describe('Output values; open the step to see the component outputs'),
    explanation: z.string().min(1).describe('What was done and why, for a person to judge'),
    evidence: z.array(Evidence).optional(),
    artifact_ids: z.array(z.string()).optional(),
    files: z.array(LocalFile).optional().describe('Local files to upload and attach'),
    answer_for_org_id: z.string().optional().describe('Intermediaries: the supplier this answer is for'),
  }),
  calls: ['attempt_add', 'upload_create', 'upload_append', 'upload_status', 'file_version_register'],
  readOnly: false,
  async handler(input, ctx) {
    const ids = [...(input.artifact_ids ?? [])];
    for (const file of input.files ?? []) {
      const { path, ...options } = file;
      const uploaded = await ctx.files.upload(input.step, path, options);
      ids.push(uploaded.registered.artifact.id);
    }
    const body = {
      result: input.result,
      explanation: input.explanation,
      evidence: input.evidence ?? [],
      artifact_ids: ids,
      answer_for_org_id: input.answer_for_org_id ?? null,
    };
    const attempt = await ctx.client.call('attempt_add', { params: { step: input.step }, body });
    return {
      summary: `Attempt recorded (id ${attempt.id}) with ${ids.length} file(s) and ${attempt.evidence.length} evidence item(s).`,
      data: attempt,
    };
  },
});

export const attempt_accept = defineTool({
  name: 'attempt_accept',
  group: 'working',
  title: 'Accept an attempt',
  description:
    "Accept one attempt as the step's result; it replaces an earlier accepted one, and the change is recorded. Refused with a reason where not permitted.",
  input: z.object({ attempt: z.string() }),
  calls: ['attempt_accept'],
  readOnly: false,
  async handler(input, ctx) {
    const answer = await ctx.client.call('attempt_accept', { params: { attempt: input.attempt } });
    return { summary: `Accepted attempt ${answer.attempt.id} on "${answer.step.label}".`, data: answer };
  },
});

export const step_complete = defineTool({
  name: 'step_complete',
  group: 'working',
  title: 'Complete a step',
  description:
    "Complete a step. Moves the run on when the step's gate is met and tells the next owners; when it is not met, the refusal names the unmet parts. Completing another owner's step needs the permission for it, and is recorded as done for them.",
  input: z.object({ step: z.string(), outcome: z.string().optional().describe('For steps with outcomes (approval, decision, check)') }),
  calls: ['step_complete'],
  readOnly: false,
  async handler(input, ctx) {
    const moved = await ctx.client.call('step_complete', {
      params: { step: input.step },
      body: input.outcome ? { outcome: input.outcome } : {},
    });
    const next = moved.activated.map((a) => a.label).join(', ');
    return { summary: `Completed "${moved.step.label}".${next ? ` Now ready: ${next}.` : ''}`, data: moved };
  },
});

export const run_signal = defineTool({
  name: 'run_signal',
  group: 'working',
  title: 'Send a signal to a run',
  description: 'Deliver a named event that a Wait step of the run listens for.',
  input: z.object({ run: z.string(), name: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }),
  calls: ['run_signal'],
  readOnly: false,
  async handler(input, ctx) {
    const answer = await ctx.client.call('run_signal', {
      params: { run: input.run },
      body: { name: input.name, payload: input.payload ?? {} },
    });
    return { summary: `Signal "${input.name}" delivered; ${answer.woke_steps.length} step(s) woke.`, data: answer };
  },
});

export const comment_add = defineTool({
  name: 'comment_add',
  group: 'talking',
  title: 'Comment',
  description:
    'Write a comment on a step thread (give step) or the run thread (give run), optionally replying to a comment and mentioning people or agents (they are notified). Reaching a partner needs this agent to be allowed external contact.',
  input: z.object({
    step: z.string().optional(),
    run: z.string().optional(),
    body: z.string().min(1),
    mentions: z.array(z.string()).optional().describe('Account ids to mention'),
    visibility: Visibility,
    parent_id: z.string().optional().describe('The comment this replies to'),
  }),
  calls: ['run_comment_add', 'step_comment_add'],
  readOnly: false,
  async handler(input, ctx) {
    const body = {
      body: input.body,
      mentions: input.mentions ?? [],
      parent_id: input.parent_id ?? null,
      ...(input.visibility ? { visibility: input.visibility } : {}),
    };
    if (input.step) {
      const c = await ctx.client.call('step_comment_add', { params: { step: input.step }, body });
      return { summary: `Comment added to the step thread (id ${c.id}).`, data: c };
    }
    if (input.run) {
      const c = await ctx.client.call('run_comment_add', { params: { run: input.run }, body });
      return { summary: `Comment added to the run thread (id ${c.id}).`, data: c };
    }
    throw new Error('Give step or run.');
  },
});

export const question_ask = defineTool({
  name: 'question_ask',
  group: 'talking',
  title: 'Ask a question',
  description:
    'Ask a person, agent, role, group or organisation a question on a step (or on a run). A blocking question on a step makes the step wait on the addressee until answered; ask instead of guessing. The addressee is notified; a question to a role appears in its queue.',
  input: z.object({
    step: z.string().optional(),
    run: z.string().optional(),
    body: z.string().min(1),
    addressed_to: Subject,
    blocking: z.boolean().optional().describe('Steps only: block the step until answered'),
    mentions: z.array(z.string()).optional(),
    visibility: Visibility,
  }),
  calls: ['run_question_ask', 'step_question_ask'],
  readOnly: false,
  async handler(input, ctx) {
    const base = {
      body: input.body,
      addressed_to: input.addressed_to,
      mentions: input.mentions ?? [],
      ...(input.visibility ? { visibility: input.visibility } : {}),
    };
    if (input.step) {
      const answer = await ctx.client.call('step_question_ask', {
        params: { step: input.step },
        body: { ...base, blocking: input.blocking ?? false },
      });
      // Only a blocking question changes who the step waits on; a plain one leaves it as it was.
      const waiting =
        input.blocking && answer.step.waitingOn
          ? ` The step now waits on ${answer.step.waitingOn.subject?.name ?? answer.step.waitingOn.kind} until it is answered.`
          : '';
      return { summary: `Question asked (id ${answer.comment.id}).${waiting}`, data: answer };
    }
    if (input.run) {
      const c = await ctx.client.call('run_question_ask', { params: { run: input.run }, body: { ...base, blocking: false } });
      return { summary: `Question asked on the run thread (id ${c.id}). Run questions never block.`, data: c };
    }
    throw new Error('Give step or run.');
  },
});

export const question_answer = defineTool({
  name: 'question_answer',
  group: 'talking',
  title: 'Answer a question',
  description: 'Answer a question in its thread; a blocking question stops blocking its step.',
  input: z.object({
    comment: z.string().describe('Id of the question'),
    body: z.string().min(1),
    mentions: z.array(z.string()).optional(),
    visibility: Visibility,
  }),
  calls: ['question_answer'],
  readOnly: false,
  async handler(input, ctx) {
    const answer = await ctx.client.call('question_answer', {
      params: { comment: input.comment },
      body: { body: input.body, mentions: input.mentions ?? [], ...(input.visibility ? { visibility: input.visibility } : {}) },
    });
    return { summary: `Answered (id ${answer.answer.id}).`, data: answer };
  },
});

export const approval_decide = defineTool({
  name: 'approval_decide',
  group: 'deciding',
  title: 'Decide an approval',
  description:
    'Approve, reject or return with changes on an approval step; or pre-approve for a person to confirm (kind preapproval). A deputy names the member the decision counts for. Refused with a reason where the template keeps the decision with a person.',
  input: z.object({
    step: z.string(),
    decision: z.enum(['approved', 'rejected', 'returned']).describe('returned: send back with changes'),
    kind: z.enum(['decision', 'preapproval']).optional().describe('decision (default), or preapproval for a person to confirm'),
    reason: z.string().optional(),
    acting_for: z.string().optional().describe('Deputies: account id of the member'),
  }),
  calls: ['approval_decide'],
  readOnly: false,
  async handler(input, ctx) {
    const answer = await ctx.client.call('approval_decide', {
      params: { step: input.step },
      body: { decision: input.decision, kind: input.kind ?? 'decision', reason: input.reason ?? '', acting_for: input.acting_for ?? null },
    });
    return { summary: `Recorded "${input.decision}" on "${answer.step.label}".`, data: answer };
  },
});

export const gate_override = defineTool({
  name: 'gate_override',
  group: 'deciding',
  title: 'Override a gate',
  description:
    'Complete a step although its gate is not met, with a reason. Only for holders of a manager role where the template allows it; otherwise refused with who can do it.',
  input: z.object({ step: z.string(), reason: z.string().min(1), outcome: z.string().optional() }),
  calls: ['gate_override'],
  readOnly: false,
  async handler(input, ctx) {
    const moved = await ctx.client.call('gate_override', {
      params: { step: input.step },
      body: { reason: input.reason, ...(input.outcome ? { outcome: input.outcome } : {}) },
    });
    return { summary: `Gate overridden; "${moved.step.label}" completed.`, data: moved };
  },
});

export const step_skip = defineTool({
  name: 'step_skip',
  group: 'deciding',
  title: 'Skip a step',
  description:
    'Skip a step with a reason. First shows which inputs later steps would miss; give values for them, or continue_empty to go on without them. Refused with a reason where not permitted.',
  input: z.object({
    step: z.string(),
    reason: z.string().min(1),
    values: z.record(z.string(), z.unknown()).optional().describe('Values for the inputs later steps would miss'),
    continue_empty: z.boolean().optional(),
  }),
  calls: ['step_skip_preview', 'step_skip'],
  readOnly: false,
  async handler(input, ctx) {
    const preview = await ctx.client.call('step_skip_preview', { params: { step: input.step } });
    const missing = preview.missing_downstream;
    if (!input.values && !input.continue_empty && missing.length > 0) {
      return {
        summary: [
          'Not skipped yet. Later steps would miss these inputs:',
          ...missing.map((m) => `- ${m.label}: ${m.input}${m.required ? ' (required)' : ''}`),
          'Call again with values for them, or with continue_empty true.',
        ].join('\n'),
        data: preview,
      };
    }
    const body = input.continue_empty
      ? { reason: input.reason, continue_empty: true as const }
      : { reason: input.reason, values: input.values ?? {}, continue_empty: false as const };
    const moved = await ctx.client.call('step_skip', { params: { step: input.step }, body });
    return { summary: `Skipped "${moved.step.label}".`, data: moved };
  },
});
