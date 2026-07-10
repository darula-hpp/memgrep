import type { MemoryStore } from './store.js';

/** Cap transcripts so a giant chat cannot blow an agent context window. */
export const MAX_CHAT_CHARS = 80_000;

/** Cap for Telegram (API limit is 4096; leave room for formatting). */
export const TELEGRAM_MAX_MESSAGE_CHARS = 3900;

export type ToolResult = {
  text: string;
  isError?: boolean;
};

export type RecallInput = {
  query: string;
  k?: number;
};

export type GetChatInput = {
  chatId: number;
};

export type ListChatsInput = {
  project?: string;
};

/**
 * Shared memory tool surface used by stdio MCP, HTTP MCP, and Telegram.
 * New tools should be added here first, then registered on each transport.
 */
export class MemoryTools {
  constructor(private readonly store: MemoryStore) {}

  async recall(input: RecallInput): Promise<ToolResult> {
    const hits = await this.store.search(input.query, input.k ?? 5);
    if (hits.length === 0) {
      return { text: 'No matching chats in memory.' };
    }
    const text = hits
      .map(
        (h) =>
          `[chat ${h.id}] ${h.title}\n  project: ${h.project} | date: ${h.createdAt.slice(0, 10)} | score: ${h.score.toFixed(3)} | ${h.chars} chars\n  matched: ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`,
      )
      .join('\n\n');
    return { text };
  }

  async getChat(input: GetChatInput): Promise<ToolResult> {
    const chat = this.store.getChat(input.chatId);
    if (!chat) {
      return { text: `No chat with id ${input.chatId}.`, isError: true };
    }
    let body = chat.content;
    if (body.length > MAX_CHAT_CHARS) {
      body =
        body.slice(0, MAX_CHAT_CHARS) +
        `\n\n[... truncated: transcript is ${chat.content.length} chars, showing first ${MAX_CHAT_CHARS} ...]`;
    }
    const header = `# ${chat.title}\nproject: ${chat.project} | date: ${chat.createdAt.slice(0, 10)}\n\n`;
    return { text: header + body };
  }

  async listChats(input: ListChatsInput = {}): Promise<ToolResult> {
    const chats = this.store.listChats(input.project);
    if (chats.length === 0) {
      return { text: 'Memory is empty.' };
    }
    const text = chats
      .map((c) => `[chat ${c.id}] ${c.title} (${c.project}, ${c.createdAt.slice(0, 10)}, ${c.chars} chars)`)
      .join('\n');
    return { text };
  }
}

export function toMcpContent(result: ToolResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text' as const, text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  };
}

/** Split long text into Telegram-safe chunks. */
export function splitForTelegram(text: string, max = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}
