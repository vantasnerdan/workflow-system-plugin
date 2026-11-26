/** The generated client: how calls are sent, how answers and errors come back, the event stream. */
import { describe, expect, it } from 'vitest';
import { createClient, errorCatalogue, isWfError, operations, WfError } from '../src/index.ts';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    return answer(url, init);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('US-D-8 the client speaks only the documented interface', () => {
  it('builds the address, query, headers and idempotency key of a call from the operation table', async () => {
    const { seen, fetchImpl } = fakeFetch(() => json({ id: 'x' }));
    const client = createClient({
      site: 'https://workflow.example.test/',
      key: 'wfa_a_b',
      userAgent: 'wf-plugin/test/1.0.0',
      fetch: fetchImpl,
    });
    await client.call('run_map', { params: { run: 'PD 1' }, query: { detail: 'summary', format: 'json' } });
    await client.call('step_claim', { params: { step: '00000000-0000-4000-8000-000000000001' } });
    expect(seen[0]?.url).toBe('https://workflow.example.test/api/v1/runs/PD%201/map?detail=summary&format=json');
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer wfa_a_b');
    expect(headers['user-agent']).toBe('wf-plugin/test/1.0.0');
    expect(headers['idempotency-key']).toBeUndefined();
    expect(seen[1]?.init.method).toBe('POST');
    expect(((seen[1]?.init.headers ?? {}) as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has one operation per documented call, each with method, path and errors', () => {
    expect(Object.keys(operations).length).toBeGreaterThan(150);
    for (const [id, op] of Object.entries(operations)) {
      expect(op.path.startsWith('/'), id).toBe(true);
      expect(['get', 'post', 'put', 'patch', 'delete']).toContain(op.method);
      for (const code of op.errors) expect(Object.keys(errorCatalogue), `${id}: ${code}`).toContain(code);
    }
  });
});

describe('US-D-6 errors are the site problem answers, and an unreachable site is its own error', () => {
  it('turns a problem answer into a WfError with code, detail, missing permission and who can change it', async () => {
    const problem = {
      type: '/docs/agent-interface#error-forbidden',
      title: 'Not allowed',
      status: 403,
      code: 'forbidden',
      detail: 'No.',
      missing_permission: 'act.skip',
      who_can_change: [{ kind: 'role', name: 'Manager' }],
    };
    const { fetchImpl } = fakeFetch(() => json(problem, 403, 'application/problem+json'));
    const client = createClient({ site: 'https://workflow.example.test', userAgent: 't', fetch: fetchImpl });
    const error = await client.call('step_skip_preview', { params: { step: 'x' } }).catch((e: unknown) => e);
    expect(isWfError(error)).toBe(true);
    expect((error as WfError).code).toBe('forbidden');
    expect((error as WfError).problem.who_can_change).toEqual([{ kind: 'role', name: 'Manager' }]);
  });

  it('reports a connection failure as site_unreachable, not as an empty answer', async () => {
    const client = createClient({ site: 'http://127.0.0.1:9', userAgent: 't' });
    const error = (await client.call('queue_list').catch((e: unknown) => e)) as WfError;
    expect(error.code).toBe('site_unreachable');
    expect(error.detail).toContain('http://127.0.0.1:9');
  });

  it('reports an address that answers with something other than this interface as site_unreachable', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>not here</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
    const client = createClient({ site: 'https://workflow.example.test', userAgent: 't', fetch: fetchImpl });
    const error = (await client.call('whoami').catch((e: unknown) => e)) as WfError;
    expect(error.code).toBe('site_unreachable');
    expect(error.detail).toContain('HTTP 404');
  });

  it('reports a site that takes too long as site_unreachable', async () => {
    const { fetchImpl } = fakeFetch(
      (_u, init) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const client = createClient({ site: 'https://workflow.example.test', userAgent: 't', fetch: fetchImpl, timeoutMs: 50 });
    const error = (await client.call('whoami').catch((e: unknown) => e)) as WfError;
    expect(error).toBeInstanceOf(WfError);
    expect(error.code).toBe('site_unreachable');
    expect(error.detail).toContain('took too long');
  });
});

describe('US-D-32 the client reads the agent event stream', () => {
  it('parses events with type, id and JSON data, skipping comments', async () => {
    const body = ': open\n\nevent: inbox_item\nid: 7\ndata: {"unread":2}\n\nevent: keepalive\nid: 8\ndata: {"at":"t"}\n\n';
    const { seen, fetchImpl } = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = createClient({ site: 'https://workflow.example.test', key: 'wfa_a_b', userAgent: 't', fetch: fetchImpl });
    const got = [];
    let opened = false;
    for await (const m of client.stream('agent_events', {}, { lastEventId: '6', onOpen: () => (opened = true) })) got.push(m);
    expect(opened).toBe(true);
    expect(got).toEqual([
      { event: 'inbox_item', id: '7', data: { unread: 2 } },
      { event: 'keepalive', id: '8', data: { at: 't' } },
    ]);
    expect(((seen[0]?.init.headers ?? {}) as Record<string, string>)['last-event-id']).toBe('6');
  });
});
