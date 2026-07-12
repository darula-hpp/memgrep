/**
 * Compatibility shim — prefer importing from `./agent/index.js`.
 * Cursor SDK lives in `./agent/providers/cursor.js`.
 */
export type {
  AgentPool,
  AgentSession,
  AgentStatus,
  AgentSession as CursorAgentSession,
  AgentStatus as CursorAgentStatus,
} from './agent/types.js';
export {
  AGENT_RUN_TIMEOUT_MS,
  CURSOR_RUN_TIMEOUT_MS,
  createAgentPool,
  type AgentPoolOptions,
  type AgentPoolOptions as CursorAgentPoolOptions,
} from './agent/index.js';
export type { CodingAgentProvider, ProviderContext, ProviderSession } from './agent/provider.js';
export { createCursorProvider } from './agent/providers/cursor.js';

/** @deprecated Use createAgentPool() */
export { createAgentPool as CursorAgentPool } from './agent/index.js';
