/** Identity and notification tools: whoami, inbox_read, inbox_ack, changes_since (US-D-6, US-D-13, US-D-31). */
import { z } from 'zod';
import { describeIdentity } from '../identity.ts';
import { defineTool } from './types.ts';

export const whoami = defineTool({
  name: 'whoami',
  group: 'identity',
  title: 'Who am I',
  description:
    'The connection check: this agent account, its owner, organisation, roles, limits, whether it may contact partners, whether it is paused, the interface version and how notifications reach it. Call it first in a session.',
  input: z.object({}),
  calls: ['whoami', 'meta_get'],
  readOnly: true,
  async handler(_input, ctx) {
    const [who, meta] = await Promise.all([ctx.client.call('whoami'), ctx.client.call('meta_get')]);
    const harness = ctx.client.userAgent.split('/')[1] ?? 'mcp';
    return { summary: describeIdentity(who, meta, ctx.client.site, ctx.push, harness).join('\n'), data: who, unread: who.unread };
  },
});

export const inbox_read = defineTool({
  name: 'inbox_read',
  group: 'notifications',
  title: 'Read the inbox',
  description:
    'Read the agent inbox in order: assignments, answers, mentions, reminders and state changes. Durable: everything sent while offline is still there. Pass next_cursor to read on; acknowledge with inbox_ack.',
  input: z.object({
    cursor: z.string().optional().describe('next_cursor from an earlier read; omit to start at the oldest unacknowledged item'),
    limit: z.number().int().min(1).max(200).optional(),
    unacked_only: z.boolean().optional().describe('Default true: only items not yet acknowledged'),
  }),
  calls: ['inbox_read'],
  readOnly: true,
  async handler(input, ctx) {
    const page = await ctx.client.call('inbox_read', { query: input });
    const lines = page.items.map((n) => `- [${n.type}] ${n.title} (${new URL(n.link, ctx.client.site).toString()}) id ${n.id}`);
    const summary = page.items.length
      ? [
          `${page.items.length} inbox item(s), ${page.unread} unread in all:`,
          ...lines,
          page.next_cursor ? `More: inbox_read with cursor ${page.next_cursor}` : 'No more items.',
        ].join('\n')
      : 'The inbox has nothing new.';
    return { summary, data: page, unread: page.unread };
  },
});

export const inbox_ack = defineTool({
  name: 'inbox_ack',
  group: 'notifications',
  title: 'Acknowledge inbox items',
  description:
    'Mark inbox items as read, by their ids or everything up to a cursor from inbox_read. Acknowledged items leave the unread list.',
  input: z.object({
    ids: z.array(z.string()).optional().describe('Notification ids to acknowledge'),
    up_to: z.string().optional().describe('Acknowledge everything up to this cursor'),
  }),
  calls: ['inbox_ack'],
  readOnly: false,
  async handler(input, ctx) {
    const body = input.ids?.length ? { ids: input.ids } : input.up_to ? { up_to: input.up_to } : null;
    if (!body) return { summary: 'Nothing acknowledged: give ids or up_to.' };
    const answer = await ctx.client.call('inbox_ack', { body });
    return { summary: `Acknowledged ${answer.acked}; ${answer.unread} unread left.`, data: answer, unread: answer.unread };
  },
});

export const changes_since = defineTool({
  name: 'changes_since',
  group: 'notifications',
  title: 'What changed since I last looked',
  description:
    'Every assignment, answer, comment and state change touching my queues and my steps since a time. Enough on its own to find all work: nothing reaches this agent through any hidden way. Omit since to continue from the last call in this place.',
  input: z.object({
    since: z
      .string()
      .optional()
      .describe('ISO time; omit to use the as_of of the previous changes_since (or the last 24 hours the first time)'),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  calls: ['changes_since'],
  readOnly: true,
  async handler(input, ctx) {
    const since = input.since ?? ctx.state.read().changesSince ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const page = await ctx.client.call('changes_since', {
      query: { since, ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {}) },
    });
    if (!page.next_cursor) {
      ctx.state.update((s) => {
        s.changesSince = page.as_of;
      });
    }
    const lines = page.items.map((c) => `- ${c.at} [${c.kind}] ${c.run.name}${c.step ? ` / ${c.step.label}` : ''}: ${c.summary}`);
    const summary = [
      page.items.length ? `${page.items.length} change(s) since ${since}:` : `Nothing changed since ${since}.`,
      ...lines,
      page.next_cursor ? `More: changes_since with since ${since} and cursor ${page.next_cursor}` : `Next time: since ${page.as_of}`,
    ].join('\n');
    return { summary, data: page };
  },
});
