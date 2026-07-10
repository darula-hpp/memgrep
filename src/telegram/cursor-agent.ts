import { existsSync } from 'node:fs';
import { Agent, CursorAgentError, type SDKAgent } from '@cursor/sdk';
import {
  expandHomePath,
  formatWorkspaceList,
  normalizeWorkspaces,
  resolveWorkspaceRef,
  updateTelegramConfig,
  workspaceNameFromPath,
  type TelegramWorkspace,
} from './config.js';

export type CursorAgentStatus = {
  agentId?: string;
  cwd: string;
  model: string;
  workspaces: TelegramWorkspace[];
};

/** Mockable surface used by the Telegram bot. */
export interface CursorAgentSession {
  send(text: string): Promise<string>;
  reset(): Promise<void>;
  setCwd(cwd: string, name?: string): Promise<string>;
  listWorkspaces(): string;
  switchWorkspace(ref: string): Promise<string>;
  addWorkspace(name: string, dir: string): Promise<string>;
  removeWorkspace(name: string): Promise<string>;
  status(): CursorAgentStatus;
  close(): Promise<void>;
}

export type CursorAgentPoolOptions = {
  apiKey: string;
  cwd: string;
  model: string;
  mcpUrl: string;
  mcpToken?: string;
  workspaces?: TelegramWorkspace[];
  /** Persist cwd/model changes back to telegram.json when true (default). */
  persistConfig?: boolean;
};

/**
 * One durable local Cursor agent per Telegram user id.
 * Free-text turns call send(); /new resets; /ws and /cwd switch project folders.
 */
export class CursorAgentPool {
  private readonly sessions = new Map<number, CursorAgentHandle>();
  private cwd: string;
  private model: string;
  private workspaces: TelegramWorkspace[];

  constructor(private readonly options: CursorAgentPoolOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.workspaces = normalizeWorkspaces(options.workspaces, options.cwd);
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
    return { cwd: this.cwd, model: this.model, workspaces: this.workspaces };
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
  async setCwd(cwd: string, name?: string): Promise<string> {
    const resolved = expandHomePath(cwd);
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    this.cwd = resolved;
    const label = name?.trim() || workspaceNameFromPath(resolved);
    const withoutPath = this.workspaces.filter((w) => w.path !== resolved);
    const withoutName = withoutPath.filter((w) => w.name.toLowerCase() !== label.toLowerCase());
    this.workspaces = normalizeWorkspaces([...withoutName, { name: label, path: resolved }], resolved);
    if (this.options.persistConfig !== false) {
      updateTelegramConfig({ cwd: resolved, workspaces: this.workspaces });
    }
    await this.resetAll();
    return resolved;
  }

  /** @internal */
  listWorkspacesText(): string {
    return formatWorkspaceList(this.workspaces, this.cwd);
  }

  /** @internal */
  async switchWorkspace(ref: string): Promise<string> {
    const ws = resolveWorkspaceRef(ref, this.workspaces);
    if (!ws) {
      throw new Error(`Unknown workspace "${ref}". Try /ws to list.`);
    }
    await this.setCwd(ws.path, ws.name);
    return ws.name;
  }

  /** @internal */
  async addWorkspace(name: string, dir: string): Promise<TelegramWorkspace> {
    const label = name.trim();
    const resolved = expandHomePath(dir);
    if (!label) throw new Error('Workspace name is required.');
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    const rest = this.workspaces.filter((w) => w.name.toLowerCase() !== label.toLowerCase());
    this.workspaces = normalizeWorkspaces([...rest, { name: label, path: resolved }], this.cwd);
    if (this.options.persistConfig !== false) {
      updateTelegramConfig({ workspaces: this.workspaces });
    }
    return { name: label, path: resolved };
  }

  /** @internal */
  async removeWorkspace(name: string): Promise<void> {
    const label = name.trim().toLowerCase();
    const next = this.workspaces.filter((w) => w.name.toLowerCase() !== label);
    if (next.length === this.workspaces.length) {
      throw new Error(`No workspace named "${name}".`);
    }
    const removed = this.workspaces.find((w) => w.name.toLowerCase() === label);
    this.workspaces = next;
    if (removed && removed.path === this.cwd && next.length > 0) {
      // Stay on cwd even if removed from list — just drop the name entry.
    }
    if (this.options.persistConfig !== false) {
      updateTelegramConfig({ workspaces: this.workspaces });
    }
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

  /** @internal */
  getWorkspaces(): TelegramWorkspace[] {
    return this.workspaces;
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
      workspaces: this.pool.getWorkspaces(),
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

  async setCwd(cwd: string, name?: string): Promise<string> {
    return this.pool.setCwd(cwd, name);
  }

  listWorkspaces(): string {
    return this.pool.listWorkspacesText();
  }

  async switchWorkspace(ref: string): Promise<string> {
    const name = await this.pool.switchWorkspace(ref);
    return `Switched to ${name} → ${this.pool.getCwd()} (new Cursor conversation).`;
  }

  async addWorkspace(name: string, dir: string): Promise<string> {
    const ws = await this.pool.addWorkspace(name, dir);
    return `Added workspace ${ws.name}\n${ws.path}`;
  }

  async removeWorkspace(name: string): Promise<string> {
    await this.pool.removeWorkspace(name);
    return `Removed workspace ${name}.`;
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
