/**
 * The typed HTTP client of /api/v1. Every call is named by its operation id; parameters, body and
 * answer are typed from the generated schema, and the runtime table says how each call is sent.
 * Errors are always a `WfError` carrying the site's problem answer (`code`, plain `detail`,
 * `missing_permission`, `who_can_change`, ...). When the site does not answer, or the address answers
 * with something that is not this interface, the error is `site_unreachable`: never an empty list.
 */
import { errorCatalogue, INTERFACE_VERSION, operations } from './generated/operations.ts';
import type { components, operations as Operations } from './generated/schema.ts';

export type OperationId = keyof Operations & keyof typeof operations;
export type Schemas = components['schemas'];
export type ErrorCode = keyof typeof errorCatalogue;
export type Problem = Schemas['Problem'];

type Op<K extends OperationId> = Operations[K];
type Never<T> = [T] extends [never] ? true : [T] extends [undefined] ? true : false;

export type PathParams<K extends OperationId> = NonNullable<Op<K>['parameters']['path']>;
/** Plain-text query values (yes/no flags and numbers travel as text) also take booleans and numbers. */
type QueryValues<T> = { [P in keyof T]: string extends NonNullable<T[P]> ? T[P] | boolean | number : T[P] };
export type QueryParams<K extends OperationId> = QueryValues<NonNullable<Op<K>['parameters']['query']>>;
export type RequestBody<K extends OperationId> =
  Op<K> extends { requestBody: { content: infer C } }
    ? C extends { 'application/json': infer J }
      ? J
      : C[keyof C]
    : Op<K> extends { requestBody?: { content: infer C } }
      ? C extends { 'application/json': infer J }
        ? J
        : C[keyof C]
      : never;

type SuccessStatus = 200 | 201 | 202 | 204 | 206;
type Responses<K extends OperationId> = Op<K>['responses'];
/** The answer of a call: the JSON of its success response (undefined for 204). */
export type Answer<K extends OperationId> = {
  [S in keyof Responses<K> & SuccessStatus]: Responses<K>[S] extends { content: infer C }
    ? C extends { 'application/json': infer J }
      ? J
      : C[keyof C]
    : undefined;
}[keyof Responses<K> & SuccessStatus];

export interface CallOptions {
  /** Sent as `Idempotency-Key`; mutations get a fresh one when omitted. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type CallInput<K extends OperationId> = (Never<PathParams<K>> extends true ? { params?: undefined } : { params: PathParams<K> }) & {
  query?: QueryParams<K>;
} & (Never<RequestBody<K>> extends true ? { body?: undefined } : { body: RequestBody<K> }) &
  CallOptions;

export interface ClientOptions {
  /** The site address, for example `https://workflow.example.test`. */
  site: string;
  /** The agent key `wfa_<keyId>_<secret>`, sent as `Authorization: Bearer`. */
  key?: string;
  /** Recorded as the client on every audit event: `wf-plugin/<harness>/<version>`. */
  userAgent: string;
  fetch?: typeof fetch;
  /** Time limit of one call in milliseconds (default 30 seconds; streams have none). */
  timeoutMs?: number;
}

/** An error answered by the site, or `site_unreachable` when it did not answer as this interface. */
export class WfError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(`${problem.title}: ${problem.detail}`);
    this.name = 'WfError';
    this.problem = problem;
    this.code = problem.code as ErrorCode;
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
  }
}

export function isWfError(error: unknown): error is WfError {
  return error instanceof WfError;
}

/** A problem from the catalogue, as the site would answer it. */
export function problemOf(code: ErrorCode, extra: Partial<Problem> = {}): Problem {
  const entry = errorCatalogue[code];
  return {
    type: `/docs/agent-interface#error-${code}`,
    title: entry.title,
    status: entry.status,
    code,
    detail: entry.detail,
    ...extra,
  } as Problem;
}

function unreachable(site: string, why: string): WfError {
  return new WfError(problemOf('site_unreachable', { detail: `${errorCatalogue.site_unreachable.detail} Address: ${site}. ${why}` }));
}

function causeText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The site took too long to answer.';
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${cause.code}${cause.message ? `: ${cause.message}` : ''}` : error.message;
  }
  return String(error);
}

export interface SseMessage {
  event: string;
  id: string;
  data: unknown;
}

export interface StreamOptions {
  lastEventId?: string;
  signal?: AbortSignal;
  /** Called once the site has accepted the stream, before the first event. */
  onOpen?: () => void;
}

export type WfClient = ReturnType<typeof createClient>;

/** A call's input without its types (the runtime table checks the names). */
export interface LooseInput extends CallOptions {
  params?: unknown;
  query?: unknown;
  body?: unknown;
  rawBody?: BodyInit;
}

export function createClient(options: ClientOptions) {
  const site = options.site.replace(/\/+$/, '');
  const base = `${site}/api/v1`;
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  function url<K extends OperationId>(id: K, input: { params?: unknown; query?: unknown }): string {
    const op = operations[id];
    const params = (input.params ?? {}) as Record<string, unknown>;
    let path: string = op.path;
    for (const name of op.pathParams as readonly string[]) {
      const value = params[name];
      if (value === undefined || value === null || value === '')
        throw new WfError(problemOf('invalid_input', { errors: [{ path: name, message: 'Required' }] }));
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    }
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries((input.query ?? {}) as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      search.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    const qs = search.toString();
    return `${base}${path}${qs ? `?${qs}` : ''}`;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'user-agent': options.userAgent,
      accept: 'application/json, application/problem+json',
      ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
      ...extra,
    };
  }

  async function send(target: string, init: RequestInit, timed = true): Promise<Response> {
    const signals = [init.signal, timed ? AbortSignal.timeout(timeoutMs) : undefined].filter((s): s is AbortSignal => Boolean(s));
    try {
      return await doFetch(target, { ...init, signal: signals.length ? AbortSignal.any(signals) : null });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw unreachable(site, causeText(error));
    }
  }

  /** Turns a failed answer into a WfError: the site's problem, or `site_unreachable` when it is not one. */
  async function failure(response: Response): Promise<WfError> {
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) {
      const body = (await response.json().catch(() => null)) as Partial<Problem> | null;
      if (body && typeof body.code === 'string' && body.code in errorCatalogue) return new WfError(body as Problem);
    }
    return unreachable(site, `The address answered HTTP ${response.status} without a problem answer of this interface.`);
  }

  /** Sends a call by id with an untyped input. */
  async function rawLoose(id: OperationId, input: LooseInput, timed = true): Promise<Response> {
    const op = operations[id];
    const mutation = op.method !== 'get';
    const extra: Record<string, string> = { ...(input.headers ?? {}) };
    if (mutation) extra['idempotency-key'] = input.idempotencyKey ?? crypto.randomUUID();
    let body: BodyInit | undefined = input.rawBody;
    if (body === undefined && input.body !== undefined) {
      body = JSON.stringify(input.body);
      extra['content-type'] = op.bodyContentType ?? 'application/json';
    }
    const response = await send(
      url(id, input),
      { method: op.method.toUpperCase(), headers: headers(extra), body: body ?? null, signal: input.signal ?? null },
      timed,
    );
    if (!response.ok) throw await failure(response);
    return response;
  }

  /** Sends a call and returns the raw answer when it succeeded (downloads with `Range`, uploads with `rawBody`). */
  function raw<K extends OperationId>(id: K, input: CallInput<K> & { rawBody?: BodyInit }): Promise<Response> {
    return rawLoose(id, input as LooseInput);
  }

  /** Sends a call and returns its typed answer. */
  async function call<K extends OperationId>(
    id: K,
    ...args: Record<never, never> extends CallInput<K> ? [CallInput<K>?] : [CallInput<K>]
  ): Promise<Answer<K>> {
    const response = await rawLoose(id, (args[0] ?? {}) as LooseInput);
    if (response.status === 204) return undefined as Answer<K>;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) return (await response.json()) as Answer<K>;
    return (await response.text()) as unknown as Answer<K>;
  }

  /** Sends a call whose answer is text (for example the run map with `format=mermaid`). */
  async function text<K extends OperationId>(id: K, input: CallInput<K>): Promise<string> {
    const response = await rawLoose(id, input as LooseInput);
    return response.text();
  }

  /** Opens one event stream and yields its events until it ends; reconnecting is the caller's choice. */
  async function* stream<K extends OperationId>(id: K, input: CallInput<K>, opts: StreamOptions = {}): AsyncGenerator<SseMessage> {
    const response = await rawLoose(
      id,
      {
        ...(input as LooseInput),
        headers: {
          ...(input.headers ?? {}),
          accept: 'text/event-stream',
          ...(opts.lastEventId ? { 'last-event-id': opts.lastEventId } : {}),
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      false,
    );
    opts.onOpen?.();
    if (!response.body) return;
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    let eventId = '';
    let data: string[] = [];
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line === '') {
          if (data.length > 0) {
            const textData = data.join('\n');
            let parsed: unknown = textData;
            try {
              parsed = JSON.parse(textData);
            } catch {
              // not JSON: pass the text on
            }
            yield { event, id: eventId, data: parsed };
          }
          event = 'message';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') eventId = value;
      }
    }
  }

  return { site, interfaceVersion: INTERFACE_VERSION, userAgent: options.userAgent, call, text, raw, stream, url };
}
