import { Agent, Cursor, CursorAgentError, type SDKAgent } from '@cursor/sdk';
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
    name: ctx.name ?? 'memgrep-telegram',
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

function wrapSession(agent: SDKAgent): ProviderSession {
  return {
    id: agent.agentId,
    async send(text: string): Promise<ProviderRun> {
      const run = await agent.send(text);
      return {
        id: run.id,
        wait: async () => {
          const result = await run.wait();
          return {
            id: result.id,
            status: result.status,
            result: result.result,
            modelId: result.model?.id,
          };
        },
        cancel: () => run.cancel(),
      };
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
      return error instanceof CursorAgentError && error.isRetryable;
    },
  };
}
