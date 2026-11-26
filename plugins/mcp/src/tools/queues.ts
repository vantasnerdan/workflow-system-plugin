/** Queue tools: queue_list, step_claim, step_release, step_reassign (US-D-9 to US-D-12). */
import type { Answer } from '@wf/client';
import { z } from 'zod';
import { defineTool } from './types.ts';

export const Detail = z
  .enum(['summary', 'standard', 'full'])
  .optional()
  .describe('How much to return; summary is short, nothing is withheld at full');
export const Subject = z.object({
  kind: z.enum(['account', 'group', 'role', 'org']),
  id: z.string().describe('Id of the person, agent, group, role or organisation'),
});

type WorkItem = Answer<'queue_list'>['items'][number];

export function waitingText(waiting: WorkItem['step']['waitingOn']): string {
  if (!waiting) return 'waits on nobody';
  const who = waiting.subject?.name ?? waiting.thing ?? waiting.kind;
  return `waits on ${who} since ${waiting.since}`;
}

export function workLine(item: WorkItem): string {
  const s = item.step;
  const parts = [
    `[${item.view}] ${item.run.name} (${item.run.ref}) / ${s.label}`,
    `state ${s.state}`,
    s.owner ? `owner ${s.owner.name}` : item.queue ? `in queue ${item.queue.name}` : 'no owner',
    s.dueAt ? `due ${s.dueAt}${item.overdue ? ' (overdue)' : ''}` : 'no due date',
    waitingText(s.waitingOn),
  ];
  if (item.question)
    parts.push(`question from ${item.question.from.name}${item.question.blocking ? ' (blocking)' : ''}: ${item.question.excerpt}`);
  return `- ${parts.join('; ')}. Step id ${s.id}`;
}

export const queue_list = defineTool({
  name: 'queue_list',
  group: 'queues',
  title: 'My work and my queues',
  description:
    'My work: steps assigned to me, steps in the role, group and organisation queues I belong to, steps I hold as backup, questions for me, approvals for me, overdue. Each entry has run, step, state, due date, who it waits on and since when. Give view to see one list, queue to see one shared queue (with who else could claim), or list_queues to see which queues I belong to.',
  input: z.object({
    view: z.enum(['assigned', 'queues', 'backup', 'questions', 'approvals', 'overdue']).optional(),
    queue: z
      .object({ kind: z.enum(['role', 'group', 'org']), subject: z.string().describe('Role, group or organisation id') })
      .optional()
      .describe('One shared queue'),
    claimed: z.boolean().optional().describe('With queue: only claimed (true) or unclaimed (false) steps'),
    list_queues: z.boolean().optional().describe('List the queues I belong to, with open and overdue counts'),
    template: z.string().optional().describe('Only steps of this template (key or id)'),
    detail: Detail,
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  calls: ['queue_list', 'queue_memberships', 'queue_get'],
  readOnly: true,
  async handler(input, ctx) {
    const paging = {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    };
    if (input.list_queues) {
      const answer = await ctx.client.call('queue_memberships', { query: {} });
      const lines = answer.items.map((q) => `- ${q.queue.name} (${q.queue.kind} ${q.queue.id}): ${q.open} open, ${q.overdue} overdue`);
      return { summary: answer.items.length ? ['My queues:', ...lines].join('\n') : 'I belong to no shared queue.', data: answer };
    }
    if (input.queue) {
      const answer = await ctx.client.call('queue_get', {
        params: { kind: input.queue.kind, subject: input.queue.subject },
        query: { ...paging, ...(input.claimed !== undefined ? { claimed: input.claimed } : {}) },
      });
      const lines = answer.items.map(workLine);
      const summary = answer.items.length
        ? [`Queue ${answer.queue.name}: ${answer.items.length} step(s)`, ...lines].join('\n')
        : `Queue ${answer.queue.name} is empty.`;
      return { summary, data: answer };
    }
    const answer = await ctx.client.call('queue_list', {
      query: { ...paging, ...(input.view ? { view: input.view } : {}), ...(input.template ? { template: input.template } : {}) },
    });
    const c = answer.counts;
    const head = `My work: ${c.assigned} assigned, ${c.queues} in my queues, ${c.backup} as backup, ${c.questions} questions for me, ${c.approvals} approvals for me, ${c.overdue} overdue.`;
    const summary = answer.items.length
      ? [head, ...answer.items.map(workLine), answer.next_cursor ? `More: queue_list with cursor ${answer.next_cursor}` : '']
          .filter(Boolean)
          .join('\n')
      : `${head}\nNothing here: the list is empty (not an error).`;
    return { summary, data: answer };
  },
});

export const step_claim = defineTool({
  name: 'step_claim',
  group: 'queues',
  title: 'Claim a step',
  description:
    'Take a step from a role, group or organisation queue so others see I am working on it. If someone claimed it first, the answer says who has it.',
  input: z.object({ step: z.string().describe('Step id') }),
  calls: ['step_claim'],
  readOnly: false,
  async handler(input, ctx) {
    const step = await ctx.client.call('step_claim', { params: { step: input.step } });
    return { summary: `Claimed "${step.label}". Owner is now ${step.owner?.name ?? 'me'}.`, data: step };
  },
});

export const step_release = defineTool({
  name: 'step_release',
  group: 'queues',
  title: 'Give a step back',
  description: 'Give a claimed step back to its queue, with an optional note for the next person.',
  input: z.object({ step: z.string(), note: z.string().optional() }),
  calls: ['step_release'],
  readOnly: false,
  async handler(input, ctx) {
    const step = await ctx.client.call('step_release', { params: { step: input.step }, body: input.note ? { note: input.note } : {} });
    return { summary: `Gave "${step.label}" back to its queue.`, data: step };
  },
});

export const step_reassign = defineTool({
  name: 'step_reassign',
  group: 'queues',
  title: 'Reassign a step',
  description:
    'Hand a step to another person, agent, role, group or organisation with a note (required). The new owner is notified and sees the note. Others with access can still open the step, comment and add attempts.',
  input: z.object({ step: z.string(), to: Subject, note: z.string().min(1) }),
  calls: ['step_reassign'],
  readOnly: false,
  async handler(input, ctx) {
    const step = await ctx.client.call('step_reassign', { params: { step: input.step }, body: { to: input.to, note: input.note } });
    return { summary: `Reassigned "${step.label}" to ${step.owner?.name ?? step.assignee?.name ?? 'the new owner'}.`, data: step };
  },
});
