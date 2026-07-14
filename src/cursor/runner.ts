import type { AgentRunMode } from './mode.js';
import type { ProviderRun, ProviderSession } from './provider.js';

/** Cap hung agent runs so one stalled turn cannot block callers forever. */
export const AGENT_RUN_TIMEOUT_MS = 10 * 60_000;

/** @deprecated Use AGENT_RUN_TIMEOUT_MS */
export const CURSOR_RUN_TIMEOUT_MS = AGENT_RUN_TIMEOUT_MS;

export class AgentRunTimeoutError extends Error {
  constructor(ms: number) {
    super(`Agent run timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'AgentRunTimeoutError';
  }
}

export type AgentTurnOk = {
  ok: true;
  text: string;
  runId: string;
  agentId: string;
  modelId?: string;
};

export type AgentTurnFail = {
  ok: false;
  text: string;
  runId?: string;
  agentId: string;
  kind: 'error' | 'timeout' | 'busy' | 'cancelled';
  /** Empty/opaque model error — caller should drop the session and retry fresh. */
  opaque?: boolean;
  retryable?: boolean;
};

export type AgentTurnResult = AgentTurnOk | AgentTurnFail;

export type RunAgentTurnOptions = {
  mode?: AgentRunMode;
  timeoutMs?: number;
  providerId?: string;
  isRetryableError?: (error: unknown) => boolean;
  logPrefix?: string;
};

/**
 * Cursor sometimes returns status=error with an empty result, or with a raw
 * conversation-turn JSON dump that isn't a user-facing error.
 */
export function usefulRunErrorDetail(raw: string | undefined): string | undefined {
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

function isBusyMessage(message: string): boolean {
  return /already has active run/i.test(message);
}

/**
 * Shared send → wait(+timeout) → structured result.
 * Busy-after-force and session reset/retry stay with the caller (pool / MCP service).
 */
export async function runAgentTurn(
  session: ProviderSession,
  text: string,
  options: RunAgentTurnOptions = {},
): Promise<AgentTurnResult> {
  const timeoutMs = options.timeoutMs ?? AGENT_RUN_TIMEOUT_MS;
  const prefix = options.logPrefix ?? 'memgrep cursor';
  const providerId = options.providerId ?? 'cursor';
  let run: ProviderRun | undefined;

  try {
    run = await session.send(text, { mode: options.mode });
    const result = await Promise.race([run.wait(), rejectAfter(timeoutMs)]);

    if (result.status === 'error') {
      const rawDetail = result.result?.trim();
      const detail = usefulRunErrorDetail(rawDetail);
      console.error(
        `${prefix}: ${providerId} run ${result.id} failed` +
          (rawDetail ? `: ${rawDetail.slice(0, 500)}` : ' (empty error detail)') +
          (result.modelId ? ` (model ${result.modelId})` : '') +
          (result.requestId ? ` requestId=${result.requestId}` : '') +
          (result.durationMs !== undefined ? ` ${result.durationMs}ms` : ''),
      );
      if (!detail) {
        return {
          ok: false,
          kind: 'error',
          opaque: true,
          runId: result.id,
          agentId: session.id,
          text:
            `Agent run failed (${result.id}).` +
            `\nModel ${result.modelId ?? 'unknown'} returned an error with no usable message.`,
        };
      }
      return {
        ok: false,
        kind: 'error',
        runId: result.id,
        agentId: session.id,
        text: `Agent run failed (${result.id}).\n${detail}`,
      };
    }

    if (result.status === 'cancelled') {
      return {
        ok: false,
        kind: 'cancelled',
        runId: result.id,
        agentId: session.id,
        text: `Agent run cancelled (${result.id}).`,
      };
    }

    return {
      ok: true,
      runId: result.id,
      agentId: session.id,
      modelId: result.modelId,
      text: result.result?.trim() || '(Agent finished with no text reply.)',
    };
  } catch (error) {
    if (error instanceof AgentRunTimeoutError) {
      console.error(
        `${prefix}: ${error.message}` +
          (run ? ` (run ${run.id})` : '') +
          ' — cancelling run',
      );
      try {
        await run?.cancel();
      } catch {
        // Best-effort cancel.
      }
      return {
        ok: false,
        kind: 'timeout',
        runId: run?.id,
        agentId: session.id,
        text: `${error.message}.`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const busy = isBusyMessage(message);
    const retryable = options.isRetryableError?.(error) === true;
    return {
      ok: false,
      kind: busy ? 'busy' : 'error',
      agentId: session.id,
      runId: run?.id,
      retryable,
      text: `Agent error: ${message}${retryable ? ' (retryable)' : ''}`,
    };
  }
}
