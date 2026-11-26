/**
 * Shrinks the OpenAPI document before type generation: every schema that appears at least twice
 * (and is not tiny) is moved to `components.schemas` once and referenced from each place. The
 * document the contract emits inlines every shared shape, so without this the generated types repeat
 * the same object hundreds of times. Names come from where a schema is first met (the property that
 * holds it, or the operation whose body or answer it is), so they stay stable from one build to the next.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const MIN_SIZE = 160;
const SCHEMA_KEYS = new Set(['type', 'properties', 'anyOf', 'oneOf', 'allOf', 'enum', 'items', 'const', '$ref']);

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: Json | undefined): value is JsonObject {
  return isObject(value) && Object.keys(value).some((k) => SCHEMA_KEYS.has(k));
}

/** JSON with sorted keys: equal schemas give equal text. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k] as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
}

/** Child schemas of a schema, with the name hint each one carries. */
function* children(schema: JsonObject, hint: string): Generator<[JsonObject, string, string | number, Json[] | JsonObject]> {
  const props = schema.properties;
  if (isObject(props)) for (const [k, v] of Object.entries(props)) if (isSchema(v)) yield [v, pascal(k), k, props];
  const items = schema.items;
  if (isSchema(items)) yield [items, `${hint}Item`, 'items', schema];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = schema[key];
    if (!Array.isArray(list)) continue;
    for (const [i, v] of list.entries()) if (isSchema(v)) yield [v, `${hint}Option${i + 1}`, i, list];
  }
  const extra = schema.additionalProperties;
  if (isSchema(extra)) yield [extra, `${hint}Value`, 'additionalProperties', schema];
}

/** The schemas of a document's operations: parameters, request bodies and responses, with name hints. */
function* roots(doc: JsonObject): Generator<[JsonObject, string, string, JsonObject]> {
  const paths = doc.paths;
  if (!isObject(paths)) return;
  for (const item of Object.values(paths)) {
    if (!isObject(item)) continue;
    for (const op of Object.values(item)) {
      if (!isObject(op)) continue;
      const id = pascal(String(op.operationId ?? 'Operation'));
      const params = op.parameters;
      if (Array.isArray(params))
        for (const p of params) if (isObject(p) && isSchema(p.schema)) yield [p.schema, pascal(String(p.name)), 'schema', p];
      const body = op.requestBody;
      if (isObject(body) && isObject(body.content)) {
        for (const media of Object.values(body.content))
          if (isObject(media) && isSchema(media.schema)) yield [media.schema, `${id}Body`, 'schema', media];
      }
      const responses = op.responses;
      if (isObject(responses)) {
        for (const [status, response] of Object.entries(responses)) {
          if (!isObject(response) || !isObject(response.content)) continue;
          for (const media of Object.values(response.content)) {
            if (!isObject(media) || !isSchema(media.schema)) continue;
            const isProblem = media.schema.description === 'application/problem+json';
            yield [media.schema, isProblem ? 'Problem' : `${id}${status.startsWith('2') ? 'Response' : status}`, 'schema', media];
          }
        }
      }
    }
  }
}

export function normalize(input: JsonObject): JsonObject {
  const doc = structuredClone(input);
  const counts = new Map<string, number>();
  const count = (schema: JsonObject, hint: string): void => {
    const key = canonical(schema);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [child, childHint] of children(schema, hint)) count(child, childHint);
  };
  for (const [schema, hint] of roots(doc)) count(schema, hint);

  if (!isObject(doc.components)) doc.components = {};
  const components = doc.components as JsonObject;
  if (!isObject(components.schemas)) components.schemas = {};
  const schemas = components.schemas as JsonObject;
  const names = new Map<string, string>();
  const used = new Set(Object.keys(schemas));

  const nameFor = (hint: string): string => {
    const base = hint || 'Shape';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
    used.add(name);
    return name;
  };

  /** Rewrites a schema in place: shared children become references. */
  const rewrite = (schema: JsonObject, hint: string): void => {
    for (const [child, childHint, key, holder] of children(schema, hint)) {
      const ref = refFor(child, childHint);
      if (ref) (holder as Record<string | number, Json>)[key] = ref;
      else rewrite(child, childHint);
    }
  };

  const refFor = (schema: JsonObject, hint: string): JsonObject | null => {
    const key = canonical(schema);
    if ((counts.get(key) ?? 0) < 2 || key.length < MIN_SIZE) return null;
    let name = names.get(key);
    if (!name) {
      name = nameFor(hint);
      names.set(key, name);
      const copy = structuredClone(schema);
      schemas[name] = copy;
      rewrite(copy, name);
    }
    return { $ref: `#/components/schemas/${name}` };
  };

  for (const [schema, hint, key, holder] of roots(doc)) {
    const ref = refFor(schema, hint);
    if (ref) holder[key] = ref;
    else rewrite(schema, hint);
  }
  return doc;
}
