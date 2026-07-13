import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { MemoryStore } from './store.js';
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

export type ServeTransport = 'stdio' | 'http';

export type ServeOptions = {
  storeDir?: string;
  transport?: ServeTransport;
  host?: string;
  port?: number;
  /** Required when host is not loopback. */
  authToken?: string;
};

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 3921;

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
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
  const server = createMemgrepMcpServer(tools, { jobs, jira, productHunt, posthog });
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

  const app = createMcpExpressApp({ host });

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

  app.post('/mcp', async (req, res) => {
    const server = createMemgrepMcpServer(tools, { jobs, jira, productHunt, posthog });
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
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.on('error', reject);
  });

  const address = httpServer.address() as AddressInfo;
  const url = `http://${host}:${address.port}/mcp`;
  console.error(`memgrep MCP HTTP listening on ${url}`);

  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => {
          closeJobs();
          store.close();
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
