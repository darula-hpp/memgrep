import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { MemoryStore, defaultHome } from './store.js';
import { MemoryTools } from './tools.js';
import { createMemgrepMcpServer } from './mcp-server.js';
import { JobStore } from '../jobs/store.js';
import { JobsService } from '../jobs/service.js';
import { JobsTools } from '../jobs/tools.js';
import { resolveJiraConfig } from '../jira/config.js';
import { JiraClient } from '../jira/client.js';
import { JiraService } from '../jira/service.js';
import { JiraTools } from '../jira/tools.js';
import {
  fetchClientCredentialsToken,
  resolveProductHuntConfig,
} from '../producthunt/config.js';
import { ProductHuntClient } from '../producthunt/client.js';
import { ProductHuntService } from '../producthunt/service.js';
import { ProductHuntTools } from '../producthunt/tools.js';
import { resolvePostHogConfig } from '../posthog/config.js';
import { PostHogClient } from '../posthog/client.js';
import { PostHogService } from '../posthog/service.js';
import { PostHogTools } from '../posthog/tools.js';
import { resolveNeonConfig } from '../neon/config.js';
import { NeonClient } from '../neon/client.js';
import { NeonService } from '../neon/service.js';
import { NeonTools } from '../neon/tools.js';
import { resolveUpstashConfig } from '../upstash/config.js';
import { UpstashClient } from '../upstash/client.js';
import { UpstashService } from '../upstash/service.js';
import { UpstashTools } from '../upstash/tools.js';
import { resolveGcloudConfig } from '../gcloud/config.js';
import { GcloudClient } from '../gcloud/client.js';
import { GcloudService } from '../gcloud/service.js';
import { GcloudTools } from '../gcloud/tools.js';
import { resolveCursorConfig } from '../cursor/config.js';
import { CursorAgentService } from '../cursor/service.js';
import { CursorTools } from '../cursor/tools.js';
import { resolveLoopConfig } from '../loop/config.js';
import { LoopService } from '../loop/service.js';
import { LoopTools } from '../loop/tools.js';
import { ensureEdgeHubToken, readEdgeHubConfig } from '../edge/config.js';
import { ensureGlobalEdgeHub, setEdgeHub } from '../edge/hub.js';
import { EdgeTools } from '../edge/tools.js';

function openJobsTools(storeDir?: string): { jobs: JobsTools; closeJobs: () => void } {
  const jobStore = JobStore.open(storeDir);
  const jobs = new JobsTools(new JobsService({ store: jobStore }));
  return {
    jobs,
    closeJobs: () => jobStore.close(),
  };
}

/** Returns undefined when Jira is not configured (tools omitted from MCP). */
function openJiraTools(storeDir?: string): JiraTools | undefined {
  const config = resolveJiraConfig(process.env, storeDir);
  if (!config) return undefined;
  return new JiraTools(new JiraService(new JiraClient(config)));
}

/** Returns undefined when Product Hunt is not configured (tools omitted from MCP). */
async function openProductHuntTools(storeDir?: string): Promise<ProductHuntTools | undefined> {
  const config = resolveProductHuntConfig(process.env, storeDir);
  if (!config) return undefined;
  let token = config.token;
  if (!token && config.apiKey && config.apiSecret) {
    token = await fetchClientCredentialsToken(config.apiKey, config.apiSecret);
  }
  if (!token) return undefined;
  return new ProductHuntTools(
    new ProductHuntService(new ProductHuntClient({ ...config, token })),
  );
}

/** Returns undefined when PostHog is not configured (tools omitted from MCP). */
function openPostHogTools(storeDir?: string): PostHogTools | undefined {
  const config = resolvePostHogConfig(process.env, storeDir);
  if (!config) return undefined;
  return new PostHogTools(new PostHogService(new PostHogClient(config)));
}

/** Returns undefined when Neon is not configured (tools omitted from MCP). */
function openNeonTools(storeDir?: string): NeonTools | undefined {
  const config = resolveNeonConfig(process.env, storeDir);
  if (!config) return undefined;
  return new NeonTools(new NeonService(new NeonClient(config)));
}

/** Returns undefined when Upstash is not configured (tools omitted from MCP). */
function openUpstashTools(storeDir?: string): UpstashTools | undefined {
  const config = resolveUpstashConfig(process.env, storeDir);
  if (!config) return undefined;
  return new UpstashTools(new UpstashService(new UpstashClient(config)));
}

/** Returns undefined when Google Cloud is not configured (tools omitted from MCP). */
function openGcloudTools(storeDir?: string): GcloudTools | undefined {
  const config = resolveGcloudConfig(process.env, storeDir);
  if (!config) return undefined;
  return new GcloudTools(new GcloudService(new GcloudClient(config)));
}

/** Returns undefined when Cursor API key is not configured (tools omitted from MCP). */
function openCursorTools(storeDir?: string): CursorTools | undefined {
  const config = resolveCursorConfig(process.env, storeDir);
  if (!config) return undefined;
  return new CursorTools(new CursorAgentService(config));
}

/**
 * Loop needs loop.json + Cursor. Jira is optional (only for jiraKey enrichment).
 */
function openLoopTools(memory: MemoryTools, storeDir?: string): LoopTools | undefined {
  const loopConfig = resolveLoopConfig(storeDir);
  const cursorConfig = resolveCursorConfig(process.env, storeDir);
  if (!loopConfig || !cursorConfig) return undefined;
  const jiraConfig = resolveJiraConfig(process.env, storeDir);
  const service = new LoopService(
    loopConfig,
    new CursorAgentService(cursorConfig),
    memory,
    jiraConfig ? new JiraService(new JiraClient(jiraConfig)) : undefined,
  );
  return new LoopTools(
    service,
    { cursorReady: true, jiraReady: !!jiraConfig },
    { home: storeDir },
  );
}
export type ServeTransport = 'stdio' | 'http';

export type ServeOptions = {
  storeDir?: string;
  transport?: ServeTransport;
  host?: string;
  port?: number;
  /** Required when host is not loopback. */
  authToken?: string;
  /**
   * Extra Hostnames allowed by MCP DNS-rebinding protection (public tunnel host).
   * Always merged with localhost / 127.0.0.1 / ::1.
   */
  allowedHosts?: string[];
};

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 3921;

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Hostname from https://host/mcp or bare host. */
export function hostnameFromUrlOrHost(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname || undefined;
    }
    // Strip path/port if someone passed host:port/path
    return new URL(`http://${trimmed}`).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hostnames permitted behind any public tunnel. Defaults include loopback plus
 * MEMGREP_PUBLIC_URL / MEMGREP_PUBLIC_HOST, MEMGREP_ALLOWED_HOSTS, and
 * ~/.memgrep/mcp-public-url. MEMGREP_NGROK_DOMAIN is still accepted for one-release compat.
 */
export function resolveAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
  extra: string[] = [],
): string[] {
  const hosts = new Set<string>(['127.0.0.1', 'localhost', '::1', '[::1]']);

  for (const part of (env.MEMGREP_ALLOWED_HOSTS ?? '').split(',')) {
    const h = hostnameFromUrlOrHost(part);
    if (h) hosts.add(h);
  }

  const publicUrl = hostnameFromUrlOrHost(env.MEMGREP_PUBLIC_URL ?? '');
  if (publicUrl) hosts.add(publicUrl);
  const publicHost = hostnameFromUrlOrHost(env.MEMGREP_PUBLIC_HOST ?? '');
  if (publicHost) hosts.add(publicHost);

  // Compat: older installs used MEMGREP_NGROK_DOMAIN for the tunnel hostname.
  const legacyPublic = hostnameFromUrlOrHost(env.MEMGREP_NGROK_DOMAIN ?? '');
  if (legacyPublic) hosts.add(legacyPublic);

  const urlFile = path.join(home, 'mcp-public-url');
  if (existsSync(urlFile)) {
    try {
      const h = hostnameFromUrlOrHost(readFileSync(urlFile, 'utf8'));
      if (h) hosts.add(h);
    } catch {
      // ignore
    }
  }

  for (const e of extra) {
    const h = hostnameFromUrlOrHost(e);
    if (h) hosts.add(h);
  }

  return [...hosts];
}

export async function startMcpServer(options: ServeOptions | string = {}): Promise<void | HttpMcpHandle> {
  // Back-compat: startMcpServer(storeDir?) used by older call sites.
  if (typeof options === 'string' || options === undefined) {
    await startStdioMcpServer(typeof options === 'string' ? options : undefined);
    return;
  }
  const transport = options.transport ?? 'stdio';
  if (transport === 'stdio') {
    await startStdioMcpServer(options.storeDir);
    return;
  }
  return startHttpMcpServer(options);
}

export async function startStdioMcpServer(storeDir?: string): Promise<void> {
  const store = await MemoryStore.open(storeDir);
  const tools = new MemoryTools(store);
  const { jobs } = openJobsTools(storeDir);
  const jira = openJiraTools(storeDir);
  const productHunt = await openProductHuntTools(storeDir);
  const posthog = openPostHogTools(storeDir);
  const neon = openNeonTools(storeDir);
  const upstash = openUpstashTools(storeDir);
  const gcloud = openGcloudTools(storeDir);
  const cursor = openCursorTools(storeDir);
  const loop = openLoopTools(tools, storeDir);
  const server = createMemgrepMcpServer(tools, {
    jobs,
    jira,
    productHunt,
    posthog,
    neon,
    upstash,
    gcloud,
    cursor,
    loop,
  });
  await server.connect(new StdioServerTransport());
}

export type HttpMcpHandle = {
  url: string;
  close: () => Promise<void>;
};

export async function startHttpMcpServer(options: ServeOptions = {}): Promise<HttpMcpHandle> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = options.port ?? DEFAULT_HTTP_PORT;
  const authToken = options.authToken ?? process.env.MEMGREP_MCP_TOKEN;

  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      `Refusing to bind MCP HTTP on non-loopback host "${host}" without MEMGREP_MCP_TOKEN (or --token).`,
    );
  }

  const store = await MemoryStore.open(options.storeDir);
  const tools = new MemoryTools(store);
  const { jobs, closeJobs } = openJobsTools(options.storeDir);
  const jira = openJiraTools(options.storeDir);
  const productHunt = await openProductHuntTools(options.storeDir);
  const posthog = openPostHogTools(options.storeDir);
  const neon = openNeonTools(options.storeDir);
  const upstash = openUpstashTools(options.storeDir);
  const gcloud = openGcloudTools(options.storeDir);
  const cursor = openCursorTools(options.storeDir);
  const loop = openLoopTools(tools, options.storeDir);

  const edgeHub = ensureGlobalEdgeHub({ home: options.storeDir ?? defaultHome(), store });
  ensureEdgeHubToken(options.storeDir ?? defaultHome());
  const edge = new EdgeTools(edgeHub);

  // Loopback bind + public tunnel Host header: allow configured tunnel hostname.
  const allowedHosts = resolveAllowedHosts(process.env, options.storeDir, options.allowedHosts);
  const app = createMcpExpressApp({ host, allowedHosts });

  if (authToken) {
    app.use('/mcp', (req, res, next) => {
      const header = req.header('authorization') ?? '';
      const expected = `Bearer ${authToken}`;
      if (header !== expected) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null,
        });
        return;
      }
      next();
    });
  }

  const edgeAuthOk = (req: express.Request): boolean => {
    const edgeToken = readEdgeHubConfig(options.storeDir ?? defaultHome())?.token;
    const header = req.header('authorization') ?? '';
    const okMcp = !!authToken && header === `Bearer ${authToken}`;
    const okEdge = !!edgeToken && header === `Bearer ${edgeToken}`;
    return isLoopbackHost(host) || okMcp || okEdge;
  };

  app.get('/edge/status', (req, res) => {
    if (!edgeAuthOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(edgeHub.getPresence());
  });

  app.post('/edge/invoke', express.json({ limit: '4mb' }), async (req, res) => {
    if (!edgeAuthOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const args =
      req.body?.arguments && typeof req.body.arguments === 'object'
        ? (req.body.arguments as Record<string, unknown>)
        : {};
    const timeoutMs =
      typeof req.body?.timeoutMs === 'number' ? req.body.timeoutMs : undefined;
    if (!name) {
      res.status(400).json({ ok: false, text: 'name is required', isError: true });
      return;
    }
    if (!edgeHub.isOnline()) {
      res.status(503).json({ ok: false, text: 'edge offline', isError: true });
      return;
    }
    try {
      const result = await edgeHub.invokeTool(name, args, timeoutMs);
      res.json(result);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      res.status(503).json({ ok: false, text, isError: true });
    }
  });

  app.post('/mcp', async (req, res) => {
    const server = createMemgrepMcpServer(tools, {
      jobs,
      jira,
      productHunt,
      posthog,
      neon,
      upstash,
      gcloud,
      cursor,
      loop,
      edge,
    });
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  const httpServer = createServer(app);
  edgeHub.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.on('error', reject);
  });

  const address = httpServer.address() as AddressInfo;
  const url = `http://${host}:${address.port}/mcp`;
  console.error(`memgrep MCP HTTP listening on ${url}`);
  console.error(`memgrep edge hub WebSocket on ws://${host}:${address.port}/edge`);

  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        void edgeHub.close().finally(() => {
          setEdgeHub(null);
          httpServer.close((err) => {
            closeJobs();
            store.close();
            if (err) reject(err);
            else resolve();
          });
        });
      }),
  };
}
