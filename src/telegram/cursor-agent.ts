import { existsSync } from 'node:fs';
import { Agent, CursorAgentError, type SDKAgent } from '@cursor/sdk';
import { expandHomePath, updateTelegramConfig } from './config.js';

export type CursorAgentStatus = {
  agentId?: string;
  cwd: string;
  model: string;
};

/** Mockable surface used by the Telegram bot. */
export interface CursorAgentSession {
  send(text: string): Promise<string>;
  reset(): Promise<void>;
  setCwd(cwd: string): Promise<string>;
  status(): CursorAgentStatus;
  close(): Promise<void>;
}

export type CursorAgentPoolOptions = {
  apiKey: string;
  cwd: string;
  model: string;
  mcpUrl: string;
  mcpToken?: string;
  /** Persist cwd/model changes back to telegram.json when true (default). */
  persistConfig?: boolean;
};

/**
 * One durable local Cursor agent per Telegram user id.
 * Free-text turns call send(); /new resets; /cwd recreates against a new folder.
 */
export class CursorAgentPool {
  private readonly sessions = new Map<number, CursorAgentHandle>();
  private cwd: string;
  private model: string;

  constructor(private readonly options: CursorAgentPoolOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
  }

  sessionFor(userId: number): CursorAgentSession {
    let handle = this.sessions.get(userId);
    if (!handle) {
      handle = new CursorAgentHandle(userId, this);
      this.sessions.set(userId, handle);
    }
    return handle;
  }

  status(): CursorAgentStatus {
    return { cwd: this.cwd, model: this.model };
  }

  async close(): Promise<void> {
    const handles = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(handles.map((h) => h.close()));
  }

  /** @internal */
  async createAgent(): Promise<SDKAgent> {
    const headers = this.options.mcpToken
      ? { Authorization: `Bearer ${this.options.mcpToken}` }
      : undefined;
    return Agent.create({
      apiKey: this.options.apiKey,
      model: { id: this.model },
      name: 'memgrep-telegram',
      local: { cwd: this.cwd },
      mcpServers: {
        memgrep: {
          type: 'http',
          url: this.options.mcpUrl,
          ...(headers ? { headers } : {}),
        },
      },
    });
  }

  /** @internal */
  async setCwd(cwd: string): Promise<string> {
    const resolved = expandHomePath(cwd);
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    this.cwd = resolved;
    if (this.options.persistConfig !== false) {
      updateTelegramConfig({ cwd: resolved });
    }
    await this.resetAll();
    return resolved;
  }

  /** @internal */
  async resetAll(): Promise<void> {
    const handles = [...this.sessions.values()];
    await Promise.all(handles.map((h) => h.reset()));
  }

  /** @internal */
  getCwd(): string {
    return this.cwd;
  }

  /** @internal */
  getModel(): string {
    return this.model;
  }
}

class CursorAgentHandle implements CursorAgentSession {
  private agent: SDKAgent | undefined;
  private creating: Promise<SDKAgent> | undefined;

  constructor(
    private readonly userId: number,
    private readonly pool: CursorAgentPool,
  ) {}

  status(): CursorAgentStatus {
    return {
      agentId: this.agent?.agentId,
      cwd: this.pool.getCwd(),
      model: this.pool.getModel(),
    };
  }

  async send(text: string): Promise<string> {
    const agent = await this.ensureAgent();
    try {
      const run = await agent.send(text);
      const result = await run.wait();
      if (result.status === 'error') {
        return `Cursor run failed (${result.id}). Check the Cursor dashboard / local logs.`;
      }
      if (result.result?.trim()) return result.result.trim();
      return '(Cursor finished with no text reply.)';
    } catch (error) {
      if (error instanceof CursorAgentError) {
        return `Cursor error: ${error.message}${error.isRetryable ? ' (retryable)' : ''}`;
      }
      throw error;
    }
  }

  async reset(): Promise<void> {
    await this.disposeAgent();
  }

  async setCwd(cwd: string): Promise<string> {
    return this.pool.setCwd(cwd);
  }

  async close(): Promise<void> {
    await this.disposeAgent();
  }

  private async ensureAgent(): Promise<SDKAgent> {
    if (this.agent) return this.agent;
    if (!this.creating) {
      this.creating = this.pool.createAgent().then((agent) => {
        this.agent = agent;
        this.creating = undefined;
        console.error(
          `memgrep telegram: Cursor agent ${agent.agentId} for user ${this.userId} (cwd ${this.pool.getCwd()})`,
        );
        return agent;
      });
    }
    return this.creating;
  }

  private async disposeAgent(): Promise<void> {
    const agent = this.agent;
    this.agent = undefined;
    this.creating = undefined;
    if (agent) {
      await agent[Symbol.asyncDispose]();
    }
  }
}
