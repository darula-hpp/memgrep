import { existsSync } from 'node:fs';
import {
  expandHomePath,
  formatWorkspaceList,
  normalizeWorkspaces,
  resolveWorkspaceRef,
  updateTelegramConfig,
  workspaceNameFromPath,
  type TelegramWorkspace,
} from '../config.js';
import {
  clearPersistedAgentId,
  getPersistedAgentId,
  setPersistedAgentId,
} from '../session-store.js';
import type { CodingAgentProvider, ProviderContext, ProviderModel, ProviderSession } from './provider.js';
import { createCursorProvider } from './providers/cursor.js';
import type { AgentPool, AgentSession, AgentStatus } from './types.js';
import {
  DEFAULT_AGENT_RUN_MODE,
  formatModesText,
  parseAgentRunMode,
  type AgentRunMode,
} from './mode.js';

/** Cap hung agent runs so one stalled turn cannot block the Telegram reply queue. */
export const AGENT_RUN_TIMEOUT_MS = 10 * 60_000;

/** @deprecated Use AGENT_RUN_TIMEOUT_MS */
export const CURSOR_RUN_TIMEOUT_MS = AGENT_RUN_TIMEOUT_MS;

export type AgentPoolOptions = {
  apiKey: string;
  cwd: string;
  model: string;
  /** Conversation mode for sends (default: agent). */
  mode?: AgentRunMode;
  mcpUrl: string;
  mcpToken?: string;
  workspaces?: TelegramWorkspace[];
  /** Persist cwd/model changes back to the profile config when true (default). */
  persistConfig?: boolean;
  /** Telegram profile name (default: default). */
  profile?: string;
  /** MEMGREP_HOME override for config persistence. */
  home?: string;
  /** Coding-agent backend (default: Cursor SDK). */
  provider?: CodingAgentProvider;
};

export function createAgentPool(options: AgentPoolOptions): AgentPool {
  return new AgentPoolImpl(options);
}

class AgentPoolImpl implements AgentPool {
  private readonly sessions = new Map<number, AgentSessionHandle>();
  private cwd: string;
  private model: string;
  private mode: AgentRunMode;
  private workspaces: TelegramWorkspace[];
  readonly provider: CodingAgentProvider;

  constructor(private readonly options: AgentPoolOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.mode = options.mode ?? DEFAULT_AGENT_RUN_MODE;
    this.workspaces = normalizeWorkspaces(options.workspaces, options.cwd);
    this.provider = options.provider ?? createCursorProvider();
  }

  sessionFor(userId: number): AgentSession {
    let handle = this.sessions.get(userId);
    if (!handle) {
      handle = new AgentSessionHandle(userId, this);
      this.sessions.set(userId, handle);
    }
    return handle;
  }

  status(): AgentStatus {
    return {
      cwd: this.cwd,
      model: this.model,
      mode: this.mode,
      workspaces: this.workspaces,
    };
  }

  async close(): Promise<void> {
    const handles = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(handles.map((h) => h.close()));
  }

  providerContext(): ProviderContext {
    return {
      apiKey: this.options.apiKey,
      cwd: this.cwd,
      model: this.model,
      mcpUrl: this.options.mcpUrl,
      mcpToken: this.options.mcpToken,
    };
  }

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

  async setModel(model: string): Promise<string> {
    const resolved = await this.resolveModelId(model);
    this.model = resolved;
    if (this.options.persistConfig !== false) {
      this.persist({ model: resolved });
    }
    await this.disposeAllMemory();
    return resolved;
  }

  /**
   * Switch conversation mode. Per-send on the provider — no need to dispose
   * the in-memory agent (unlike model/cwd).
   */
  setMode(raw: string): AgentRunMode {
    const next = parseAgentRunMode(raw);
    this.mode = next;
    if (this.options.persistConfig !== false) {
      this.persist({ agentMode: next });
    }
    return next;
  }

  listModesText(): string {
    return formatModesText(this.mode);
  }

  async listModelsText(): Promise<string> {
    const current = this.model;
    try {
      const models = await this.provider.listModels(this.providerContext());
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

    let models: ProviderModel[] | undefined;
    try {
      models = await this.provider.listModels(this.providerContext());
    } catch {
      return trimmed;
    }

    const lower = trimmed.toLowerCase();
    const match =
      models.find((m) => m.id.toLowerCase() === lower) ??
      models.find((m) => m.aliases?.some((a) => a.toLowerCase() === lower)) ??
      models.find((m) => (m.displayName ?? '').toLowerCase() === lower);

    if (match) return match.id;

    const sample = models
      .slice(0, 8)
      .map((m) => m.id)
      .join(', ');
    throw new Error(
      `Unknown model "${trimmed}". Try /model to list.${sample ? ` Examples: ${sample}` : ''}`,
    );
  }

  listWorkspacesText(): string {
    return formatWorkspaceList(this.workspaces, this.cwd);
  }

  async switchWorkspace(ref: string): Promise<string> {
    const ws = resolveWorkspaceRef(ref, this.workspaces);
    if (!ws) {
      throw new Error(`Unknown workspace "${ref}". Try /ws to list.`);
    }
    await this.setCwd(ws.path, ws.name);
    return ws.name;
  }

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

  async disposeAllMemory(): Promise<void> {
    const handles = [...this.sessions.values()];
    await Promise.all(handles.map((h) => h.disposeMemory()));
  }

  getCwd(): string {
    return this.cwd;
  }

  getModel(): string {
    return this.model;
  }

  getMode(): AgentRunMode {
    return this.mode;
  }

  getWorkspaces(): TelegramWorkspace[] {
    return this.workspaces;
  }

  getHome(): string | undefined {
    return this.options.home;
  }

  getProfile(): string {
    return this.options.profile ?? 'default';
  }
}

class AgentRunTimeoutError extends Error {
  constructor(ms: number) {
    super(`Agent run timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'AgentRunTimeoutError';
  }
}

class AgentSessionHandle implements AgentSession {
  private session: ProviderSession | undefined;
  private opening: Promise<ProviderSession> | undefined;
  private sessionCwd: string | undefined;

  constructor(
    private readonly userId: number,
    private readonly pool: AgentPoolImpl,
  ) {}

  status(): AgentStatus {
    const cwd = this.pool.getCwd();
    const liveId = this.session && this.sessionCwd === cwd ? this.session.id : undefined;
    const persisted =
      liveId ??
      getPersistedAgentId(this.userId, cwd, this.pool.getHome(), this.pool.getProfile());
    return {
      agentId: persisted,
      cwd,
      model: this.pool.getModel(),
      mode: this.pool.getMode(),
      workspaces: this.pool.getWorkspaces(),
    };
  }

  async send(text: string): Promise<string> {
    return this.sendAttempt(text, true);
  }

  private async sendAttempt(text: string, retryOnBusy: boolean): Promise<string> {
    const session = await this.ensureSession();
    let run: Awaited<ReturnType<ProviderSession['send']>> | undefined;
    try {
      run = await session.send(text, { mode: this.pool.getMode() });
      const result = await Promise.race([run.wait(), rejectAfter(AGENT_RUN_TIMEOUT_MS)]);
      if (result.status === 'error') {
        const rawDetail = result.result?.trim();
        const detail = usefulRunErrorDetail(rawDetail);
        console.error(
          `memgrep telegram: ${this.pool.provider.id} run ${result.id} failed` +
            (rawDetail ? `: ${rawDetail.slice(0, 500)}` : ' (empty error detail)') +
            (result.modelId ? ` (model ${result.modelId})` : '') +
            (result.requestId ? ` requestId=${result.requestId}` : '') +
            (result.durationMs !== undefined ? ` ${result.durationMs}ms` : ''),
        );
        // Empty / opaque failures often mean a wedged local agent — drop it so
        // the next message starts fresh instead of resume→fail loops.
        if (!detail) {
          await this.reset();
          return (
            `Agent run failed (${result.id}).` +
            `\nModel ${result.modelId ?? 'unknown'} returned an error with no usable message.` +
            `\nStarted a fresh Cursor conversation automatically.` +
            `\nSend your message again, or try /model auto if this keeps happening.`
          );
        }
        return `Agent run failed (${result.id}).\n${detail}\nTry again, or /new / /model auto.`;
      }
      if (result.status === 'cancelled') {
        return `Agent run cancelled (${result.id}).`;
      }
      if (result.result?.trim()) return result.result.trim();
      return '(Agent finished with no text reply.)';
    } catch (error) {
      if (error instanceof AgentRunTimeoutError) {
        console.error(
          `memgrep telegram: ${error.message}` +
            (run ? ` (run ${run.id})` : '') +
            ` — cancelling run and starting a fresh agent`,
        );
        try {
          await run?.cancel();
        } catch {
          // Best-effort cancel.
        }
        await this.reset();
        return (
          `${error.message}.` +
          `\nThe stuck turn was cancelled and a fresh Cursor conversation was started.` +
          `\nSend your message again.`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      const busy = /already has active run/i.test(message);
      if (busy && retryOnBusy) {
        console.error(
          `memgrep telegram: agent still busy after force — resetting and retrying once`,
        );
        await this.reset();
        return this.sendAttempt(text, false);
      }
      const retryable = this.pool.provider.isRetryableError?.(error) === true;
      return (
        `Agent error: ${message}${retryable ? ' (retryable)' : ''}` +
        (busy
          ? `\nStarted a fresh conversation; send your message again if this persists.`
          : '')
      );
    }
  }

  async reset(): Promise<void> {
    const cwd = this.pool.getCwd();
    await this.disposeMemory();
    clearPersistedAgentId(this.userId, cwd, this.pool.getHome(), this.pool.getProfile());
  }

  async switchToAgent(agentId: string): Promise<string> {
    const id = agentId.trim();
    if (!id) throw new Error('Agent id is required.');
    const cwd = this.pool.getCwd();
    const home = this.pool.getHome();
    const profile = this.pool.getProfile();
    const previous = getPersistedAgentId(this.userId, cwd, home, profile);

    await this.disposeMemory();
    setPersistedAgentId(this.userId, cwd, id, home, profile);
    try {
      const session = await this.ensureSession();
      if (session.id !== id) {
        // Provider may normalize; keep whatever resume returned.
        setPersistedAgentId(this.userId, cwd, session.id, home, profile);
      }
      return session.id;
    } catch (error) {
      if (previous) {
        setPersistedAgentId(this.userId, cwd, previous, home, profile);
      } else {
        clearPersistedAgentId(this.userId, cwd, home, profile);
      }
      throw error;
    }
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

  async setMode(mode: string): Promise<string> {
    const next = this.pool.setMode(mode);
    return `Mode set to ${next}. Next messages use this Cursor mode.`;
  }

  listModes(): string {
    return this.pool.listModesText();
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
    await this.disposeMemory();
  }

  async disposeMemory(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.sessionCwd = undefined;
    this.opening = undefined;
    if (session) {
      await session.dispose();
    }
  }

  private async ensureSession(): Promise<ProviderSession> {
    const cwd = this.pool.getCwd();
    if (this.session && this.sessionCwd === cwd) return this.session;
    if (this.session && this.sessionCwd !== cwd) {
      await this.disposeMemory();
    }
    if (!this.opening) {
      this.opening = this.openSession(cwd).finally(() => {
        this.opening = undefined;
      });
    }
    return this.opening;
  }

  private async openSession(cwd: string): Promise<ProviderSession> {
    const home = this.pool.getHome();
    const profile = this.pool.getProfile();
    const provider = this.pool.provider;
    const ctx = this.pool.providerContext();
    const persisted = getPersistedAgentId(this.userId, cwd, home, profile);

    if (persisted) {
      try {
        const session = await provider.resume(persisted, ctx);
        this.session = session;
        this.sessionCwd = cwd;
        setPersistedAgentId(this.userId, cwd, session.id, home, profile);
        console.error(
          `memgrep telegram: resumed ${provider.id} agent ${session.id} for user ${this.userId} (cwd ${cwd})`,
        );
        return session;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `memgrep telegram: resume failed for ${persisted} (${detail}); creating a new agent`,
        );
        clearPersistedAgentId(this.userId, cwd, home, profile);
      }
    }

    const session = await provider.create(ctx);
    this.session = session;
    this.sessionCwd = cwd;
    setPersistedAgentId(this.userId, cwd, session.id, home, profile);
    console.error(
      `memgrep telegram: created ${provider.id} agent ${session.id} for user ${this.userId} (cwd ${cwd})`,
    );
    return session;
  }
}

function formatModelLine(model: ProviderModel, index: number, current: string): string {
  const mark = model.id === current ? ' *' : '';
  const name =
    model.displayName && model.displayName !== model.id ? ` — ${model.displayName}` : '';
  return `${index}. ${model.id}${name}${mark}`;
}

/**
 * Cursor sometimes returns status=error with an empty result, or with a raw
 * conversation-turn JSON dump that isn't a user-facing error. Treat those as
 * opaque so we can auto-/new.
 */
function usefulRunErrorDetail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') && /agentConversationTurn|"type"\s*:\s*"thinkingMessage"/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new AgentRunTimeoutError(ms)), ms);
  });
}
