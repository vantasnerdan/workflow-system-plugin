/**
 * Generates packages/client/src/generated from the OpenAPI document of /api/v1.
 *
 *   node codegen/generate.ts                  build the document from the contract and write the files
 *   node codegen/generate.ts --doc <file>     read the document from a file (for example a site's /api/v1/openapi.json)
 *   node codegen/generate.ts --out <dir>      write somewhere else
 *   node codegen/generate.ts --check          write nothing; exit 1 and name each file that is not current
 *
 * The client never imports the contract: the document is the only input, read as data. Outputs:
 *   schema.ts       TypeScript types of every path, operation and shared shape (openapi-typescript)
 *   operations.ts   the runtime table: method, path, parameters, body, answer and errors of every call;
 *                   the error catalogue; the event streams; the agent tools and their calls
 *   reference.ts    parameters, body fields and answer fields of every call and event, for the documentation
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { normalize } from './normalize.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repoRoot = resolve(clientRoot, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadDocument(file?: string): JsonObject {
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as JsonObject;
  // Outside the system's own repository there is no contract package: the document is the saved copy
  // `openapi.json` beside this package (refresh it from a site's /api/v1/openapi.json).
  if (!existsSync(join(repoRoot, 'packages/contract/src/openapi.ts')))
    return JSON.parse(readFileSync(join(clientRoot, 'openapi.json'), 'utf8')) as JsonObject;
  const out = execFileSync(process.execPath, [join(repoRoot, 'packages/contract/src/openapi.ts')], {
    cwd: join(repoRoot, 'packages/contract'),
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out.toString('utf8')) as JsonObject;
}

const isObject = (v: Json | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Short type text of a schema, for the field tables of the documentation. */
function typeText(schema: Json | undefined): string {
  if (!isObject(schema)) return 'any';
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop() ?? 'object';
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  for (const key of ['anyOf', 'oneOf'] as const) {
    const list = schema[key];
    if (Array.isArray(list)) return [...new Set(list.map(typeText))].join(' | ');
  }
  if (schema.type === 'array') return `${typeText(schema.items)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (typeof schema.type === 'string') return schema.format ? `${schema.type} (${String(schema.format)})` : schema.type;
  return 'any';
}

export interface FieldRow {
  path: string;
  type: string;
  required: boolean;
  description: string;
}

/** The fields of an object schema, two levels deep, references named by their shape. */
function fields(schema: Json | undefined, components: JsonObject, prefix = '', depth = 0, seen = new Set<string>()): FieldRow[] {
  if (!isObject(schema)) return [];
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop() ?? '';
    if (seen.has(name) || depth > 1) return [];
    return fields(components[name], components, prefix, depth, new Set([...seen, name]));
  }
  const props = schema.properties;
  if (!isObject(props)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const rows: FieldRow[] = [];
  for (const [name, child] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const description = isObject(child) && typeof child.description === 'string' ? child.description : '';
    rows.push({ path, type: typeText(child), required: required.has(name), description });
    if (depth < 1 && isObject(child) && (child.properties || child.$ref)) rows.push(...fields(child, components, path, depth + 1, seen));
  }
  return rows;
}

interface ParamRow {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  type: string;
  description: string;
}

export interface OperationEntry {
  id: string;
  method: string;
  path: string;
  area: string;
  summary: string;
  description: string;
  public: boolean;
  params: ParamRow[];
  body: { contentType: string; fields: FieldRow[] } | null;
  success: { status: number; contentType: string | null; fields: FieldRow[] };
  errors: string[];
}

export function operationTable(doc: JsonObject): OperationEntry[] {
  const components = (isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {}) as JsonObject;
  const out: OperationEntry[] = [];
  const paths = isObject(doc.paths) ? doc.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!isObject(op)) continue;
      const params: ParamRow[] = (Array.isArray(op.parameters) ? op.parameters : []).filter(isObject).map((p) => ({
        name: String(p.name),
        in: p.in as ParamRow['in'],
        required: p.required === true,
        type: typeText(p.schema),
        description: typeof p.description === 'string' ? p.description : isObject(p.schema) ? String(p.schema.description ?? '') : '',
      }));
      let body: OperationEntry['body'] = null;
      if (isObject(op.requestBody) && isObject(op.requestBody.content)) {
        const [contentType, media] = Object.entries(op.requestBody.content)[0] ?? [];
        if (contentType) body = { contentType, fields: fields(isObject(media) ? media.schema : undefined, components) };
      }
      const responses = isObject(op.responses) ? op.responses : {};
      const errors: string[] = [];
      let success: OperationEntry['success'] = { status: 204, contentType: null, fields: [] };
      for (const [status, response] of Object.entries(responses)) {
        if (!isObject(response)) continue;
        if (status.startsWith('2')) {
          const [contentType, media] = isObject(response.content) ? (Object.entries(response.content)[0] ?? []) : [];
          success = {
            status: Number(status),
            contentType: contentType ?? null,
            fields: contentType === 'application/json' ? fields(isObject(media) ? media.schema : undefined, components) : [],
          };
        } else if (typeof response.description === 'string') {
          errors.push(...response.description.split(',').map((s) => s.trim()));
        }
      }
      out.push({
        id: String(op.operationId),
        method,
        path,
        area: Array.isArray(op.tags) ? String(op.tags[0]) : '',
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        public: Array.isArray(op.security) && op.security.length === 0,
        params,
        body,
        success,
        errors: errors.sort(),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const HEADER = '/**\n * Generated by packages/client/codegen/generate.ts from the OpenAPI document of /api/v1. Do not edit.\n */\n';

export async function generate(doc: JsonObject): Promise<Record<string, string>> {
  const normalized = normalize(doc);
  const events = isObject(doc['x-events']) ? doc['x-events'] : { streams: {}, types: {} };
  const eventTypes = isObject(events.types) ? events.types : {};
  // Event payloads become named shapes too, so the client types the event stream.
  const schemas = (normalized.components as JsonObject).schemas as JsonObject;
  for (const [name, schema] of Object.entries(eventTypes)) {
    if (!isObject(schema)) continue;
    const { $schema: _ignored, ...rest } = schema;
    schemas[`Event_${name}`] = rest;
  }
  const ast = await openapiTS(normalized as never, { silent: true, alphabetize: true });
  const schemaTs = `${HEADER}${astToString(ast)}`;

  const info = isObject(doc.info) ? doc.info : {};
  const table = operationTable(normalized);
  const runtime = table.map((o) => [
    o.id,
    {
      method: o.method,
      path: o.path,
      area: o.area,
      summary: o.summary,
      public: o.public,
      pathParams: o.params.filter((p) => p.in === 'path').map((p) => p.name),
      queryParams: o.params.filter((p) => p.in === 'query').map((p) => p.name),
      bodyContentType: o.body?.contentType ?? null,
      successStatus: o.success.status,
      successContentType: o.success.contentType,
      errors: o.errors,
    },
  ]);
  const operationsTs = [
    HEADER,
    `/** The interface version this client was generated from. */\nexport const INTERFACE_VERSION = ${JSON.stringify(String(info.version ?? '0.0.0'))};\n`,
    `/** Every call of the interface, by operation id: how to send it and what it can answer. */\nexport const operations = ${JSON.stringify(Object.fromEntries(runtime), null, 2)} as const;\n`,
    `/** Every error code with its status and plain texts. */\nexport const errorCatalogue = ${JSON.stringify(doc['x-errors'] ?? {}, null, 2)} as const;\n`,
    `/** The event streams and the event types each one sends. */\nexport const eventStreams = ${JSON.stringify(isObject(events.streams) ? events.streams : {}, null, 2)} as const;\n`,
    `/** The agent tools of the interface and the calls each one makes. */\nexport const agentToolCalls = ${JSON.stringify(doc['x-agent-tools'] ?? {}, null, 2)} as const;\n`,
  ].join('\n');
  const eventFields = Object.fromEntries(Object.entries(eventTypes).map(([name, schema]) => [name, fields(schema, schemas)]));
  const referenceTs = [
    HEADER,
    `/** The reference of every call for the documentation: parameters, body fields and answer fields. */\nexport const reference = ${JSON.stringify(table, null, 2)} as const;\n`,
    `/** The fields of every event type. */\nexport const eventFields = ${JSON.stringify(eventFields, null, 2)} as const;\n`,
  ].join('\n');
  return { 'schema.ts': schemaTs, 'operations.ts': operationsTs, 'reference.ts': referenceTs };
}

/** Formats a generated file with the repository formatter, as if it sat at its committed place. */
export function formatText(text: string, name: string): string {
  return execFileSync(join(repoRoot, 'node_modules/.bin/biome'), ['format', `--stdin-file-path=packages/client/src/generated/${name}`], {
    cwd: repoRoot,
    input: text,
    maxBuffer: 256 * 1024 * 1024,
  }).toString('utf8');
}

/** The generated files, formatted, by file name. */
export async function generatedFiles(doc: JsonObject): Promise<Record<string, string>> {
  const files = await generate(doc);
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [name, formatText(text, name)]));
}

if (import.meta.main) {
  const outDir = resolve(arg('--out') ?? join(clientRoot, 'src/generated'));
  const files = await generatedFiles(loadDocument(arg('--doc')));
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([name, text]) => {
      try {
        return readFileSync(join(outDir, name), 'utf8') !== text;
      } catch {
        return true;
      }
    });
    for (const [name] of stale) process.stdout.write(`stale: ${name}\n`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
    process.stdout.write(
      `${Object.keys(files)
        .map((n) => join(outDir, n))
        .join('\n')}\n`,
    );
  }
}
