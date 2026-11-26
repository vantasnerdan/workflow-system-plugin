/**
 * The harness-neutral tool registry (architecture 6.2, corrections A3): every tool is
 * `{ name, group, description, input (zod), calls, handler(context) }`. Nothing here knows MCP;
 * `../mcp.ts` is one binding of it, and a plugin for another harness binds the same registry.
 */
import type { WfClient } from '@wf/client';
import type { z } from 'zod';
import type { FileTransfers } from '../files.ts';
import type { StateStore } from '../state.ts';

export const toolGroups = [
  'identity',
  'notifications',
  'queues',
  'reading',
  'working',
  'talking',
  'deciding',
  'starting',
  'authoring',
] as const;
export type ToolGroup = (typeof toolGroups)[number];

export const groupTitles: Record<ToolGroup, string> = {
  identity: 'Identity',
  notifications: 'Notifications',
  queues: 'Queues',
  reading: 'Reading',
  working: 'Working',
  talking: 'Talking',
  deciding: 'Deciding',
  starting: 'Starting',
  authoring: 'Authoring',
};

export interface ToolContext {
  client: WfClient;
  files: FileTransfers;
  state: StateStore;
  /** Push status, for `whoami`: whether the event stream is open right now. */
  push: { enabled: boolean; connected: boolean; channel: string | null };
}

/** What a tool returns: one plain summary line or a few, and the site's answer as data. */
export interface ToolResult {
  summary: string;
  data?: unknown;
  /** The unread count when the call itself returned it (saves a second call). */
  unread?: number;
}

export interface ToolDefinition<I extends z.ZodObject = z.ZodObject> {
  name: string;
  group: ToolGroup;
  title: string;
  description: string;
  input: I;
  /** The interface calls this tool makes (operation ids), as documented. */
  calls: readonly string[];
  /** True for tools that only read. */
  readOnly: boolean;
  handler(input: z.infer<I>, context: ToolContext): Promise<ToolResult>;
}

export function defineTool<I extends z.ZodObject>(tool: ToolDefinition<I>): ToolDefinition<I> {
  return tool;
}
