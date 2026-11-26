/**
 * The stand-in for lane L7 (run screens), which is not merged yet: an in-memory site that answers the
 * operations of the queues, runs and steps areas (queues, run map, step view, claim, attempts, complete,
 * approvals, gates, skip, signals, run start), routed by the client's own operation table (so a path the
 * client gets wrong fails here), with objects shaped like the generated client types. Every operation
 * of a merged lane answers `not_implemented` here: the real site answers those in
 * live-site.db.test.ts. Besides L7 it answers only `meta_get` and `whoami`, which the server reads to
 * name the agent's owner in refusals. Generic fixture names only. One step is outside the agent's
 * limits, one is owned by someone else, one has an unmet gate.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Answer, type ErrorCode, type OperationId, operations, type Problem, problemOf } from '@wf/client';

type Step = Answer<'step_claim'>;
type Run = Answer<'run_start'>;
type Attempt = Answer<'attempt_add'>;
type SubjectRef = NonNullable<Step['owner']>;

export const KEY = 'wfa_testkey1_secretsecretsecret';
const now = () => new Date().toISOString();
const ORG = { id: randomUUID(), name: 'Internal Org', kind: 'internal' as const };

export const people = {
  agent: { kind: 'account', id: randomUUID(), name: 'Compliance Agent One' } as SubjectRef,
  owner: { kind: 'account', id: randomUUID(), name: 'Purchasing Lead One' } as SubjectRef,
  designer: { kind: 'account', id: randomUUID(), name: 'Designer One' } as SubjectRef,
  role: { kind: 'role', id: randomUUID(), name: 'Compliance agent' } as SubjectRef,
  managerRole: { kind: 'role', id: randomUUID(), name: 'Manager' } as SubjectRef,
  publishers: { kind: 'group', id: randomUUID(), name: 'Publisher' } as SubjectRef,
};

class Refusal extends Error {
  readonly code: ErrorCode;
  readonly extra: Partial<Problem>;
  constructor(code: ErrorCode, extra: Partial<Problem> = {}) {
    super(code);
    this.code = code;
    this.extra = extra;
  }
}

function stepOf(run: Run, nodeId: string, label: string, extra: Partial<Step> = {}): Step {
  return {
    id: randomUUID(),
    runId: run.id,
    nodeId,
    label,
    componentKey: 'agent_check',
    itemKey: null,
    round: 1,
    state: 'ready',
    assignee: null,
    owner: null,
    backup: null,
    actingAsBackup: false,
    activatedAt: now(),
    dueAt: null,
    waitingOn: null,
    blockedReasons: [],
    outcome: null,
    acceptedAttemptId: null,
    doneAt: null,
    completedBy: null,
    onBehalfOf: null,
    notNeeded: false,
    ...extra,
  } as Step;
}

function runOf(name: string, ref: string, startInputs: Record<string, unknown> = {}): Run {
  return {
    id: randomUUID(),
    ref,
    name,
    orgId: ORG.id,
    templateId: randomUUID(),
    templateVersionId: randomUUID(),
    templateVersion: 1,
    parentRunId: null,
    parentStepId: null,
    itemKey: null,
    owner: people.owner,
    status: 'running',
    startInputs,
    startedBy: people.owner.id,
    createdAt: now(),
    closedAt: null,
  } as Run;
}

export interface FakeSite {
  url: string;
  requests: { op: string; userAgent: string | undefined; idempotencyKey: string | undefined }[];
  run: Run;
  steps: { queued: Step; others: Step; limited: Step; gated: Step };
  close(): Promise<void>;
}

export async function startFakeSite(): Promise<FakeSite> {
  const run = runOf('Package design PD-1', 'PD-1');
  const steps = {
    queued: stepOf(run, 'check_artwork', 'Check the artwork', {
      assignee: people.role,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      waitingOn: { kind: 'role', subject: people.role, thing: null, since: now() },
    }),
    others: stepOf(run, 'review_text', 'Review the text', { assignee: people.designer, owner: people.designer, state: 'in_progress' }),
    limited: stepOf(run, 'approve_print', 'Approve for print', { componentKey: 'approval', assignee: people.role }),
    gated: stepOf(run, 'collect_files', 'Collect the files', { assignee: people.agent, owner: people.agent, state: 'in_progress' }),
  };
  const allSteps = new Map(Object.values(steps).map((s) => [s.id, s]));
  const runs = new Map<string, Run>([[run.id, run]]);
  const attempts = new Map<string, Attempt>();
  const requests: FakeSite['requests'] = [];

  const site: FakeSite = {
    url: '',
    requests,
    run,
    steps,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  const step = (id: string) => {
    const s = allSteps.get(id);
    if (!s) throw new Refusal('not_found');
    return s;
  };
  const brief = (r: Run) => ({ id: r.id, ref: r.ref, name: r.name, status: r.status, template_name: 'Package design' });
  const workItem = (s: Step, view: 'assigned' | 'queues') => ({
    view,
    step: {
      id: s.id,
      nodeId: s.nodeId,
      label: s.label,
      itemKey: s.itemKey,
      round: s.round,
      state: s.state,
      owner: s.owner,
      dueAt: s.dueAt,
      waitingOn: s.waitingOn,
    },
    run: brief(run),
    queue: view === 'queues' ? people.role : null,
    question: null,
    overdue: false,
    since: now(),
  });
  const handlers: Partial<
    Record<
      OperationId,
      (ctx: {
        params: Record<string, string>;
        query: URLSearchParams;
        body: unknown;
        raw: Buffer;
        req: IncomingMessage;
        res: ServerResponse;
      }) => unknown
    >
  > = {
    meta_get: () => ({
      interface_version: '1.0.0',
      api_base: '/api/v1',
      openapi: '/api/v1/openapi.json',
      documentation: '/docs/agent-interface',
    }),
    whoami: () => ({
      account: {
        id: people.agent.id,
        orgId: ORG.id,
        kind: 'agent',
        displayName: people.agent.name,
        email: null,
        locale: 'en',
        status: 'active',
        isOrgAdmin: false,
        isSystemAdmin: false,
        ownerAccountId: people.owner.id,
        pausedAt: null,
        absentUntil: null,
        externalContact: 'none',
        createdAt: now(),
      },
      org: ORG,
      owner: people.owner,
      roles: [{ id: people.role.id, name: people.role.name, via_group: null }],
      groups: [],
      permissions: [],
      limits: [{ id: randomUUID(), templateId: run.templateId, nodeId: null, componentKey: 'agent_check' }],
      external_contact: 'none',
      contact_orgs: [],
      paused: false,
      suspended: false,
      credential: { kind: 'key', label: 'Test key', ends_at: null },
      interface_version: '1.0.0',
      notification_mode: 'inbox',
      unread: 0,
    }),
    queue_list: () => {
      const mine = [...allSteps.values()].filter((s) => s.owner?.id === people.agent.id && s.state !== 'done');
      const queued = [...allSteps.values()].filter((s) => !s.owner && s.assignee?.id === people.role.id);
      const items = [...mine.map((s) => workItem(s, 'assigned')), ...queued.map((s) => workItem(s, 'queues'))];
      return {
        items,
        next_cursor: null,
        counts: { assigned: mine.length, queues: queued.length, backup: 0, questions: 0, approvals: 0, overdue: 0 },
      };
    },
    queue_memberships: () => ({ items: [{ queue: people.role, open: 2, overdue: 0 }] }),
    queue_get: () => ({
      items: [...allSteps.values()].filter((s) => s.assignee?.id === people.role.id).map((s) => workItem(s, 'queues')),
      next_cursor: null,
      queue: people.role,
    }),
    step_claim: ({ params }) => {
      const s = step(params.step ?? '');
      if (s.id === steps.limited.id) throw new Refusal('outside_limits');
      if (s.owner && s.owner.id !== people.agent.id) throw new Refusal('conflict', { detail: `${s.owner.name} claimed this step first.` });
      s.owner = people.agent;
      s.state = 'in_progress';
      s.waitingOn = { kind: 'account', subject: people.agent, thing: null, since: now() };
      return s;
    },
    step_release: ({ params }) => Object.assign(step(params.step ?? ''), { owner: null, state: 'ready' }),
    step_reassign: ({ params, body }) => {
      const to = (body as { to: { kind: SubjectRef['kind']; id: string } }).to;
      return Object.assign(step(params.step ?? ''), {
        owner: { ...to, name: to.id === people.designer.id ? people.designer.name : 'Someone' },
      });
    },
    run_list: () => ({
      items: [
        {
          ...run,
          template_name: 'Package design',
          current_steps: [{ node_id: 'check_artwork', label: 'Check the artwork', state: 'ready', since: now() }],
          blocked: false,
          overdue: false,
        },
      ],
      next_cursor: null,
    }),
    run_map: ({ params, query, res }) => {
      if (params.run !== run.ref && params.run !== run.id) throw new Refusal('not_found');
      if (query.get('format') === 'mermaid') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(
          `flowchart TD\n  start([Start]) --> check_artwork[["Check the artwork · ${steps.queued.state} · ${steps.queued.owner?.name ?? 'Compliance agent'}"]]\n  check_artwork --> review_text["Review the text · in_progress · Designer One"]\n`,
        );
        return STREAMING;
      }
      return {
        run,
        nodes: [...allSteps.values()].map((s) => ({
          node_id: s.nodeId,
          label: s.label,
          component_key: s.componentKey,
          kind: 'component',
          steps: [
            {
              id: s.id,
              itemKey: s.itemKey,
              round: s.round,
              state: s.state,
              owner: s.owner,
              dueAt: s.dueAt,
              waitingOn: s.waitingOn,
              outcome: s.outcome,
            },
          ],
          accepted_result: s.acceptedAttemptId ? 'Pass' : null,
          marks: [],
        })),
        edges: [{ from: 'check_artwork', to: 'review_text', label: null, kind: 'completion' }],
      };
    },
    step_open: ({ params }) => {
      const s = step(params.step ?? '');
      const own = [...attempts.values()].filter((a) => a.stepId === s.id);
      return {
        step: s,
        run: brief(run),
        component: { key: s.componentKey ?? 'task', name: 'Agent check', version: 1, outcomes: ['pass', 'findings'] },
        settings: { instructions: 'Check the artwork against the rule set.' },
        inputs: [{ name: 'artwork', value: null, artifact: null, source_step_id: null, superseded: false, missing: false }],
        attempts: own,
        accepted: own.find((a) => a.id === s.acceptedAttemptId) ?? null,
        my_draft: null,
        gate: {
          present: s.id === steps.gated.id,
          describe: ['At least one final file'],
          last: null,
          unmet: s.id === steps.gated.id ? ['No final file yet'] : [],
        },
        approvals: [],
        files: [],
        participants: [],
        timers: [],
        open_questions: 0,
        actions: ['claim', 'add_attempt', 'complete', 'comment', 'ask_question'],
      };
    },
    attempt_open: ({ params }) => {
      const a = attempts.get(params.attempt ?? '');
      if (!a) throw new Refusal('not_found');
      return a;
    },
    attempt_add: ({ params, body }) => {
      const s = step(params.step ?? '');
      if (s.id === steps.limited.id) throw new Refusal('outside_limits');
      const b = body as { result: Record<string, unknown>; explanation: string; evidence: Attempt['evidence']; artifact_ids: string[] };
      const a = {
        id: randomUUID(),
        stepId: s.id,
        round: 1,
        author: people.agent,
        answerForOrgId: null,
        result: b.result,
        explanation: b.explanation,
        evidence: b.evidence,
        artifactIds: b.artifact_ids,
        status: 'submitted',
        kind: 'work',
        acceptedBy: null,
        acceptedAt: null,
        createdAt: now(),
      } as Attempt;
      attempts.set(a.id, a);
      return a;
    },
    attempt_accept: ({ params }) => {
      const a = attempts.get(params.attempt ?? '');
      if (!a) throw new Refusal('not_found');
      const s = step(a.stepId);
      s.acceptedAttemptId = a.id;
      a.acceptedAt = now();
      return { attempt: a, step: s };
    },
    step_complete: ({ params }) => {
      const s = step(params.step ?? '');
      if (s.id === steps.others.id) {
        throw new Refusal('forbidden', {
          detail: `This step belongs to ${people.designer.name}. Completing it for them needs a permission you do not have.`,
          missing_permission: 'act.complete_for_others',
          who_can_change: [
            { kind: 'role', name: 'Org admin' },
            { kind: 'account', name: people.owner.name },
          ],
        });
      }
      if (s.id === steps.gated.id) throw new Refusal('gate_unmet', { unmet: ['At least one final file is attached'] });
      if (s.id === steps.limited.id) throw new Refusal('outside_limits');
      s.state = 'done';
      s.doneAt = now();
      return { step: s, activated: [{ step_id: steps.others.id, node_id: steps.others.nodeId, label: steps.others.label }] };
    },
    approval_decide: ({ params }) => {
      if (params.step === steps.limited.id) throw new Refusal('human_required');
      throw new Refusal('not_found');
    },
    run_start: ({ body }) => {
      const b = body as { template: string; start_inputs: Record<string, unknown> };
      if (b.template !== 'package-design') throw new Refusal('not_found');
      if (typeof b.start_inputs.product_name !== 'string')
        throw new Refusal('invalid_input', { errors: [{ path: 'start_inputs.product_name', message: 'Required' }] });
      const r = runOf(`Package design ${b.start_inputs.product_name}`, `PD-${runs.size + 1}`, b.start_inputs);
      r.startedBy = people.agent.id;
      runs.set(r.id, r);
      return r;
    },
    gate_override: () => {
      throw new Refusal('forbidden', {
        detail: 'Only holders of a manager role may override this gate, with a reason.',
        missing_permission: 'act.override_gate',
        who_can_change: [{ kind: 'role', name: people.managerRole.name }],
      });
    },
    step_skip_preview: ({ params }) => {
      step(params.step ?? '');
      return {
        missing_downstream: [{ node_id: 'review_text', label: 'Review the text', input: 'artwork_check', required: true }],
        allowed: true,
      };
    },
    step_skip: ({ params, body }) => {
      const s = step(params.step ?? '');
      const b = body as { continue_empty: boolean; values?: Record<string, unknown> };
      if (!b.continue_empty && !b.values?.artwork_check)
        throw new Refusal('invalid_input', { errors: [{ path: 'values.artwork_check', message: 'Required' }] });
      s.state = 'skipped';
      return { step: s, activated: [] };
    },
    run_signal: ({ body }) => ({
      id: randomUUID(),
      woke_steps: (body as { name: string }).name === 'goods_arrived' ? [steps.gated.id] : [],
    }),
  };

  const STREAMING = Symbol('streaming');
  const routes = Object.entries(operations).map(([id, op]) => {
    const names: string[] = [];
    const pattern = new RegExp(
      `^/api/v1${op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
        names.push(name);
        return '([^/]+)';
      })}$`,
    );
    return { id: id as OperationId, method: op.method.toUpperCase(), pattern, names };
  });

  function sendProblem(res: ServerResponse, code: ErrorCode, extra: Partial<Problem> = {}) {
    const p = problemOf(code, extra);
    res.writeHead(p.status, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify(p));
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    if (!route) return sendProblem(res, 'not_found');
    requests.push({
      op: route.id,
      userAgent: req.headers['user-agent'],
      idempotencyKey: req.headers['idempotency-key'] as string | undefined,
    });
    if (route.id !== 'meta_get') {
      if (req.headers.authorization !== `Bearer ${KEY}`) return sendProblem(res, 'unauthenticated');
    }
    const handler = handlers[route.id];
    // Every operation of a merged lane: the real site answers it (live-site.db.test.ts), never this one.
    if (!handler) return sendProblem(res, 'not_implemented', { detail: `${route.id} is answered by the real site, not this stand-in.` });
    const match = route.pattern.exec(url.pathname);
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match?.[i + 1] ?? '')]));
    let body: unknown = null;
    if (raw.length && String(req.headers['content-type'] ?? '').includes('json')) body = JSON.parse(raw.toString('utf8'));
    try {
      const answer = await handler({ params, query: url.searchParams, body, raw, req, res });
      if (answer === STREAMING) return;
      const status = operations[route.id].successStatus;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    } catch (error) {
      if (error instanceof Refusal) return sendProblem(res, error.code, error.extra);
      sendProblem(res, 'not_implemented', { detail: String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  site.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return site;
}
