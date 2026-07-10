import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MemoryTools, toMcpContent } from './tools.js';

export function createMemgrepMcpServer(tools: MemoryTools): McpServer {
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
    async ({ query, k }) => toMcpContent(await tools.recall({ query, k })),
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
    async ({ chatId }) => toMcpContent(await tools.getChat({ chatId })),
  );

  server.registerTool(
    'list_chats',
    {
      description: 'List remembered chats, optionally filtered by project, newest first.',
      inputSchema: {
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    async ({ project }) => toMcpContent(await tools.listChats({ project })),
  );

  return server;
}
