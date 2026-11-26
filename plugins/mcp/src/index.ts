/**
 * @wf/agent-mcp: the local stdio MCP server of the workflow site, its harness-neutral tool registry,
 * and the `wf-agent` CLI. Imports only @wf/client, so the folder can move to a public repository.
 */
export { ConfigError, loadConfig, type PluginConfig } from './config.ts';
export { EventPump, inboxItemText } from './events.ts';
export { FileTransfers } from './files.ts';
export { describeIdentity } from './identity.ts';
export { HOW_TO_WORK } from './instructions.ts';
export { CHANNEL_CAPABILITY, CHANNEL_INSTRUCTIONS, CHANNEL_NOTIFICATION, createServer, resultText, SERVER_NAME, serve } from './mcp.ts';
export { describeError, describeProblem } from './refusal.ts';
export {
  groupTitles,
  type ToolContext,
  type ToolDefinition,
  type ToolGroup,
  type ToolResult,
  toolByName,
  toolGroups,
  tools,
} from './tools/index.ts';
export { PLUGIN_VERSION } from './version.ts';
