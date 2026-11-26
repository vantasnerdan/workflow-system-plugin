/**
 * @wf/client: the typed HTTP client of /api/v1, generated from the OpenAPI document
 * (`pnpm --filter @wf/client generate`). It imports nothing else from the workspace, so it travels
 * with the plugins to a public repository. The documentation reference is the `./reference` export.
 */
export {
  type Answer,
  type CallInput,
  type CallOptions,
  type ClientOptions,
  createClient,
  type ErrorCode,
  isWfError,
  type OperationId,
  type PathParams,
  type Problem,
  problemOf,
  type QueryParams,
  type RequestBody,
  type Schemas,
  type SseMessage,
  type StreamOptions,
  type WfClient,
  WfError,
} from './client.ts';
export { agentToolCalls, errorCatalogue, eventStreams, INTERFACE_VERSION, operations } from './generated/operations.ts';
export type { components, operations as OperationTypes, paths } from './generated/schema.ts';
