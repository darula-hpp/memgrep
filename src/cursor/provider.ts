import type { AgentRunMode } from './mode.js';

/** Shared context for create/resume/listModels — no Telegram types. */
export type ProviderContext = {
  apiKey: string;
  cwd: string;
  model: string;
  mcpUrl: string;
  mcpToken?: string;
  /** Optional agent display name (jobs use memgrep-job-<name>). */
  name?: string;
};

export type ProviderSendOptions = {
  /** Conversation mode for this turn (Cursor: agent | plan). */
  mode?: AgentRunMode;
};

export type ProviderRunResult = {
  id: string;
  status: 'finished' | 'error' | 'cancelled';
  result?: string;
  modelId?: string;
  requestId?: string;
  durationMs?: number;
};

/** One in-flight turn; callers apply timeouts and map errors to user text. */
export type ProviderRun = {
  id: string;
  wait(): Promise<ProviderRunResult>;
  cancel(): Promise<void>;
};

export type ProviderSession = {
  id: string;
  send(text: string, options?: ProviderSendOptions): Promise<ProviderRun>;
  dispose(): Promise<void>;
};

export type ProviderModel = {
  id: string;
  displayName?: string;
  aliases?: string[];
};

/**
 * Drop-in coding-agent backend. Cursor is one implementation;
 * another provider can implement this without touching Telegram/MCP.
 */
export type CodingAgentProvider = {
  readonly id: string;
  create(ctx: ProviderContext): Promise<ProviderSession>;
  resume(agentId: string, ctx: ProviderContext): Promise<ProviderSession>;
  listModels(ctx: ProviderContext): Promise<ProviderModel[]>;
  /** True when the thrown error is retryable (shown in user-facing messages). */
  isRetryableError?(error: unknown): boolean;
};
