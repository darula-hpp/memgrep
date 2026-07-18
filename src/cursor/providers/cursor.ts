import {
  Agent,
  AgentBusyError,
  Cursor,
  CursorAgentError,
  type SDKAgent,
  type SendOptions,
} from '@cursor/sdk';
import type {
  CodingAgentProvider,
  ProviderContext,
  ProviderModel,
  ProviderRun,
  ProviderSession,
} from '../provider.js';

function mcpHeaders(ctx: ProviderContext): Record<string, string> | undefined {
  return ctx.mcpToken ? { Authorization: `Bearer ${ctx.mcpToken}` } : undefined;
}

function sdkOptions(ctx: ProviderContext) {
  const headers = mcpHeaders(ctx);
  return {
    apiKey: ctx.apiKey,
    model: { id: ctx.model },
    name: ctx.name ?? 'memgrep-cursor',
    local: { cwd: ctx.cwd },
    mcpServers: {
      memgrep: {
        type: 'http' as const,
        url: ctx.mcpUrl,
        ...(headers ? { headers } : {}),
      },
    },
  };
}

function sendOptions(options?: { mode?: 'agent' | 'plan' }, force = false): SendOptions | undefined {
  const next: SendOptions = {};
  if (options?.mode) next.mode = options.mode;
  if (force) next.local = { force: true };
  return next.mode || next.local ? next : undefined;
}

function wrapRun(run: Awaited<ReturnType<SDKAgent['send']>>): ProviderRun {
  return {
    id: run.id,
    wait: async () => {
      const result = await run.wait();
      let detail = result.result;
      // Composer sometimes returns status=error with an empty result string.
      if (result.status === 'error' && !detail?.trim() && run.supports('conversation')) {
        try {
          const turns = await run.conversation();
          const last = turns.at(-1);
          if (last) {
            detail = summarizeConversationTurn(last);
          }
        } catch {
          // Best-effort diagnostics only.
        }
      }
      return {
        id: result.id,
        status: result.status,
        result: detail,
        modelId: result.model?.id,
        requestId: result.requestId,
        durationMs: result.durationMs,
      };
    },
    cancel: () => run.cancel(),
  };
}

function summarizeConversationTurn(turn: unknown): string | undefined {
  if (!turn || typeof turn !== 'object') return undefined;
  const text = JSON.stringify(turn);
  if (text.length <= 2) return undefined;
  const clipped = text.replace(/\s+/g, ' ').slice(0, 500);
  return clipped || undefined;
}

function isBusyError(error: unknown): boolean {
  if (error instanceof AgentBusyError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /already has active run/i.test(message);
}

function wrapSession(agent: SDKAgent): ProviderSession {
  return {
    id: agent.agentId,
    async send(text: string, options?: { mode?: 'agent' | 'plan' }): Promise<ProviderRun> {
      try {
        return wrapRun(await agent.send(text, sendOptions(options)));
      } catch (error) {
        // Local agents can stay "busy" after a crashed/timed-out process even
        // though no live run remains. SDK force expires the wedged run.
        if (!isBusyError(error)) throw error;
        console.error(
          `memgrep cursor: agent ${agent.agentId} busy — forcing new run (expire stuck active run)`,
        );
        try {
          return wrapRun(await agent.send(text, sendOptions(options, true)));
        } catch (forcedError) {
          if (isBusyError(forcedError)) {
            console.error(
              `memgrep cursor: agent ${agent.agentId} still busy after force — caller should reset`,
            );
          }
          throw forcedError;
        }
      }
    },
    async dispose(): Promise<void> {
      await agent[Symbol.asyncDispose]();
    },
  };
}

/** Cursor SDK adapter — the only CodingAgentProvider shipped today. */
export function createCursorProvider(): CodingAgentProvider {
  return {
    id: 'cursor',

    async create(ctx: ProviderContext): Promise<ProviderSession> {
      const agent = await Agent.create(sdkOptions(ctx));
      return wrapSession(agent);
    },

    async resume(agentId: string, ctx: ProviderContext): Promise<ProviderSession> {
      const agent = await Agent.resume(agentId, sdkOptions(ctx));
      return wrapSession(agent);
    },

    async listModels(ctx: ProviderContext): Promise<ProviderModel[]> {
      const models = await Cursor.models.list({ apiKey: ctx.apiKey });
      return models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        aliases: m.aliases,
      }));
    },

    isRetryableError(error: unknown): boolean {
      if (error instanceof CursorAgentError && error.isRetryable) return true;
      const msg = error instanceof Error ? error.message : String(error);
      // Connect/HTTP2 transport drops mid-turn — worth one fresh-session retry.
      return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|\[aborted\]|ConnectError/i.test(
        msg,
      );
    },
  };
}
