/**
 * Starting and authoring tools (US-D-48, US-D-49, US-B-11, US-B-15). An authoring agent writes the
 * flow as text in the site's notation, or edits it with block operations, sets every block's
 * settings, validates, dry-runs (which notifies nobody) and proposes fixes. Every edit is a recorded
 * change attributed to the agent; publishing is refused unless the agent is in the Publisher group.
 * The conversation with the person stays in the harness: the site shows only the draft and its notes.
 */
import type { Answer, RequestBody, WfClient } from '@wf/client';
import { z } from 'zod';
import { defineTool } from './types.ts';

type DraftView = Answer<'draft_get'>;
type Problems = DraftView['problems'];

function problemLines(problems: Problems): string[] {
  if (!problems.length) return ['No problems.'];
  return problems.map(
    (p) =>
      `- ${p.severity === 'error' ? 'Must fix' : 'Warning'}: ${p.message}${p.fixes.length ? ` (${p.fixes.length} suggested fix(es))` : ''}`,
  );
}

function draftSummary(view: DraftView): string {
  return [
    `Draft ${view.draft.id} of "${view.template.name}" (${view.template.key}), revision ${view.draft.rev}; ${view.proposed_ops} proposed change(s), ${view.open_notes} open note(s).`,
    ...problemLines(view.problems),
  ].join('\n');
}

async function currentRev(client: WfClient, draft: string, given?: number): Promise<number> {
  if (given !== undefined) return given;
  return (await client.call('draft_get', { params: { draft }, query: { detail: 'summary' } })).draft.rev;
}

const BaseRev = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    'The revision you last read; when someone changed the draft since, the edit is refused as changed meanwhile. Omit to apply to the latest revision.',
  );

const DraftOps = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    'Block operations: add_block, move_block, delete_block, rename_block, add_path, remove_path, add_column, remove_column, set_ending, set_settings, or replace_text. notation_reference describes each.',
  );

export const template_list = defineTool({
  name: 'template_list',
  group: 'starting',
  title: 'Templates I can start',
  description:
    'The templates this agent may start, with the start inputs each one needs. Set startable false to list every template it can see.',
  input: z.object({
    startable: z.boolean().optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  calls: ['template_list'],
  readOnly: true,
  async handler(input, ctx) {
    const page = await ctx.client.call('template_list', { query: { ...input, startable: input.startable ?? true, detail: 'standard' } });
    const lines = page.items.map((t) => {
      const schema = (t.start_input_schema ?? {}) as { properties?: Record<string, { description?: string }>; required?: string[] };
      const required = new Set(schema.required ?? []);
      const inputs = Object.entries(schema.properties ?? {}).map(
        ([name, p]) => `${name}${required.has(name) ? ' (required)' : ''}${p.description ? `: ${p.description}` : ''}`,
      );
      return `- ${t.name} (${t.key}), version ${t.latestVersion || 'none published'}${t.startable ? '' : ', not startable by me'}; start inputs: ${
        inputs.join('; ') || 'none'
      }`;
    });
    return {
      summary: page.items.length ? [`${page.items.length} template(s):`, ...lines].join('\n') : 'No template to start.',
      data: page,
    };
  },
});

export const run_start = defineTool({
  name: 'run_start',
  group: 'starting',
  title: 'Start a run',
  description:
    'Start a run of a template with its start inputs (template_list shows them). Missing or invalid inputs are refused with their names. The run shows this agent as who started it.',
  input: z.object({
    template: z.string().describe('Template key or id'),
    version: z.number().int().positive().optional().describe('Default the latest published version'),
    start_inputs: z.record(z.string(), z.unknown()),
    name: z.string().optional(),
  }),
  calls: ['run_start'],
  readOnly: false,
  async handler(input, ctx) {
    const run = await ctx.client.call('run_start', { body: input });
    return { summary: `Started "${run.name}" (${run.ref}), run id ${run.id}.`, data: run };
  },
});

export const notation_reference = defineTool({
  name: 'notation_reference',
  group: 'authoring',
  title: 'Notation and components',
  description:
    'The notation the site uses for flows (mermaid profile and block stack) and the catalogue of components with their inputs, outputs, settings and outcomes. Read it before writing a flow.',
  input: z.object({}),
  calls: ['notation_reference'],
  readOnly: true,
  async handler(_input, ctx) {
    const ref = await ctx.client.call('notation_reference');
    const lines = ref.components.map(
      (c) => `- ${c.key}: ${c.name}${c.version.outcomes.length ? ` (outcomes: ${c.version.outcomes.join(', ')})` : ''}. ${c.description}`,
    );
    return { summary: [`Interface ${ref.interface_version}. Components:`, ...lines, '', ref.spec].join('\n'), data: ref };
  },
});

export const draft_create = defineTool({
  name: 'draft_create',
  group: 'authoring',
  title: 'Create a draft',
  description:
    'Create a new template with its first draft (give key and name), or open a draft of an existing template (give template, optionally from_version). The person who asked owns it; every change is attributed to this agent.',
  input: z.object({
    template: z.string().optional().describe('Existing template key or id'),
    from_version: z.number().int().positive().optional(),
    key: z.string().optional().describe('New template: short key, lower case with dashes'),
    name: z.string().optional().describe('New template: its name'),
    run_name_pattern: z.string().optional(),
    run_ref_pattern: z.string().optional(),
  }),
  calls: ['template_create', 'draft_create'],
  readOnly: false,
  async handler(input, ctx) {
    if (input.template) {
      const view = await ctx.client.call('draft_create', {
        body: { template: input.template, ...(input.from_version ? { from_version: input.from_version } : {}) },
      });
      return { summary: draftSummary(view), data: view };
    }
    if (!input.key || !input.name) throw new Error('Give template (existing) or key and name (new).');
    const view = await ctx.client.call('template_create', {
      body: {
        key: input.key,
        name: input.name,
        ...(input.run_name_pattern ? { run_name_pattern: input.run_name_pattern } : {}),
        ...(input.run_ref_pattern ? { run_ref_pattern: input.run_ref_pattern } : {}),
      },
    });
    return { summary: draftSummary(view), data: view };
  },
});

export const draft_get = defineTool({
  name: 'draft_get',
  group: 'authoring',
  title: 'Read a draft',
  description: 'A draft: the flow text, the settings of every block, the block stack, and its current problems in plain words.',
  input: z.object({ draft: z.string(), detail: z.enum(['summary', 'standard', 'full']).optional() }),
  calls: ['draft_get'],
  readOnly: true,
  async handler(input, ctx) {
    const view = await ctx.client.call('draft_get', { params: { draft: input.draft }, query: { detail: input.detail ?? 'full' } });
    return { summary: `${draftSummary(view)}\n\nText:\n${view.draft.diagramText}`, data: view };
  },
});

export const draft_edit = defineTool({
  name: 'draft_edit',
  group: 'authoring',
  title: 'Edit a draft',
  description:
    'Change a draft with block operations, or replace the whole flow text (give text). mode propose records the change for the draft owner to accept instead of applying it. The answer lists the problems after the change.',
  input: z.object({
    draft: z.string(),
    ops: DraftOps.optional(),
    text: z.string().optional().describe('The whole flow text; recorded as one replace_text operation'),
    settings: z.record(z.string(), z.unknown()).optional().describe('With text: the settings document of every block'),
    base_rev: BaseRev,
    mode: z.enum(['apply', 'propose']).optional(),
    note: z.string().optional(),
  }),
  calls: ['draft_edit', 'draft_get'],
  readOnly: false,
  async handler(input, ctx) {
    const ops =
      input.text !== undefined
        ? [{ op: 'replace_text', text: input.text, ...(input.settings ? { settings: input.settings } : {}) }, ...(input.ops ?? [])]
        : (input.ops ?? []);
    if (ops.length === 0) return { summary: 'Nothing changed: give ops or text.' };
    const base_rev = await currentRev(ctx.client, input.draft, input.base_rev);
    const answer = await ctx.client.call('draft_edit', {
      params: { draft: input.draft },
      body: { base_rev, ops, mode: input.mode ?? 'apply', ...(input.note ? { note: input.note } : {}) } as RequestBody<'draft_edit'>,
    });
    return {
      summary: [
        `${input.mode === 'propose' ? 'Proposed' : 'Applied'} ${answer.ops.length} change(s); now revision ${answer.rev}.`,
        ...problemLines(answer.problems),
      ].join('\n'),
      data: answer,
    };
  },
});

export const draft_settings_set = defineTool({
  name: 'draft_settings_set',
  group: 'authoring',
  title: "Set a block's settings",
  description:
    'Replace the settings of one block: assignee, due date, gate rule, instructions, languages and translations for partner steps, the agent-approval mode of approvals, and every component-specific setting. Recorded as one change; problems come back in the answer.',
  input: z.object({
    draft: z.string(),
    node: z.string().describe('The block id in the flow text'),
    settings: z.record(z.string(), z.unknown()),
    base_rev: BaseRev,
  }),
  calls: ['draft_settings_set', 'draft_get'],
  readOnly: false,
  async handler(input, ctx) {
    const base_rev = await currentRev(ctx.client, input.draft, input.base_rev);
    const answer = await ctx.client.call('draft_settings_set', {
      params: { draft: input.draft, node: input.node },
      body: { base_rev, settings: input.settings },
    });
    return {
      summary: [`Settings of ${input.node} saved; now revision ${answer.rev}.`, ...problemLines(answer.problems)].join('\n'),
      data: answer,
    };
  },
});

export const draft_note_add = defineTool({
  name: 'draft_note_add',
  group: 'authoring',
  title: 'Leave a note on a draft',
  description:
    'Leave a note on the draft or on one block, for example an explanation of a choice or a question marked "to confirm" for the person.',
  input: z.object({
    draft: z.string(),
    body: z.string().min(1),
    node_id: z.string().optional(),
    to_confirm: z.boolean().optional(),
    mentions: z.array(z.string()).optional(),
    parent_id: z.string().optional(),
  }),
  calls: ['draft_note_add'],
  readOnly: false,
  async handler(input, ctx) {
    const note = await ctx.client.call('draft_note_add', {
      params: { draft: input.draft },
      body: {
        body: input.body,
        node_id: input.node_id ?? null,
        to_confirm: input.to_confirm ?? false,
        mentions: input.mentions ?? [],
        parent_id: input.parent_id ?? null,
      },
    });
    return {
      summary: `Note added (id ${note.id})${input.node_id ? ` on ${input.node_id}` : ''}${input.to_confirm ? ', marked to confirm' : ''}.`,
      data: note,
    };
  },
});

export const draft_validate = defineTool({
  name: 'draft_validate',
  group: 'authoring',
  title: 'Check a draft',
  description:
    'Check the draft against every rule. Errors stop publishing, warnings do not. Each problem is explained in plain words, with suggested fixes where one exists.',
  input: z.object({ draft: z.string() }),
  calls: ['draft_validate'],
  readOnly: true,
  async handler(input, ctx) {
    const answer = await ctx.client.call('draft_validate', { params: { draft: input.draft } });
    return {
      summary: [
        `Revision ${answer.rev}: ${answer.publishable ? 'can be published' : 'cannot be published yet'}.`,
        ...problemLines(answer.problems),
      ].join('\n'),
      data: answer,
    };
  },
});

export const draft_dry_run = defineTool({
  name: 'draft_dry_run',
  group: 'authoring',
  title: 'Dry run a draft',
  description:
    'Run the draft in memory with sample start inputs and the choice to take at each decision or approval. Nothing is sent and nobody is notified. Shows the path and who would get what when.',
  input: z.object({
    draft: z.string(),
    start_inputs: z.record(z.string(), z.unknown()).optional(),
    choices: z.record(z.string(), z.unknown()).optional().describe('Per block id: the outcome to take, or a simulated value'),
    sample_set_id: z.string().optional(),
  }),
  calls: ['draft_dry_run'],
  readOnly: true,
  async handler(input, ctx) {
    const run = await ctx.client.call('draft_dry_run', {
      params: { draft: input.draft },
      body: {
        start_inputs: input.start_inputs ?? {},
        choices: input.choices ?? {},
        ...(input.sample_set_id ? { sample_set_id: input.sample_set_id } : {}),
      },
    });
    const lines = run.timeline.map((t) => `- ${t.at} ${t.label}: ${t.event}${t.who ? ` (${t.who.name})` : ''}. ${t.detail}`);
    const end = run.ended ? `Ended at ${run.ended.label}.` : run.stopped ? `Stopped: ${run.stopped}` : 'Did not reach an end.';
    return { summary: ['Dry run (nothing sent):', ...lines, end].join('\n'), data: run };
  },
});

export const draft_fix_propose = defineTool({
  name: 'draft_fix_propose',
  group: 'authoring',
  title: 'Propose a fix',
  description:
    'Propose a fix for the person to accept: one of the suggested fixes of a problem (problem_code, node_ids, fix_index from draft_validate), or own block operations. Shows the text before and after and the problems left.',
  input: z.object({
    draft: z.string(),
    suggested: z.object({ problem_code: z.string(), node_ids: z.array(z.string()), fix_index: z.number().int().nonnegative() }).optional(),
    ops: DraftOps.optional(),
    base_rev: BaseRev,
    note: z.string().optional(),
  }),
  calls: ['draft_fix_propose', 'draft_get'],
  readOnly: false,
  async handler(input, ctx) {
    const source = input.suggested ? { kind: 'suggested', ...input.suggested } : input.ops?.length ? { kind: 'ops', ops: input.ops } : null;
    if (!source) throw new Error('Give suggested or ops.');
    const base_rev = await currentRev(ctx.client, input.draft, input.base_rev);
    const preview = await ctx.client.call('draft_fix_propose', {
      params: { draft: input.draft },
      body: { base_rev, source, ...(input.note ? { note: input.note } : {}) } as RequestBody<'draft_fix_propose'>,
    });
    return {
      summary: [
        `Proposed ${preview.ops.length} change(s) for the owner to accept. Problems after:`,
        ...problemLines(preview.problems_after),
      ].join('\n'),
      data: preview,
    };
  },
});

export const draft_publish = defineTool({
  name: 'draft_publish',
  group: 'authoring',
  title: 'Publish a draft',
  description:
    'Publish the draft as the next template version with a change summary. Only members of the Publisher group may; anyone else is refused with a clear message. A published version is never changed: later edits are new drafts.',
  input: z.object({ draft: z.string(), change_summary: z.string().min(1), base_rev: BaseRev }),
  calls: ['draft_publish', 'draft_get'],
  readOnly: false,
  async handler(input, ctx) {
    const base_rev = await currentRev(ctx.client, input.draft, input.base_rev);
    const version = await ctx.client.call('draft_publish', {
      params: { draft: input.draft },
      body: { base_rev, change_summary: input.change_summary },
    });
    return { summary: `Published version ${version.number}.`, data: version };
  },
});

export const version_compare = defineTool({
  name: 'version_compare',
  group: 'authoring',
  title: 'Compare versions',
  description: 'What changed between two versions of a template, or between a version and a draft.',
  input: z.object({
    template: z.string(),
    from: z.number().int().positive(),
    to: z.number().int().positive().optional(),
    draft: z.string().optional(),
  }),
  calls: ['version_compare'],
  readOnly: true,
  async handler(input, ctx) {
    const { template, ...query } = input;
    const diff = await ctx.client.call('version_compare', { params: { template }, query });
    return { summary: `Compared version ${input.from} with ${input.draft ? 'the draft' : `version ${input.to ?? 'latest'}`}.`, data: diff };
  },
});
