import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MemoryTools, toMcpContent } from './tools.js';
import type { JobsTools } from '../jobs/tools.js';
import type { JiraTools } from '../jira/tools.js';
import type { ProductHuntTools } from '../producthunt/tools.js';
import type { PostHogTools } from '../posthog/tools.js';
import type { NeonTools } from '../neon/tools.js';
import type { UpstashTools } from '../upstash/tools.js';
import type { GcloudTools } from '../gcloud/tools.js';
import type { CursorTools } from '../cursor/tools.js';
import type { LoopTools } from '../loop/tools.js';
import type { EdgeTools } from '../edge/tools.js';
import type { DocsTools } from '../docs/tools.js';

export type McpToolBundles = {
  jobs?: JobsTools;
  jira?: JiraTools;
  productHunt?: ProductHuntTools;
  posthog?: PostHogTools;
  neon?: NeonTools;
  upstash?: UpstashTools;
  gcloud?: GcloudTools;
  cursor?: CursorTools;
  loop?: LoopTools;
  edge?: EdgeTools;
  docs?: DocsTools;
};

export function createMemgrepMcpServer(
  tools: MemoryTools,
  bundles: McpToolBundles = {},
): McpServer {
  const server = new McpServer({ name: 'memgrep', version: '0.1.0' });
  const { jobs, jira, productHunt, posthog, neon, upstash, gcloud, cursor, loop, edge, docs } =
    bundles;

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

  if (jira) {
    registerJiraTools(server, jira);
  }

  if (productHunt) {
    registerProductHuntTools(server, productHunt);
  }

  if (posthog) {
    registerPostHogTools(server, posthog);
  }

  if (neon) {
    registerNeonTools(server, neon);
  }

  if (upstash) {
    registerUpstashTools(server, upstash);
  }

  if (gcloud) {
    registerGcloudTools(server, gcloud);
  }

  if (cursor) {
    registerCursorTools(server, cursor);
  }

  if (loop) {
    registerLoopTools(server, loop);
  }

  if (edge) {
    registerEdgeTools(server, edge);
  }

  if (docs) {
    registerDocsTools(server, docs);
  }

  return server;
}

function registerEdgeTools(server: McpServer, edge: EdgeTools): void {
  server.registerTool(
    'edge_status',
    {
      description:
        'Show edge node presence on this cloud hub (online, device id, capabilities, last seen).',
      inputSchema: {},
    },
    async () => toMcpContent(edge.status()),
  );

  server.registerTool(
    'edge_ping',
    {
      description:
        'Ping the connected edge node. Fails with "edge offline" when no edge is connected.',
      inputSchema: {},
    },
    async () => toMcpContent(await edge.ping()),
  );

  server.registerTool(
    'edge_run',
    {
      description:
        'Run an allowlisted command on the edge node (local shell on that machine). ' +
        'Requires the edge online with edge_run enabled. Fails with "edge offline" otherwise.',
      inputSchema: {
        argv: z.array(z.string()).min(1).describe('Command argv, e.g. ["uname", "-a"]'),
        cwd: z.string().optional().describe('Working directory on the edge host'),
        timeoutMs: z.number().int().min(1000).max(300000).optional(),
      },
    },
    async (input) => toMcpContent(await edge.run(input)),
  );

  server.registerTool(
    'edge_loop_run',
    {
      description:
        'Start a coding loop on the connected edge node (background). ' +
        'Use when the edge has better compute or local repos. Fails with edge offline if disconnected. ' +
        'Enable on the edge with: memgrep edge pair … --tools edge_ping,edge_loop_run',
      inputSchema: {
        task: z.string().describe('Free-text task description'),
        profile: z.string().optional().describe('Loop profile on the edge host'),
        jiraKey: z.string().optional(),
        cwd: z.string().optional().describe('Workspace on the edge host'),
        agentId: z.string().optional(),
        maxIterations: z.number().int().min(1).max(20).optional(),
        query: z.string().optional(),
        telegramProfile: z.string().optional(),
        notify: z.boolean().optional(),
      },
    },
    async (input) => toMcpContent(await edge.loopRun(input)),
  );

  server.registerTool(
    'edge_cursor_run',
    {
      description:
        'Run a one-shot Cursor agent on the edge node (blocking). ' +
        'Prefer for jobs / short agent turns that should use edge compute.',
      inputSchema: {
        prompt: z.string().describe('Full prompt for the agent'),
        cwd: z.string().describe('Working directory on the edge host'),
        model: z.string().optional(),
        mcpUrl: z.string().optional().describe('MCP URL the edge agent should use'),
        mcpToken: z.string().optional(),
      },
    },
    async (input) => toMcpContent(await edge.cursorRun(input)),
  );
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
        executor: z
          .enum(['cursor', 'edge'])
          .optional()
          .describe('cursor (hub) or edge (Cursor turn on edge node)'),
        requires: z
          .enum(['edge', 'mac-edge'])
          .optional()
          .describe('Require edge node online before run (fails with edge offline)'),
      },
    },
    async (input) => {
      const normalized = {
        ...input,
        requires:
          input.requires === 'mac-edge' || input.executor === 'edge'
            ? ('edge' as const)
            : input.requires,
      };
      return toMcpContent(jobs.add(normalized));
    },
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
        requires: z.enum(['edge', 'mac-edge']).nullable().optional(),
      },
    },
    async ({ idOrName, ...patch }) => {
      const next =
        patch.requires === 'mac-edge' ? { ...patch, requires: 'edge' as const } : patch;
      return toMcpContent(jobs.update(idOrName, next));
    },
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

function registerJiraTools(server: McpServer, jira: JiraTools): void {
  server.registerTool(
    'jira_search',
    {
      description:
        'Search Jira issues with JQL (Atlassian Cloud). Returns keys, summaries, and status.',
      inputSchema: {
        jql: z.string().describe('JQL query, e.g. project = ENG AND status = "In Progress"'),
        maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      },
    },
    async ({ jql, maxResults }) => toMcpContent(await jira.search({ jql, maxResults })),
  );

  server.registerTool(
    'jira_get_issue',
    {
      description: 'Fetch a Jira issue by key (summary, status, description).',
      inputSchema: {
        key: z.string().describe('Issue key, e.g. ENG-123'),
      },
    },
    async ({ key }) => toMcpContent(await jira.getIssue({ key })),
  );

  server.registerTool(
    'jira_create_issue',
    {
      description:
        'Create a Jira issue. Project falls back to defaultProject from memgrep jira config when omitted.',
      inputSchema: {
        project: z.string().optional().describe('Project key (optional if defaultProject is set)'),
        summary: z.string().describe('Issue summary / title'),
        description: z.string().optional().describe('Plain-text description'),
        issueType: z.string().optional().describe('Issue type name (default Task)'),
      },
    },
    async (input) => toMcpContent(await jira.createIssue(input)),
  );

  server.registerTool(
    'jira_add_comment',
    {
      description: 'Add a plain-text comment to a Jira issue.',
      inputSchema: {
        key: z.string().describe('Issue key, e.g. ENG-123'),
        body: z.string().describe('Comment body'),
      },
    },
    async ({ key, body }) => toMcpContent(await jira.addComment({ key, body })),
  );

  server.registerTool(
    'jira_transition',
    {
      description:
        'Transition a Jira issue by transition name or id (e.g. "Done", "In Progress").',
      inputSchema: {
        key: z.string().describe('Issue key, e.g. ENG-123'),
        transition: z.string().describe('Transition name or id'),
      },
    },
    async ({ key, transition }) => toMcpContent(await jira.transition({ key, transition })),
  );

  server.registerTool(
    'jira_list_projects',
    {
      description: 'List Jira projects visible to the configured account.',
      inputSchema: {},
    },
    async () => toMcpContent(await jira.listProjects()),
  );
}

function registerProductHuntTools(server: McpServer, ph: ProductHuntTools): void {
  server.registerTool(
    'ph_today',
    {
      description:
        'List Product Hunt posts from today (UTC), ordered by votes. Use for daily launch digests.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Max posts (default 20)'),
      },
    },
    async ({ limit }) => toMcpContent(await ph.today({ limit })),
  );

  server.registerTool(
    'ph_search',
    {
      description:
        'Search recent Product Hunt posts by name/tagline substring (official API has no full-text search).',
      inputSchema: {
        query: z.string().describe('Substring to match in name, tagline, or slug'),
        limit: z.number().int().min(1).max(50).optional().describe('Max matches (default 10)'),
      },
    },
    async ({ query, limit }) => toMcpContent(await ph.search({ query, limit })),
  );

  server.registerTool(
    'ph_get_post',
    {
      description: 'Fetch a Product Hunt post by numeric id or slug.',
      inputSchema: {
        idOrSlug: z.string().describe('Post id (digits) or slug, e.g. notion'),
      },
    },
    async ({ idOrSlug }) => toMcpContent(await ph.getPost({ idOrSlug })),
  );

  server.registerTool(
    'ph_comments',
    {
      description: 'List comments on a Product Hunt post (by id or slug).',
      inputSchema: {
        idOrSlug: z.string().describe('Post id (digits) or slug'),
        limit: z.number().int().min(1).max(50).optional().describe('Max comments (default 20)'),
      },
    },
    async ({ idOrSlug, limit }) => toMcpContent(await ph.comments({ idOrSlug, limit })),
  );
}

function registerPostHogTools(server: McpServer, posthog: PostHogTools): void {
  server.registerTool(
    'posthog_query',
    {
      description:
        'Run a HogQL (SQL) query against PostHog events/persons. Requires Query Read on the personal API key.',
      inputSchema: {
        hogql: z.string().describe('HogQL SELECT query'),
        name: z.string().optional().describe('Optional query name for PostHog query_log'),
      },
    },
    async ({ hogql, name }) => toMcpContent(await posthog.query({ hogql, name })),
  );

  server.registerTool(
    'posthog_top_events',
    {
      description:
        'List top PostHog event names by volume over the last N days (convenience HogQL; no SQL required).',
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe('Lookback days (default 7)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max events (default 20)'),
      },
    },
    async ({ days, limit }) => toMcpContent(await posthog.topEvents({ days, limit })),
  );

  server.registerTool(
    'posthog_feature_flags',
    {
      description: 'List PostHog feature flags for the configured project.',
      inputSchema: {},
    },
    async () => toMcpContent(await posthog.featureFlags()),
  );

  server.registerTool(
    'posthog_get_flag',
    {
      description: 'Get a PostHog feature flag by numeric id or key.',
      inputSchema: {
        idOrKey: z.string().describe('Flag id (digits) or key, e.g. new-checkout'),
      },
    },
    async ({ idOrKey }) => toMcpContent(await posthog.getFlag({ idOrKey })),
  );
}

function registerNeonTools(server: McpServer, neon: NeonTools): void {
  server.registerTool(
    'neon_list_projects',
    {
      description: 'List Neon projects visible to the configured API key.',
      inputSchema: {},
    },
    async () => toMcpContent(await neon.listProjects()),
  );

  server.registerTool(
    'neon_get_project',
    {
      description:
        'Get a Neon project by id (falls back to defaultProjectId / NEON_PROJECT_ID when omitted).',
      inputSchema: {
        projectId: z.string().optional().describe('Neon project id'),
      },
    },
    async ({ projectId }) => toMcpContent(await neon.getProject({ projectId })),
  );

  server.registerTool(
    'neon_list_branches',
    {
      description:
        'List branches for a Neon project (falls back to defaultProjectId when projectId omitted).',
      inputSchema: {
        projectId: z.string().optional().describe('Neon project id'),
      },
    },
    async ({ projectId }) => toMcpContent(await neon.listBranches({ projectId })),
  );

  server.registerTool(
    'neon_connection_uri',
    {
      description:
        'Fetch a Postgres connection URI for a Neon project/branch (password included; also shows a redacted form).',
      inputSchema: {
        projectId: z.string().optional().describe('Neon project id'),
        branchId: z.string().optional().describe('Branch id (optional)'),
        databaseName: z.string().optional().describe('Database name (optional)'),
        roleName: z.string().optional().describe('Role name (optional)'),
      },
    },
    async (input) => toMcpContent(await neon.connectionUri(input)),
  );
}

function registerGcloudTools(server: McpServer, gcloud: GcloudTools): void {
  server.registerTool(
    'gcloud_list_projects',
    {
      description: 'List Google Cloud projects visible to the configured credentials (ADC or SA).',
      inputSchema: {},
    },
    async () => toMcpContent(await gcloud.listProjects()),
  );

  server.registerTool(
    'gcloud_logs_query',
    {
      description:
        'Query Cloud Logging entries (newest first). Optional Logging filter and pageSize; defaults to configured projectId.',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Cloud Logging filter (e.g. severity>=ERROR OR resource.type="gce_instance")'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max entries to return (default 20)'),
        projectId: z.string().optional().describe('Override GCP project id'),
      },
    },
    async (input) => toMcpContent(await gcloud.logsQuery(input)),
  );

  server.registerTool(
    'gcloud_list_instances',
    {
      description:
        'List Compute Engine VM instances. Optional zone; uses defaultZone from config when set, otherwise aggregated list across zones.',
      inputSchema: {
        zone: z.string().optional().describe('GCE zone (e.g. africa-south1-a)'),
        projectId: z.string().optional().describe('Override GCP project id'),
      },
    },
    async (input) => toMcpContent(await gcloud.listInstances(input)),
  );

  server.registerTool(
    'gcloud_get_instance',
    {
      description: 'Describe a single Compute Engine VM instance by zone and name (read-only).',
      inputSchema: {
        zone: z.string().describe('GCE zone (e.g. africa-south1-a)'),
        name: z.string().describe('Instance name'),
        projectId: z.string().optional().describe('Override GCP project id'),
      },
    },
    async (input) => toMcpContent(await gcloud.getInstance(input)),
  );
}

function registerUpstashTools(server: McpServer, upstash: UpstashTools): void {
  server.registerTool(
    'upstash_ping',
    {
      description: 'Ping the configured Upstash Redis REST database and report dbsize.',
      inputSchema: {},
    },
    async () => toMcpContent(await upstash.ping()),
  );

  server.registerTool(
    'upstash_get',
    {
      description: 'GET a string key from Upstash Redis.',
      inputSchema: {
        key: z.string().describe('Redis key'),
      },
    },
    async ({ key }) => toMcpContent(await upstash.get({ key })),
  );

  server.registerTool(
    'upstash_set',
    {
      description: 'SET a string key in Upstash Redis (optional EX seconds).',
      inputSchema: {
        key: z.string().describe('Redis key'),
        value: z.string().describe('Value to store'),
        exSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional TTL in seconds'),
      },
    },
    async (input) => toMcpContent(await upstash.set(input)),
  );

  server.registerTool(
    'upstash_del',
    {
      description: 'DEL one or more keys from Upstash Redis.',
      inputSchema: {
        keys: z.array(z.string()).min(1).describe('Keys to delete'),
      },
    },
    async ({ keys }) => toMcpContent(await upstash.del({ keys })),
  );

  server.registerTool(
    'upstash_dbsize',
    {
      description: 'Return the number of keys in the Upstash Redis database.',
      inputSchema: {},
    },
    async () => toMcpContent(await upstash.dbsize()),
  );

  server.registerTool(
    'upstash_ttl',
    {
      description: 'TTL for a key (-2 missing, -1 no expiry, else seconds).',
      inputSchema: {
        key: z.string().describe('Redis key'),
      },
    },
    async ({ key }) => toMcpContent(await upstash.ttl({ key })),
  );

  server.registerTool(
    'upstash_type',
    {
      description: 'TYPE of a Redis key (string, hash, list, set, zset, stream, none).',
      inputSchema: {
        key: z.string().describe('Redis key'),
      },
    },
    async ({ key }) => toMcpContent(await upstash.type({ key })),
  );

  server.registerTool(
    'upstash_scan',
    {
      description:
        'SCAN keys (prefer over KEYS). Returns cursor + matching keys; pass cursor to continue.',
      inputSchema: {
        cursor: z.string().optional().describe('Cursor from a previous scan (default 0)'),
        match: z.string().optional().describe('Glob pattern, e.g. session:*'),
        count: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Hint for page size (default 50)'),
      },
    },
    async (input) => toMcpContent(await upstash.scan(input)),
  );
}

function registerCursorTools(server: McpServer, cursor: CursorTools): void {
  server.registerTool(
    'cursor_workspaces',
    {
      description:
        'List allowlisted local workspaces for the Mac-side Cursor agent (use names with cursor_run).',
      inputSchema: {},
    },
    async () => toMcpContent(await cursor.workspaces()),
  );

  server.registerTool(
    'cursor_status',
    {
      description:
        'Show whether the local Cursor MCP agent host is configured (default cwd, workspace count).',
      inputSchema: {},
    },
    async () => toMcpContent(await cursor.status()),
  );

  server.registerTool(
    'cursor_run',
    {
      description:
        'Run a turn on the local Cursor agent (Mac host). Work happens in an allowlisted cwd. ' +
        'Pass agentId from a previous result to resume. Use for remote/cloud Cursor agents that ' +
        'tunnel to this MCP via HTTP (any reverse tunnel to loopback).',
      inputSchema: {
        prompt: z.string().describe('Instruction for the local Cursor agent'),
        cwd: z
          .string()
          .optional()
          .describe('Workspace name, index, or allowlisted path (default: configured cwd)'),
        model: z.string().optional().describe('Cursor model id (optional)'),
        mode: z
          .string()
          .optional()
          .describe('Conversation mode: agent | plan (ask → plan)'),
        agentId: z
          .string()
          .optional()
          .describe('Resume this Cursor agent id instead of creating a new one'),
      },
    },
    async (input) => toMcpContent(await cursor.run(input)),
  );
}

const loopArtifactSchema = z.object({
  id: z.string().describe('Stable id'),
  kind: z.enum(['path', 'url', 'text', 'builtin']).describe('Artifact kind'),
  value: z.string().describe('Path, URL, text, or builtin name (github_pr)'),
  label: z.string().optional().describe('Short label'),
  description: z.string().optional().describe('What the agent should do with it'),
});

function registerLoopTools(server: McpServer, loop: LoopTools): void {
  const profileField = z
    .string()
    .optional()
    .describe(
      'Loop project profile under ~/.memgrep/loops/<name>/ (default: active / MEMGREP_LOOP_PROFILE)',
    );

  server.registerTool(
    'loop_status',
    {
      description:
        'Show loop configuration for the active (or selected) project profile: cwd, defaults, ' +
        'manifest paths, and whether Cursor/Jira are ready. Jira is optional.',
      inputSchema: {},
    },
    async () => toMcpContent(await loop.status()),
  );

  server.registerTool(
    'loop_run',
    {
      description:
        'Start the coding loop in the background (does not wait). Requires free-text task. ' +
        'Optional profile selects ~/.memgrep/loops/<profile>/ defaults. Optional jiraKey enriches context. ' +
        'Optional task-specific inputs/exits/actions merge over defaults. ' +
        'target=edge starts the loop on the connected edge node (better local compute). ' +
        'After PASS, runs exit actions (builtin github_pr then agent actions). Telegram notifies on complete.',
      inputSchema: {
        task: z.string().describe('Free-text task description (required)'),
        profile: profileField,
        jiraKey: z
          .string()
          .optional()
          .describe('Optional Jira issue key to fetch and attach (requires Jira config)'),
        inputs: z.array(loopArtifactSchema).optional().describe('Task-specific inputs'),
        exits: z
          .array(loopArtifactSchema)
          .optional()
          .describe('Task-specific exit conditions'),
        actions: z.array(loopArtifactSchema).optional().describe('Task-specific exit actions'),
        cwd: z
          .string()
          .optional()
          .describe('Workspace name/path override (must be Cursor-allowlisted)'),
        agentId: z.string().optional().describe('Resume this Cursor agent id'),
        maxIterations: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Max implement/verify iterations'),
        query: z.string().optional().describe('Optional memgrep recall query'),
        telegramProfile: z
          .string()
          .optional()
          .describe('Telegram profile for completion notify'),
        target: z
          .enum(['local', 'edge'])
          .optional()
          .describe('local (default) or edge (run on connected edge node)'),
      },
    },
    async (input) => toMcpContent(await loop.run(input)),
  );

  server.registerTool(
    'loop_run_status',
    {
      description:
        'On-demand snapshot of a background loop run. Prefer Telegram notify over busy-polling.',
      inputSchema: {
        runId: z.string().optional().describe('Run id returned by loop_run'),
        task: z.string().optional().describe('Task text or jira key — latest matching run'),
        profile: profileField,
      },
    },
    async (input) => toMcpContent(await loop.runStatus(input)),
  );

  server.registerTool(
    'loop_upsert_input',
    {
      description: 'Add or update a default loop input and regenerate inputs.manifest.md.',
      inputSchema: {
        id: z.string(),
        kind: z.enum(['path', 'url', 'text', 'builtin']),
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        profile: profileField,
      },
    },
    async (input) => toMcpContent(await loop.upsertInput(input)),
  );

  server.registerTool(
    'loop_remove_input',
    {
      description: 'Remove a default loop input by id and regenerate the manifest.',
      inputSchema: { id: z.string(), profile: profileField },
    },
    async (input) => toMcpContent(await loop.removeInput(input)),
  );

  server.registerTool(
    'loop_upsert_exit',
    {
      description: 'Add or update a default exit condition and regenerate exits.manifest.md.',
      inputSchema: {
        id: z.string(),
        kind: z.enum(['path', 'url', 'text', 'builtin']),
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        profile: profileField,
      },
    },
    async (input) => toMcpContent(await loop.upsertExit(input)),
  );

  server.registerTool(
    'loop_remove_exit',
    {
      description: 'Remove a default exit condition by id.',
      inputSchema: { id: z.string(), profile: profileField },
    },
    async (input) => toMcpContent(await loop.removeExit(input)),
  );

  server.registerTool(
    'loop_upsert_action',
    {
      description: 'Add or update a default exit action and regenerate actions.manifest.md.',
      inputSchema: {
        id: z.string(),
        kind: z.enum(['path', 'url', 'text', 'builtin']),
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        profile: profileField,
      },
    },
    async (input) => toMcpContent(await loop.upsertAction(input)),
  );

  server.registerTool(
    'loop_remove_action',
    {
      description: 'Remove a default exit action by id.',
      inputSchema: { id: z.string(), profile: profileField },
    },
    async (input) => toMcpContent(await loop.removeAction(input)),
  );
}

function registerDocsTools(server: McpServer, docs: DocsTools): void {
  server.registerTool(
    'docs_setup',
    {
      description:
        'Ensure project-local .memgrep/templates and .memgrep/docs directories exist in the current working directory.',
      inputSchema: {},
    },
    async () => toMcpContent(docs.setup()),
  );

  server.registerTool(
    'docs_list_templates',
    {
      description:
        'List .docx templates in <cwd>/.memgrep/templates (Jinja-style {{ placeholders }}).',
      inputSchema: {},
    },
    async () => toMcpContent(docs.listTemplates()),
  );

  server.registerTool(
    'docs_extract',
    {
      description: 'Extract {{ field }} names from a Word template under .memgrep/templates.',
      inputSchema: {
        template: z.string().describe('Template filename, e.g. minutes.docx'),
      },
    },
    async ({ template }) => toMcpContent(await docs.extract({ template })),
  );

  server.registerTool(
    'docs_fill',
    {
      description:
        'Fill a Word template with context and write <cwd>/.memgrep/docs/<name>.docx plus a .context.json sidecar for re-editing.',
      inputSchema: {
        template: z.string().describe('Template filename under .memgrep/templates'),
        context: z
          .record(z.string(), z.unknown())
          .describe('Field values; dotted keys like meeting.date are supported'),
        name: z.string().optional().describe('Output slug (default: template basename)'),
      },
    },
    async (input) => toMcpContent(await docs.fill(input)),
  );

  server.registerTool(
    'docs_list',
    {
      description: 'List filled documents in <cwd>/.memgrep/docs.',
      inputSchema: {},
    },
    async () => toMcpContent(docs.list()),
  );

  server.registerTool(
    'docs_serve',
    {
      description:
        'Start (or reuse) a localhost web editor for filled docs. Returns a URL; edits re-fill from the original template and overwrite the docx in place.',
      inputSchema: {
        name: z.string().optional().describe('Filled doc slug to open'),
        port: z.number().int().min(1).max(65535).optional().describe('Port (default 8791)'),
      },
    },
    async (input) => toMcpContent(await docs.serve(input)),
  );
}