/**
 * The tool registry: every tool of architecture 6.2, in documentation order. Harness-neutral; the
 * MCP binding is `../mcp.ts`. A plugin for another harness imports `tools` and binds it its own way.
 */
import { agentToolCalls } from '@wf/client';
import * as authoring from './authoring.ts';
import * as identity from './identity.ts';
import * as queues from './queues.ts';
import * as reading from './reading.ts';
import { type ToolDefinition, toolGroups } from './types.ts';
import * as working from './working.ts';

export * from './types.ts';

const all = [identity, queues, reading, working, authoring].flatMap((module) =>
  Object.values(module).filter((v): v is ToolDefinition => typeof v === 'object' && v !== null && 'handler' in v && 'group' in v),
);

/** The documentation order: the order of the interface document's own tool list. */
const order = Object.keys(agentToolCalls);
const rank = (t: ToolDefinition) => (order.includes(t.name) ? order.indexOf(t.name) : order.length);

/** Every tool, ordered by group and then as the interface document lists them. */
export const tools: readonly ToolDefinition[] = toolGroups.flatMap((group) =>
  all.filter((t) => t.group === group).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
);

export function toolByName(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
