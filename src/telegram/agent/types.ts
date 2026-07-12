import type { TelegramWorkspace } from '../config.js';
import type { AgentRunMode } from './mode.js';

/** Pool-level status shown by /status. */
export type AgentStatus = {
  agentId?: string;
  cwd: string;
  model: string;
  mode: AgentRunMode;
  workspaces: TelegramWorkspace[];
};

/**
 * Telegram-facing session facade. Bot/dispatch depend only on this —
 * never on a concrete SDK.
 */
export interface AgentSession {
  send(text: string): Promise<string>;
  reset(): Promise<void>;
  setCwd(cwd: string, name?: string): Promise<string>;
  setModel(model: string): Promise<string>;
  listModels(): Promise<string>;
  setMode(mode: string): Promise<string>;
  listModes(): string;
  listWorkspaces(): string;
  switchWorkspace(ref: string): Promise<string>;
  addWorkspace(name: string, dir: string): Promise<string>;
  removeWorkspace(name: string): Promise<string>;
  status(): AgentStatus;
  close(): Promise<void>;
}

/** Telegram-facing pool facade. */
export interface AgentPool {
  sessionFor(userId: number): AgentSession;
  status(): AgentStatus;
  close(): Promise<void>;
  /** Drop in-memory sessions only (keep persisted ids). Used by cwd/model switches. */
  disposeAllMemory(): Promise<void>;
}
