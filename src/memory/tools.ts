import type { MemoryStore } from './store.js';
import {
  extractCursorAgentIdFromSource,
  guessCursorAgentIdFromSource,
  normalizeCursorAgentId,
} from './cursor-agent-id.js';

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

export type RememberInput = {
  text: string;
  title?: string;
  project?: string;
};

/** Structured chat payload for Telegram `/open` (resume or inject). */
export type OpenTarget = {
  id: number;
  title: string;
  project: string;
  tool: string;
  /** Confident SDK agent id when known. */
  cursorAgentId?: string;
  /** Best-effort id to try before falling back to inject. */
  resumeCandidate?: string;
  content: string;
  chars: number;
};

/** Cap injected prior context so /open does not flood the next Cursor turn. */
export const OPEN_INJECT_MAX_CHARS = 24_000;

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
      .map((c) => {
        const resume = c.cursorAgentId ? ' · resume' : '';
        return `[chat ${c.id}] ${c.title} (${c.project}, ${c.createdAt.slice(0, 10)}, ${c.chars} chars${resume})`;
      })
      .join('\n');
    return { text };
  }

  resolveOpen(input: GetChatInput): OpenTarget | null {
    const chat = this.store.getChat(input.chatId);
    if (!chat) return null;
    const cursorAgentId =
      normalizeCursorAgentId(chat.cursorAgentId) ?? extractCursorAgentIdFromSource(chat.source);
    const resumeCandidate =
      cursorAgentId ?? guessCursorAgentIdFromSource(chat.source) ?? undefined;
    return {
      id: chat.id,
      title: chat.title,
      project: chat.project,
      tool: chat.tool,
      ...(cursorAgentId ? { cursorAgentId } : {}),
      ...(resumeCandidate ? { resumeCandidate } : {}),
      content: chat.content,
      chars: chat.chars,
    };
  }

  /** Persist agent id after a successful /open resume (local store only). */
  linkCursorAgent(chatId: number, agentId: string): boolean {
    return this.store.setCursorAgentId(chatId, agentId);
  }

  async remember(input: RememberInput): Promise<ToolResult> {
    const text = input.text.trim();
    if (!text) {
      return { text: 'Nothing to remember: text is empty.', isError: true };
    }
    const title =
      input.title?.trim() || (text.length > 80 ? `${text.slice(0, 77)}...` : text);
    const project = input.project?.trim() || 'notes';
    const id = await this.store.addChat({
      title,
      project,
      content: text,
      tool: 'note',
    });
    await this.store.persist();
    if (id === null) {
      return { text: 'Already remembered (identical note exists).' };
    }
    return { text: `Remembered as chat ${id} (${project}).` };
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

/** Build the Cursor prompt used when /open cannot resume a live agent. */
export function buildOpenInjectPrompt(target: OpenTarget): string {
  let body = target.content;
  if (body.length > OPEN_INJECT_MAX_CHARS) {
    body =
      body.slice(0, OPEN_INJECT_MAX_CHARS) +
      `\n\n[... truncated: ${target.chars} chars total, showing first ${OPEN_INJECT_MAX_CHARS} ...]`;
  }
  return [
    `[memgrep /open chat ${target.id}]`,
    `Title: ${target.title}`,
    `Project: ${target.project}`,
    '',
    'Prior conversation context follows. Continue from this work; do not re-summarize unless asked.',
    '',
    body,
  ].join('\n');
}
