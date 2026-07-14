import { existsSync } from 'node:fs';
import {
  expandHomePath,
  resolveWorkspaceRef,
  type TelegramWorkspace,
} from '../telegram/config.js';
import type { ResolvedCursorConfig } from './config.js';
import { isAgentRunMode, parseAgentRunMode, type AgentRunMode } from './mode.js';
import type { CodingAgentProvider, ProviderContext } from './provider.js';
import { createCursorProvider } from './providers/cursor.js';
import { runAgentTurn, type AgentTurnResult } from './runner.js';

export type CursorRunInput = {
  prompt: string;
  /** Workspace name, 1-based index, or absolute path (must be allowlisted or exist + match). */
  cwd?: string;
  model?: string;
  mode?: string;
  /** Resume an existing agent id; otherwise create a new one. */
  agentId?: string;
};

/**
 * Local Cursor agent runs for MCP/CLI — cwd restricted to configured workspaces.
 */
export class CursorAgentService {
  private readonly provider: CodingAgentProvider;

  constructor(
    private readonly config: ResolvedCursorConfig,
    provider?: CodingAgentProvider,
  ) {
    this.provider = provider ?? createCursorProvider();
  }

  listWorkspaces(): TelegramWorkspace[] {
    return this.config.workspaces;
  }

  defaultCwd(): string {
    return this.config.cwd;
  }

  /**
   * Resolve cwd against the allowlist. Bare paths must match a configured workspace
   * (or be the default cwd). Named refs use Telegram's resolveWorkspaceRef.
   */
  resolveCwd(ref?: string): string {
    if (!ref?.trim()) return this.config.cwd;
    const workspaces = this.config.workspaces;
    const resolved = resolveWorkspaceRef(ref, workspaces);
    if (!resolved) {
      throw new Error(
        `Workspace "${ref}" is not allowlisted. Use cursor_workspaces or pass a configured name/path.`,
      );
    }
    const allowed = workspaces.some((w) => w.path === resolved.path);
    const isDefault = expandHomePath(resolved.path) === this.config.cwd;
    if (!allowed && !isDefault) {
      throw new Error(
        `Path ${resolved.path} is not in the Cursor workspace allowlist. Run: node dist/cli.js cursor setup`,
      );
    }
    if (!existsSync(resolved.path)) {
      throw new Error(`cwd does not exist: ${resolved.path}`);
    }
    return resolved.path;
  }

  formatWorkspaces(): string {
    const current = this.config.cwd;
    if (this.config.workspaces.length === 0) {
      return 'No workspaces configured. Run: node dist/cli.js cursor setup';
    }
    const lines = this.config.workspaces.map((ws, i) => {
      const mark = ws.path === current ? ' *' : '';
      return `${i + 1}. ${ws.name}${mark}\n   ${ws.path}`;
    });
    return (
      `Workspaces (* = default cwd):\n\n${lines.join('\n\n')}\n\n` +
      `model=${this.config.model} mode=${this.config.agentMode}`
    );
  }

  async run(input: CursorRunInput): Promise<AgentTurnResult & { cwd: string }> {
    const prompt = input.prompt?.trim();
    if (!prompt) throw new Error('prompt is required.');

    const cwd = this.resolveCwd(input.cwd);
    const model = input.model?.trim() || this.config.model;
    let mode: AgentRunMode = this.config.agentMode;
    if (input.mode?.trim()) {
      mode = parseAgentRunMode(input.mode);
    } else if (!isAgentRunMode(mode)) {
      mode = 'agent';
    }

    const ctx: ProviderContext = {
      apiKey: this.config.apiKey,
      cwd,
      model,
      mcpUrl: this.config.mcpUrl,
      mcpToken: this.config.mcpToken,
      name: 'memgrep-mcp-cursor',
    };

    let session = input.agentId?.trim()
      ? await this.provider.resume(input.agentId.trim(), ctx)
      : await this.provider.create(ctx);

    try {
      let turn = await runAgentTurn(session, prompt, {
        mode,
        providerId: this.provider.id,
        isRetryableError: (e) => this.provider.isRetryableError?.(e) === true,
        logPrefix: 'memgrep cursor-mcp',
      });

      // Busy or opaque error: dispose and retry once with a fresh agent.
      if (!turn.ok && (turn.kind === 'busy' || turn.opaque)) {
        await session.dispose().catch(() => undefined);
        session = await this.provider.create(ctx);
        turn = await runAgentTurn(session, prompt, {
          mode,
          providerId: this.provider.id,
          isRetryableError: (e) => this.provider.isRetryableError?.(e) === true,
          logPrefix: 'memgrep cursor-mcp',
        });
        if (turn.ok) {
          return {
            ...turn,
            text:
              turn.text +
              `\n\n(agentId=${turn.agentId} cwd=${cwd}` +
              (turn.modelId ? ` model=${turn.modelId}` : '') +
              ' — fresh session after recovery)',
            cwd,
          };
        }
      }

      if (turn.ok) {
        return {
          ...turn,
          text:
            turn.text +
            `\n\n(agentId=${turn.agentId} cwd=${cwd}` +
            (turn.modelId ? ` model=${turn.modelId}` : '') +
            ')',
          cwd,
        };
      }

      return { ...turn, cwd };
    } finally {
      // Keep agent alive on disk for resume via agentId; dispose SDK handle.
      await session.dispose().catch(() => undefined);
    }
  }
}
