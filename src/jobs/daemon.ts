import { resolveTelegramConfig, DEFAULT_TELEGRAM_PROFILE } from '../telegram/config.js';
import { DEFAULT_CURSOR_MODEL } from '../telegram/config.js';
import { startHttpMcpServer, type HttpMcpHandle } from '../memory/mcp.js';
import { fetchEdgeOnline, getEdgeHub } from '../edge/hub.js';
import { readEdgeHubConfig } from '../edge/config.js';
import { CursorJobExecutor } from './cursor-executor.js';
import { EdgeJobExecutor } from './edge-executor.js';
import { ExecutorRegistry } from './executor.js';
import type { JobExecuteContext } from './executor.js';
import { NotifierRegistry, TelegramJobNotifier, NoopNotifier } from './notifier.js';
import { JobsService } from './service.js';
import { JobStore } from './store.js';
import type { Job } from './types.js';

function edgeStatusUrlFromMcp(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  url.pathname = '/edge/status';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function makeIsEdgeOnline(mcpUrl: string, mcpToken?: string, home?: string) {
  return async (): Promise<boolean> => {
    const local = getEdgeHub();
    if (local?.isOnline()) return true;
    const edgeToken = readEdgeHubConfig(home)?.token;
    const token = mcpToken ?? edgeToken;
    // Prefer the always-on hub (serve :3921 / MEMGREP_MCP_URL), not an ephemeral embed.
    const candidates = [
      process.env.MEMGREP_EDGE_STATUS_URL,
      process.env.MEMGREP_MCP_URL
        ? edgeStatusUrlFromMcp(process.env.MEMGREP_MCP_URL)
        : undefined,
      'http://127.0.0.1:3921/edge/status',
      edgeStatusUrlFromMcp(mcpUrl),
    ].filter((u): u is string => !!u);
    const seen = new Set<string>();
    for (const url of candidates) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (await fetchEdgeOnline(url, token)) return true;
    }
    return false;
  };
}

export const DEFAULT_TICK_MS = 30_000;

export type JobsDaemonOptions = {
  home?: string;
  tickMs?: number;
  /** Prefer existing MCP HTTP (e.g. memgrep serve). */
  mcpUrl?: string;
  mcpToken?: string;
  /** Start in-process MCP when mcpUrl not set (default true). */
  embedMcp?: boolean;
};

/**
 * Long-running scheduler: tick → claim → execute → notify → advance nextRunAt.
 */
export class JobsDaemon {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private tickInFlight: Promise<void> | undefined;
  private httpHandle: HttpMcpHandle | undefined;
  private store: JobStore | undefined;
  private service: JobsService | undefined;

  constructor(private readonly options: JobsDaemonOptions = {}) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.store = JobStore.open(this.options.home);
    const recovered = this.store.recoverStaleRuns();
    if (recovered > 0) {
      console.error(`memgrep jobs: recovered ${recovered} stale run(s)`);
    }

    let mcpUrl = this.options.mcpUrl ?? process.env.MEMGREP_MCP_URL;
    const mcpToken = this.options.mcpToken ?? process.env.MEMGREP_MCP_TOKEN;

    if (!mcpUrl && this.options.embedMcp !== false) {
      this.httpHandle = await startHttpMcpServer({
        host: '127.0.0.1',
        port: 0,
        authToken: mcpToken,
        storeDir: this.options.home,
      });
      mcpUrl = this.httpHandle.url;
      console.error(`memgrep jobs: MCP at ${mcpUrl}`);
    }
    if (!mcpUrl) {
      throw new Error('No MCP URL. Set MEMGREP_MCP_URL or allow embedded MCP.');
    }

    const executors = new ExecutorRegistry();
    executors.register(new CursorJobExecutor());
    executors.register(new EdgeJobExecutor());

    const notifiers = new NotifierRegistry();
    notifiers.register(new NoopNotifier());

    const resolveContext = (job: Job): JobExecuteContext => {
      const profile = job.telegramProfile ?? DEFAULT_TELEGRAM_PROFILE;
      const resolved = resolveTelegramConfig(process.env, this.options.home, profile);
      if (!resolved?.cursorApiKey) {
        throw new Error(
          `CURSOR_API_KEY missing for telegram profile "${profile}". Run: memgrep telegram setup ${profile}`,
        );
      }
      return {
        scheduledAt: new Date().toISOString(),
        mcpUrl: mcpUrl!,
        mcpToken: mcpToken ?? resolved.mcpToken,
        cursorApiKey: resolved.cursorApiKey,
        model: job.model ?? resolved.model ?? DEFAULT_CURSOR_MODEL,
      };
    };

    // Wire telegram notifier lazily per job profile inside a wrapper.
    notifiers.register({
      kind: 'telegram',
      async notify(job, result, meta) {
        const profile = job.telegramProfile ?? DEFAULT_TELEGRAM_PROFILE;
        const resolved = resolveTelegramConfig(process.env, undefined, profile);
        if (!resolved) {
          console.error(`memgrep jobs: no telegram profile "${profile}" for notify`);
          return;
        }
        const userIds = [...resolved.allowedUserIds];
        if (userIds.length === 0) {
          console.error(`memgrep jobs: no allowlisted users on profile "${profile}"`);
          return;
        }
        const tg = new TelegramJobNotifier({
          botToken: resolved.botToken,
          userIds,
        });
        await tg.notify(job, result, meta);
      },
    });

    this.service = new JobsService({
      store: this.store,
      executors,
      notifiers,
      resolveContext,
      notifyKind: 'telegram',
      isEdgeOnline: makeIsEdgeOnline(mcpUrl, mcpToken, this.options.home),
    });

    const tickMs = this.options.tickMs ?? DEFAULT_TICK_MS;
    console.error(`memgrep jobs: daemon started (tick ${tickMs}ms)`);

    const runTick = () => {
      if (this.tickInFlight) return;
      this.tickInFlight = this.service!.tick()
        .then((msgs) => {
          for (const m of msgs) console.error(`memgrep jobs: ${m}`);
        })
        .catch((error) => {
          console.error(
            `memgrep jobs: tick error: ${error instanceof Error ? error.message : error}`,
          );
        })
        .finally(() => {
          this.tickInFlight = undefined;
        });
    };

    runTick();
    this.timer = setInterval(runTick, tickMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.tickInFlight) {
      await this.tickInFlight.catch(() => undefined);
    }
    if (this.httpHandle) {
      await this.httpHandle.close();
      this.httpHandle = undefined;
    }
    this.store?.close();
    this.store = undefined;
    this.service = undefined;
  }

  /** Expose service for `jobs run` when sharing daemon wiring. */
  getService(): JobsService | undefined {
    return this.service;
  }
}

/** Build a JobsService with Cursor executor for one-shot CLI `jobs run`. */
export async function createRunnableJobsService(options: {
  home?: string;
  mcpUrl?: string;
  mcpToken?: string;
  embedMcp?: boolean;
} = {}): Promise<{
  service: JobsService;
  close: () => Promise<void>;
}> {
  const store = JobStore.open(options.home);
  let httpHandle: HttpMcpHandle | undefined;
  let mcpUrl = options.mcpUrl ?? process.env.MEMGREP_MCP_URL;
  const mcpToken = options.mcpToken ?? process.env.MEMGREP_MCP_TOKEN;

  if (!mcpUrl && options.embedMcp !== false) {
    httpHandle = await startHttpMcpServer({
      host: '127.0.0.1',
      port: 0, // ephemeral — avoid clashing with telegram's 3921
      authToken: mcpToken,
      storeDir: options.home,
    });
    mcpUrl = httpHandle.url;
  }
  if (!mcpUrl) {
    store.close();
    throw new Error('No MCP URL available for job run.');
  }

  const executors = new ExecutorRegistry();
  executors.register(new CursorJobExecutor());
  executors.register(new EdgeJobExecutor());
  const notifiers = new NotifierRegistry();
  notifiers.register(new NoopNotifier());
  notifiers.register({
    kind: 'telegram',
    async notify(job, result, meta) {
      const profile = job.telegramProfile ?? DEFAULT_TELEGRAM_PROFILE;
      const resolved = resolveTelegramConfig(process.env, options.home, profile);
      if (!resolved) return;
      const tg = new TelegramJobNotifier({
        botToken: resolved.botToken,
        userIds: [...resolved.allowedUserIds],
      });
      await tg.notify(job, result, meta);
    },
  });

  const service = new JobsService({
    store,
    executors,
    notifiers,
    isEdgeOnline: makeIsEdgeOnline(mcpUrl, mcpToken, options.home),
    resolveContext: (job) => {
      const profile = job.telegramProfile ?? DEFAULT_TELEGRAM_PROFILE;
      const resolved = resolveTelegramConfig(process.env, options.home, profile);
      if (!resolved?.cursorApiKey) {
        throw new Error(`CURSOR_API_KEY missing for profile "${profile}".`);
      }
      return {
        scheduledAt: new Date().toISOString(),
        mcpUrl: mcpUrl!,
        mcpToken: mcpToken ?? resolved.mcpToken,
        cursorApiKey: resolved.cursorApiKey,
        model: job.model ?? resolved.model ?? DEFAULT_CURSOR_MODEL,
      };
    },
  });

  return {
    service,
    close: async () => {
      if (httpHandle) await httpHandle.close();
      store.close();
    },
  };
}
