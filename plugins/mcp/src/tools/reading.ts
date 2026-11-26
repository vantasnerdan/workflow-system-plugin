/**
 * Reading tools: run_list, run_map, step_open, attempt_open, thread_read, artifact_download,
 * rule_set_get, conversations_list (US-D-14 to US-D-18, US-D-30). Reading follows access: a run the
 * agent cannot see is refused with `not_found`, never partly hidden.
 */
import type { Answer } from '@wf/client';
import { z } from 'zod';
import { Detail, waitingText } from './queues.ts';
import { defineTool } from './types.ts';

type MapNode = Answer<'run_map'>['nodes'][number];

function nodeLine(node: MapNode): string {
  if (node.kind !== 'component') return `- ${node.label} (${node.kind})`;
  const steps = node.steps.length
    ? node.steps
        .map((s) => {
          const parts = [s.state, s.owner ? `owner ${s.owner.name}` : 'no owner'];
          if (s.dueAt) parts.push(`due ${s.dueAt}`);
          if (s.waitingOn) parts.push(waitingText(s.waitingOn));
          if (s.itemKey) parts.unshift(`item ${s.itemKey}`);
          if (s.round > 1) parts.unshift(`round ${s.round}`);
          return `${parts.join(', ')} (step id ${s.id})`;
        })
        .join('; ')
    : 'not reached';
  const marks = node.marks.length ? ` [${node.marks.join(', ')}]` : '';
  return `- ${node.label}${marks}: ${steps}${node.accepted_result ? `. Accepted: ${node.accepted_result}` : ''}`;
}

export const run_list = defineTool({
  name: 'run_list',
  group: 'reading',
  title: 'Runs',
  description: 'Runs I can see, filtered by template or status, or searched by name or reference.',
  input: z.object({
    template: z.string().optional(),
    status: z.enum(['running', 'completed', 'cancelled']).optional(),
    q: z.string().optional().describe('Search by name or reference'),
    detail: Detail,
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  calls: ['run_list'],
  readOnly: true,
  async handler(input, ctx) {
    const page = await ctx.client.call('run_list', { query: input });
    const lines = page.items.map(
      (r) =>
        `- ${r.name} (${r.ref}), ${r.template_name} v${r.templateVersion}, ${r.status}${r.blocked ? ', blocked' : ''}${r.overdue ? ', overdue' : ''}; now at ${
          r.current_steps.map((s) => `${s.label} (${s.state})`).join(', ') || 'nothing open'
        }`,
    );
    return { summary: page.items.length ? [`${page.items.length} run(s):`, ...lines].join('\n') : 'No runs match.', data: page };
  },
});

export const run_map = defineTool({
  name: 'run_map',
  group: 'reading',
  title: 'Map of a run',
  description:
    'The whole map of a run I can access. format summary (default): every block with its state, owner, due date, who it waits on and the accepted result, short. format mermaid: the flow as mermaid text with state and owner on each block, the same diagram people see. format full: everything, including all fields.',
  input: z.object({
    run: z.string().describe('Run id or readable reference'),
    format: z.enum(['summary', 'mermaid', 'full']).optional(),
  }),
  calls: ['run_map'],
  readOnly: true,
  async handler(input, ctx) {
    const format = input.format ?? 'summary';
    if (format === 'mermaid') {
      const text = await ctx.client.text('run_map', { params: { run: input.run }, query: { format: 'mermaid', detail: 'summary' } });
      return { summary: text, data: { format: 'mermaid', text } };
    }
    const map = await ctx.client.call('run_map', {
      params: { run: input.run },
      query: { format: 'json', detail: format === 'full' ? 'full' : 'summary' },
    });
    const head = `Run ${map.run.name} (${map.run.ref}), ${map.run.status}, template version ${map.run.templateVersion}${map.run.owner ? `, owner ${map.run.owner.name}` : ''}:`;
    return { summary: [head, ...map.nodes.map(nodeLine)].join('\n'), data: format === 'full' ? map : { run: map.run, nodes: map.nodes } };
  },
});

export const step_open = defineTool({
  name: 'step_open',
  group: 'reading',
  title: 'Open a step',
  description:
    'Open one step: its component and instructions (settings), the inputs received from earlier steps, attempts, the accepted result, gate status with unmet parts, participants, timers, open questions, who it waits on, and what I may do on it now. detail summary is short; full gives everything.',
  input: z.object({ step: z.string().describe('Step id'), detail: Detail }),
  calls: ['step_open'],
  readOnly: true,
  async handler(input, ctx) {
    const view = await ctx.client.call('step_open', { params: { step: input.step }, query: input.detail ? { detail: input.detail } : {} });
    const s = view.step;
    const lines = [
      `${s.label} in ${view.run.name} (${view.run.ref}): ${view.component.name}, state ${s.state}`,
      `Owner: ${s.owner?.name ?? 'none'}; assigned to ${s.assignee?.name ?? 'nobody'}; ${waitingText(s.waitingOn)}`,
      `Due: ${s.dueAt ?? 'no due date'}`,
      `Inputs: ${view.inputs.map((i) => `${i.name}${i.missing ? ' (missing)' : i.superseded ? ' (superseded)' : ''}`).join(', ') || 'none'}`,
      `Attempts: ${view.attempts.length}${view.accepted ? `; accepted ${view.accepted.id} by ${view.accepted.author.name}` : '; none accepted'}`,
      view.gate.present
        ? `Gate: ${view.gate.describe.join(' ')}${view.gate.unmet.length ? `. Not met yet: ${view.gate.unmet.join('; ')}` : '. Met.'}`
        : 'Gate: none',
      `Open questions: ${view.open_questions}`,
      `I may: ${view.actions.join(', ') || 'only read'}`,
    ];
    return { summary: lines.join('\n'), data: view };
  },
});

export const attempt_open = defineTool({
  name: 'attempt_open',
  group: 'reading',
  title: 'Open an attempt',
  description: 'One attempt with its author, result, explanation, evidence and file ids, and whether it is the accepted one.',
  input: z.object({ attempt: z.string().describe('Attempt id') }),
  calls: ['attempt_open'],
  readOnly: true,
  async handler(input, ctx) {
    const a = await ctx.client.call('attempt_open', { params: { attempt: input.attempt } });
    const summary = [
      `Attempt by ${a.author.name} at ${a.createdAt}, ${a.status}${a.acceptedAt ? ' (accepted)' : ''}`,
      `Explanation: ${a.explanation || '(none)'}`,
      `Evidence: ${a.evidence.map((e) => `${e.kind} ${e.ref}${e.note ? ` (${e.note})` : ''}`).join('; ') || 'none'}`,
      `Files: ${a.artifactIds.join(', ') || 'none'} (artifact_download to read one)`,
    ].join('\n');
    return { summary, data: a };
  },
});

export const thread_read = defineTool({
  name: 'thread_read',
  group: 'reading',
  title: 'Read a thread',
  description: 'The comment thread of a step (give step) or of a run (give run): comments, questions and answers, oldest first.',
  input: z.object({
    step: z.string().optional(),
    run: z.string().optional(),
    kind: z.enum(['comment', 'question', 'answer']).optional().describe('Only comments of this kind'),
    open_only: z.boolean().optional().describe('Only open questions'),
  }),
  calls: ['run_thread_read', 'step_thread_read'],
  readOnly: true,
  async handler(input, ctx) {
    const query = { ...(input.kind ? { kind: input.kind } : {}), ...(input.open_only !== undefined ? { open_only: input.open_only } : {}) };
    let thread: Answer<'step_thread_read'>;
    if (input.step) thread = await ctx.client.call('step_thread_read', { params: { step: input.step }, query });
    else if (input.run) thread = await ctx.client.call('run_thread_read', { params: { run: input.run }, query });
    else throw new Error('Give step or run.');
    const lines = thread.comments.map(
      (c) =>
        `- ${c.createdAt} ${c.author.name}${c.kind === 'question' ? ` asked${c.addressedTo ? ` ${c.addressedTo.name}` : ''}${c.blocking ? ' (blocking)' : ''}${c.answeredByCommentId ? ', answered' : ', open'}` : ''}: ${c.body} (id ${c.id})`,
    );
    return {
      summary: [
        `${thread.comments.length} comment(s), ${thread.open_questions} open question(s), ${thread.blocking_questions} blocking:`,
        ...lines,
      ].join('\n'),
      data: thread,
    };
  },
});

export const artifact_download = defineTool({
  name: 'artifact_download',
  group: 'reading',
  title: 'Read or download a file',
  description:
    'A file or record of a step with its versions and status label (guideline, final or superseded). Give to_path to save the bytes of a file version on this machine; an interrupted download resumes, and the checksum is verified.',
  input: z.object({
    artifact: z.string().describe('Artifact id'),
    version: z
      .union([z.number().int().positive(), z.literal('latest')])
      .optional()
      .describe('Version number; default latest'),
    to_path: z.string().optional().describe('Local path to save the file to'),
  }),
  calls: ['artifact_get', 'artifact_download'],
  readOnly: true,
  async handler(input, ctx) {
    if (input.to_path) {
      const saved = await ctx.files.download(input.artifact, input.version ?? 'latest', input.to_path);
      return {
        summary: `Saved ${saved.size} bytes to ${saved.path}${saved.resumedFrom ? ` (resumed from byte ${saved.resumedFrom})` : ''}${saved.version?.sha256 ? '; checksum verified' : ''}.`,
        data: saved,
      };
    }
    const detail = await ctx.client.call('artifact_get', { params: { artifact: input.artifact }, query: { detail: 'standard' } });
    const latest = detail.latest as { number?: number; label?: string | null; originalName?: string; size?: number } | null;
    return {
      summary: `${detail.artifact.name ?? input.artifact}: latest version ${latest?.number ?? '-'}${latest?.label ? ` (${latest.label})` : ''}${
        latest?.size !== undefined ? `, ${latest.size} bytes` : ''
      }. Give to_path to save it.`,
      data: detail,
    };
  },
});

export const rule_set_get = defineTool({
  name: 'rule_set_get',
  group: 'reading',
  title: 'Read a rule set',
  description: 'A rule set with the rules of one version (default the latest), for agent checks.',
  input: z.object({ rule_set: z.string(), version: z.number().int().positive().optional() }),
  calls: ['rule_set_get'],
  readOnly: true,
  async handler(input, ctx) {
    const view = await ctx.client.call('rule_set_get', {
      params: { rule_set: input.rule_set },
      query: input.version ? { version: input.version } : {},
    });
    return { summary: `Rule set ${input.rule_set}.`, data: view };
  },
});

export const conversations_list = defineTool({
  name: 'conversations_list',
  group: 'reading',
  title: 'My conversations',
  description:
    'Every thread this agent took part in or was asked in: mentions, questions it asked and questions put to it, newest first, with links to the step.',
  input: z.object({ open_only: z.boolean().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }),
  calls: ['conversations_list'],
  readOnly: true,
  async handler(input, ctx) {
    const page = await ctx.client.call('conversations_list', { query: input });
    const lines = page.items.map(
      (c) =>
        `- ${c.updated_at} ${c.run ? `${c.run.name}${c.step ? ` / ${c.step.label}` : ''}` : c.draft ? `draft of ${c.draft.template_name}` : 'thread'}: ${c.last_comment.author.name}: ${c.last_comment.body}${
          c.open_questions ? ` (${c.open_questions} open question(s))` : ''
        }`,
    );
    return {
      summary: page.items.length ? [`${page.items.length} conversation(s):`, ...lines].join('\n') : 'No conversations yet.',
      data: page,
    };
  },
});
