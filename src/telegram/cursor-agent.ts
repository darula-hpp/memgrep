import { existsSync } from 'node:fs';
import { Agent, Cursor, CursorAgentError, type SDKAgent, type SDKModel } from '@cursor/sdk';
import {
  expandHomePath,
  formatWorkspaceList,
  normalizeWorkspaces,
  resolveWorkspaceRef,
  updateTelegramConfig,
  workspaceNameFromPath,
  type TelegramWorkspace,
} from './config.js';
import {
  clearPersistedAgentId,
  getPersistedAgentId,
  setPersistedAgentId,
} from './session-store.js';

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
  setModel(model: string): Promise<string>;
  listModels(): Promise<string>;
  listWorkspaces(): string;
  switchWorkspace(ref: string): Promise<string>;
  addWorkspace(name: string, dir: string): Promise<string>;
  removeWorkspace(name: string): Promise<string>;
  status(): CursorAgentStatus;
  close(): Promise<void>;
}

export type AgentLifecycleOptions = {
  apiKey: string;
  model: { id: string };
  name?: string;
  local: { cwd: string };
  mcpServers: {
    memgrep: {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
    };
  };
};

/** Injectable create/resume for tests. */
export type AgentLifecycle = {
  create(options: AgentLifecycleOptions): Promise<SDKAgent>;
  resume(agentId: string, options: AgentLifecycleOptions): Promise<SDKAgent>;
};

const defaultAgentLifecycle: AgentLifecycle = {
  create: (options) => Agent.create(options),
  resume: (agentId, options) => Agent.resume(agentId, options),
};

export type CursorAgentPoolOptions = {
  apiKey: string;
  cwd: string;
  model: string;
  mcpUrl: string;
  mcpToken?: string;
  workspaces?: TelegramWorkspace[];
  /** Persist cwd/model changes back to the profile config when true (default). */
  persistConfig?: boolean;
  /** Telegram profile name (default: default). */
  profile?: string;
  /** MEMGREP_HOME override for config persistence. */
  home?: string;
  /** Override Agent.create / Agent.resume (tests). */
  agents?: AgentLifecycle;
};

/**
 * One durable local Cursor agent per Telegram user id (+ cwd).
 * Free-text turns call send(); /new clears the persisted id; drops resume via Agent.resume.
 */
export class CursorAgentPool {
  private readonly sessions = new Map<number, CursorAgentHandle>();
  private cwd: string;
  private model: string;
  private workspaces: TelegramWorkspace[];
  private readonly agents: AgentLifecycle;

  constructor(private readonly options: CursorAgentPoolOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.workspaces = normalizeWorkspaces(options.workspaces, options.cwd);
    this.agents = options.agents ?? defaultAgentLifecycle;
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
  agentOptions(): AgentLifecycleOptions {
    const headers = this.options.mcpToken
      ? { Authorization: `Bearer ${this.options.mcpToken}` }
      : undefined;
    return {
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
    };
  }

  /** @internal */
  async createAgent(): Promise<SDKAgent> {
    return this.agents.create(this.agentOptions());
  }

  /** @internal */
  async resumeAgent(agentId: string): Promise<SDKAgent> {
    return this.agents.resume(agentId, this.agentOptions());
  }

  /**
   * Switch project folder. Drops in-memory handles so the next message resumes
   * (or creates) the agent for the new cwd — does not clear other cwd sessions.
   */
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
      this.persist({ cwd: resolved, workspaces: this.workspaces });
    }
    await this.disposeAllMemory();
    return resolved;
  }

  /**
   * Change model. Keep persisted agent ids; dispose memory so the next ensure
   * resumes with the updated model on the resume/create options.
   */
  async setModel(model: string): Promise<string> {
    const resolved = await this.resolveModelId(model);
    this.model = resolved;
    if (this.options.persistConfig !== false) {
      this.persist({ model: resolved });
    }
    await this.disposeAllMemory();
    return resolved;
  }

  /** @internal */
  async listModelsText(): Promise<string> {
    const current = this.model;
    try {
      const models = await Cursor.models.list({ apiKey: this.options.apiKey });
      if (models.length === 0) {
        return `Current model: ${current}\n(No models returned for this API key.)`;
      }
      const lines = models.map((m, i) => formatModelLine(m, i + 1, current));
      return [`Current: ${current}`, '', ...lines, '', 'Switch with /model <id>'].join('\n');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return [
        `Current model: ${current}`,
        `(Could not list models: ${detail})`,
        'Switch with /model <id> anyway (e.g. composer-2.5, auto).',
      ].join('\n');
    }
  }

  private async resolveModelId(ref: string): Promise<string> {
    const trimmed = ref.trim();
    if (!trimmed) throw new Error('Model id is required. Try /model to list.');

    let models: SDKModel[] | undefined;
    try {
      models = await Cursor.models.list({ apiKey: this.options.apiKey });
    } catch {
      return trimmed;
    }

    const lower = trimmed.toLowerCase();
    const match =
      models.find((m) => m.id.toLowerCase() === lower) ??
      models.find((m) => m.aliases?.some((a) => a.toLowerCase() === lower)) ??
      models.find((m) => m.displayName.toLowerCase() === lower);

    if (match) return match.id;

    const sample = models
      .slice(0, 8)
      .map((m) => m.id)
      .join(', ');
    throw new Error(
      `Unknown model "${trimmed}". Try /model to list.${sample ? ` Examples: ${sample}` : ''}`,
    );
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
      this.persist({ workspaces: this.workspaces });
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
    this.workspaces = next;
    if (this.options.persistConfig !== false) {
      this.persist({ workspaces: this.workspaces });
    }
  }

  private persist(patch: Parameters<typeof updateTelegramConfig>[0]): void {
    updateTelegramConfig(patch, this.options.home, this.options.profile);
  }

  /** Drop in-memory agents only — persisted ids stay for resume. */
  async disposeAllMemory(): Promise<void> {
    const handles = [...this.sessions.values()];
    await Promise.all(handles.map((h) => h.disposeMemory()));
  }

  /** @internal — /new clears disk for each user's current cwd. */
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

  /** @internal */
  getHome(): string | undefined {
    return this.options.home;
  }

  /** @internal */
  getProfile(): string {
    return this.options.profile ?? 'default';
  }
}

/** Cap hung Cursor runs so one stalled turn cannot block the Telegram reply queue. */
export const CURSOR_RUN_TIMEOUT_MS = 5 * 60_000;

class CursorRunTimeoutError extends Error {
  constructor(ms: number) {
    super(`Cursor run timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'CursorRunTimeoutError';
  }
}

class CursorAgentHandle implements CursorAgentSession {
  private agent: SDKAgent | undefined;
  private creating: Promise<SDKAgent> | undefined;
  /** Cwd this in-memory agent was opened for (invalidate on pool cwd change). */
  private agentCwd: string | undefined;

  constructor(
    private readonly userId: number,
    private readonly pool: CursorAgentPool,
  ) {}

  status(): CursorAgentStatus {
    const cwd = this.pool.getCwd();
    const liveId = this.agent && this.agentCwd === cwd ? this.agent.agentId : undefined;
    const persisted =
      liveId ??
      getPersistedAgentId(this.userId, cwd, this.pool.getHome(), this.pool.getProfile());
    return {
      agentId: persisted,
      cwd,
      model: this.pool.getModel(),
      workspaces: this.pool.getWorkspaces(),
    };
  }

  async send(text: string): Promise<string> {
    const agent = await this.ensureAgent();
    let run: Awaited<ReturnType<SDKAgent['send']>> | undefined;
    try {
      run = await agent.send(text);
      const result = await Promise.race([run.wait(), rejectAfter(CURSOR_RUN_TIMEOUT_MS)]);
      if (result.status === 'error') {
        const detail = result.result?.trim();
        console.error(
          `memgrep telegram: Cursor run ${result.id} failed` +
            (detail ? `: ${detail}` : '') +
            (result.model?.id ? ` (model ${result.model.id})` : ''),
        );
        return (
          `Cursor run failed (${result.id}).` +
          (detail ? `\n${detail}` : '\nCheck the Cursor dashboard / local logs.') +
          `\nTry again, or /new / /model composer-2.5 if the model is flaky.`
        );
      }
      if (result.status === 'cancelled') {
        return `Cursor run cancelled (${result.id}).`;
      }
      if (result.result?.trim()) return result.result.trim();
      return '(Cursor finished with no text reply.)';
    } catch (error) {
      if (error instanceof CursorRunTimeoutError) {
        console.error(
          `memgrep telegram: ${error.message}` +
            (run ? ` (run ${run.id})` : '') +
            ` — cancelling run (agent id kept for resume)`,
        );
        try {
          await run?.cancel();
        } catch {
          // Best-effort cancel; dispose memory below either way.
        }
        // Keep persisted agentId so the next message can Agent.resume.
        await this.disposeMemory();
        return (
          `${error.message}.` +
          `\nThe stuck turn was cancelled; the conversation was kept. Send another message to resume, or /new to start fresh.`
        );
      }
      if (error instanceof CursorAgentError) {
        return `Cursor error: ${error.message}${error.isRetryable ? ' (retryable)' : ''}`;
      }
      const message = error instanceof Error ? error.message : String(error);
      return `Cursor error: ${message}`;
    }
  }

  /** Explicit /new — dispose memory and clear persisted id for current cwd. */
  async reset(): Promise<void> {
    const cwd = this.pool.getCwd();
    await this.disposeMemory();
    clearPersistedAgentId(this.userId, cwd, this.pool.getHome(), this.pool.getProfile());
  }

  async setCwd(cwd: string, name?: string): Promise<string> {
    return this.pool.setCwd(cwd, name);
  }

  async setModel(model: string): Promise<string> {
    const next = await this.pool.setModel(model);
    return `Model set to ${next} (same conversation resumes with the new model).`;
  }

  async listModels(): Promise<string> {
    return this.pool.listModelsText();
  }

  listWorkspaces(): string {
    return this.pool.listWorkspacesText();
  }

  async switchWorkspace(ref: string): Promise<string> {
    const name = await this.pool.switchWorkspace(ref);
    return `Switched to ${name} → ${this.pool.getCwd()} (resumes that workspace's chat if any).`;
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
    // Process shutdown — keep persisted ids for the next LaunchAgent start.
    await this.disposeMemory();
  }

  /** @internal */
  async disposeMemory(): Promise<void> {
    const agent = this.agent;
    this.agent = undefined;
    this.agentCwd = undefined;
    this.creating = undefined;
    if (agent) {
      await agent[Symbol.asyncDispose]();
    }
  }

  private async ensureAgent(): Promise<SDKAgent> {
    const cwd = this.pool.getCwd();
    if (this.agent && this.agentCwd === cwd) return this.agent;
    if (this.agent && this.agentCwd !== cwd) {
      await this.disposeMemory();
    }
    if (!this.creating) {
      this.creating = this.openAgent(cwd).finally(() => {
        this.creating = undefined;
      });
    }
    return this.creating;
  }

  private async openAgent(cwd: string): Promise<SDKAgent> {
    const home = this.pool.getHome();
    const profile = this.pool.getProfile();
    const persisted = getPersistedAgentId(this.userId, cwd, home, profile);

    if (persisted) {
      try {
        const agent = await this.pool.resumeAgent(persisted);
        this.agent = agent;
        this.agentCwd = cwd;
        setPersistedAgentId(this.userId, cwd, agent.agentId, home, profile);
        console.error(
          `memgrep telegram: resumed agent ${agent.agentId} for user ${this.userId} (cwd ${cwd})`,
        );
        return agent;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `memgrep telegram: resume failed for ${persisted} (${detail}); creating a new agent`,
        );
        clearPersistedAgentId(this.userId, cwd, home, profile);
      }
    }

    const agent = await this.pool.createAgent();
    this.agent = agent;
    this.agentCwd = cwd;
    setPersistedAgentId(this.userId, cwd, agent.agentId, home, profile);
    console.error(
      `memgrep telegram: created agent ${agent.agentId} for user ${this.userId} (cwd ${cwd})`,
    );
    return agent;
  }
}

function formatModelLine(model: SDKModel, index: number, current: string): string {
  const mark = model.id === current ? ' *' : '';
  const name = model.displayName && model.displayName !== model.id ? ` — ${model.displayName}` : '';
  return `${index}. ${model.id}${name}${mark}`;
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new CursorRunTimeoutError(ms)), ms);
  });
}
