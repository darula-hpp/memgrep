import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MemoryStore } from './store.js';

/** Cap transcripts returned to agents so a giant chat cannot blow the context window. */
const MAX_CHAT_CHARS = 80_000;

export async function startMcpServer(storeDir?: string): Promise<void> {
  const store = await MemoryStore.open(storeDir);

  const server = new McpServer({ name: 'memgrep', version: '0.1.0' });

  server.registerTool(
    'recall',
    {
      description:
        'Semantic search across remembered agent chats from ALL projects on this machine. ' +
        'Use when past work, decisions, or solutions might be relevant (e.g. "how did we fix X?", ' +
        '"have we set up Y before?"). Returns matching chats with ids; fetch full transcripts with get_chat.',
      inputSchema: {
        query: z.string().describe('Natural-language description of what to find'),
        k: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
      },
    },
    async ({ query, k }) => {
      const hits = await store.search(query, k ?? 5);
      if (hits.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No matching chats in memory.' }] };
      }
      const text = hits
        .map(
          (h) =>
            `[chat ${h.id}] ${h.title}\n  project: ${h.project} | date: ${h.createdAt.slice(0, 10)} | score: ${h.score.toFixed(3)} | ${h.chars} chars\n  matched: ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`,
        )
        .join('\n\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.registerTool(
    'get_chat',
    {
      description:
        'Fetch the full transcript of a remembered chat by id (from recall or list_chats), ' +
        'to pull its entire context into the current conversation.',
      inputSchema: {
        chatId: z.number().int().describe('Chat id returned by recall or list_chats'),
      },
    },
    async ({ chatId }) => {
      const chat = store.getChat(chatId);
      if (!chat) {
        return {
          content: [{ type: 'text' as const, text: `No chat with id ${chatId}.` }],
          isError: true,
        };
      }
      let body = chat.content;
      if (body.length > MAX_CHAT_CHARS) {
        body =
          body.slice(0, MAX_CHAT_CHARS) +
          `\n\n[... truncated: transcript is ${chat.content.length} chars, showing first ${MAX_CHAT_CHARS} ...]`;
      }
      const header = `# ${chat.title}\nproject: ${chat.project} | date: ${chat.createdAt.slice(0, 10)}\n\n`;
      return { content: [{ type: 'text' as const, text: header + body }] };
    },
  );

  server.registerTool(
    'list_chats',
    {
      description: 'List remembered chats, optionally filtered by project, newest first.',
      inputSchema: {
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    async ({ project }) => {
      const chats = store.listChats(project);
      if (chats.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Memory is empty.' }] };
      }
      const text = chats
        .map((c) => `[chat ${c.id}] ${c.title} (${c.project}, ${c.createdAt.slice(0, 10)}, ${c.chars} chars)`)
        .join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  await server.connect(new StdioServerTransport());
}
