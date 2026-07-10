import type { ToolResult } from '../memory/tools.js';
import type { CursorAgentSession } from './cursor-agent.js';
import type { TelegramWorkspace } from './config.js';

/** Pluggable memory backend for Telegram (local tools or remote MCP). */
export interface MemoryAccess {
  recall(query: string, k?: number): Promise<ToolResult>;
  getChat(chatId: number): Promise<ToolResult>;
  listChats(project?: string): Promise<ToolResult>;
  close?(): Promise<void> | void;
}

export type TelegramBotConfig = {
  botToken: string;
  allowedUserIds: ReadonlySet<number>;
  access: MemoryAccess;
  /** When set, free text /ask go to Cursor. */
  cursor?: {
    sessionFor(userId: number): CursorAgentSession;
    status(): { cwd: string; model: string; workspaces: TelegramWorkspace[] };
  };
};

export type TelegramCommand =
  | { kind: 'help' }
  | { kind: 'list'; project?: string }
  | { kind: 'show'; chatId: number }
  | { kind: 'recall'; query: string }
  | { kind: 'agent'; text: string }
  | { kind: 'new' }
  | { kind: 'cwd'; path?: string }
  | { kind: 'ws'; action: 'list' }
  | { kind: 'ws'; action: 'switch'; ref: string }
  | { kind: 'ws'; action: 'add'; name: string; path: string }
  | { kind: 'ws'; action: 'remove'; name: string }
  | { kind: 'status' }
  | { kind: 'ignored' };

export type TelegramUpdateMessage = {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id: number; username?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramUpdateMessage;
};
