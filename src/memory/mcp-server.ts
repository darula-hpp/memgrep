import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MemoryTools, toMcpContent } from './tools.js';
import type { JobsTools } from '../jobs/tools.js';

export function createMemgrepMcpServer(
  tools: MemoryTools,
  jobs?: JobsTools,
): McpServer {
  const server = new McpServer({ name: 'memgrep', version: '0.1.0' });

  server.registerTool(
    'recall',
    {
      description:
        'Hybrid search (semantic vectors + keyword/BM25) across remembered agent chats from ALL projects on this machine. ' +
        'Use when past work, decisions, or solutions might be relevant (e.g. "how did we fix X?", ' +
        '"have we set up Y before?", ticket ids, error codes). Returns matching chats with ids; fetch full transcripts with get_chat.',
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
    'resolve_open',
    {
      description:
        'Resolve a remembered chat for opening/resuming. Returns JSON with title, project, ' +
        'optional cursorAgentId, and transcript content. Used by Telegram /open.',
      inputSchema: {
        chatId: z.number().int().describe('Chat id from recall or list_chats'),
      },
    },
    async ({ chatId }) => {
      const target = tools.resolveOpen({ chatId });
      if (!target) {
        return toMcpContent({
          text: JSON.stringify({ error: 'not_found', chatId }),
          isError: true,
        });
      }
      return toMcpContent({ text: JSON.stringify(target) });
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
    async ({ project }) => toMcpContent(await tools.listChats({ project })),
  );

  server.registerTool(
    'remember',
    {
      description:
        'Store a manual note in memgrep memory (a decision, postmortem, or context that is not in a transcript). ' +
        'Use when the user asks to remember something, or when you want a durable fact available to future agents via recall.',
      inputSchema: {
        text: z.string().describe('Note body to store'),
        title: z.string().optional().describe('Short title (defaults to a truncated note)'),
        project: z.string().optional().describe('Project name (defaults to "notes")'),
      },
    },
    async ({ text, title, project }) => toMcpContent(await tools.remember({ text, title, project })),
  );

  if (jobs) {
    registerJobsTools(server, jobs);
  }

  return server;
}

function registerJobsTools(server: McpServer, jobs: JobsTools): void {
  server.registerTool(
    'jobs_list',
    {
      description:
        'List scheduled memgrep jobs (cron + playbook). Use before adding/updating schedules.',
      inputSchema: {},
    },
    async () => toMcpContent(jobs.list()),
  );

  server.registerTool(
    'jobs_add',
    {
      description:
        'Create a scheduled job that runs a remembered playbook via Cursor on a cron schedule. ' +
        'Provide playbookId (from remember/list_chats) or playbookQuery. Default mode is notify (Telegram summary; prefer preview for side effects).',
      inputSchema: {
        name: z.string().describe('Short job name'),
        cron: z.string().describe('5-field cron, e.g. "0 9 * * 1-5"'),
        prompt: z.string().describe('What the agent should do when the job fires'),
        cwd: z.string().describe('Absolute or ~/ project directory for the Cursor agent'),
        playbookId: z.number().int().optional().describe('memgrep chat id of the playbook'),
        playbookQuery: z.string().optional().describe('Semantic query to find the playbook'),
        model: z.string().optional().describe('Cursor model id'),
        telegramProfile: z.string().optional().describe('Telegram profile for credentials/notify'),
        mode: z.enum(['notify', 'auto']).optional().describe('notify (default) or auto'),
        enabled: z.boolean().optional().describe('Default true'),
      },
    },
    async (input) => toMcpContent(jobs.add(input)),
  );

  server.registerTool(
    'jobs_update',
    {
      description: 'Update an existing job (cron, prompt, mode, enable/disable, etc.).',
      inputSchema: {
        idOrName: z.string().describe('Job id or name'),
        name: z.string().optional(),
        cron: z.string().optional(),
        prompt: z.string().optional(),
        cwd: z.string().optional(),
        playbookId: z.number().int().nullable().optional(),
        playbookQuery: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        telegramProfile: z.string().nullable().optional(),
        mode: z.enum(['notify', 'auto']).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ idOrName, ...patch }) => toMcpContent(jobs.update(idOrName, patch)),
  );

  server.registerTool(
    'jobs_remove',
    {
      description: 'Delete a scheduled job.',
      inputSchema: {
        idOrName: z.string().describe('Job id or name'),
      },
    },
    async ({ idOrName }) => toMcpContent(jobs.remove(idOrName)),
  );

  server.registerTool(
    'jobs_run',
    {
      description:
        'Run a job once immediately (starts a Cursor agent with the playbook). Requires CURSOR_API_KEY / telegram profile setup.',
      inputSchema: {
        idOrName: z.string().describe('Job id or name'),
      },
    },
    async ({ idOrName }) => toMcpContent(await jobs.run(idOrName)),
  );

  server.registerTool(
    'jobs_logs',
    {
      description: 'Show recent run history for a job.',
      inputSchema: {
        idOrName: z.string().describe('Job id or name'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ idOrName, limit }) => toMcpContent(jobs.logs(idOrName, limit)),
  );
}
