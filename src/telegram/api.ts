import dns from 'node:dns';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import type { TelegramUpdate } from './types.js';
import { isAbortError } from './errors.js';
import { GET_UPDATES_CLIENT_GUARD_MS, GET_UPDATES_TIMEOUT_SEC } from './polling.js';

const TG_API = 'https://api.telegram.org';

// Prefer IPv4; many networks time out on Telegram AAAA / Happy Eyeballs races.
dns.setDefaultResultOrder('ipv4first');

function createTgDispatcher(): Agent {
  return new Agent({
    connect: { family: 4, timeout: 30_000 },
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
  });
}

/** Shared IPv4 dispatcher — rebuilt on poll stalls / 409 conflicts. */
let tgDispatcher = createTgDispatcher();

/**
 * Tear down keep-alive sockets and open a fresh dispatcher (OpenClaw-style
 * transport rebuild after polling stalls or getUpdates 409s).
 */
export async function rebuildTelegramTransport(): Promise<void> {
  const previous = tgDispatcher;
  tgDispatcher = createTgDispatcher();
  try {
    await previous.close();
  } catch {
    // Ignore close races while in-flight requests drain.
  }
}

async function tgFetch(url: URL | string, init: UndiciRequestInit = {}): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: tgDispatcher }) as unknown as Promise<Response>;
}

export type TelegramBotInfo = {
  id: number;
  username?: string;
  first_name?: string;
};

/** Build a Bot API method URL. Absolute form is required because tokens contain ":". */
export function telegramMethodUrl(botToken: string, method: string): URL {
  return new URL(`${TG_API}/bot${botToken}/${method}`);
}

export class TelegramApi {
  private pollController: AbortController | undefined;

  constructor(private readonly botToken: string) {}

  private url(method: string): URL {
    return telegramMethodUrl(this.botToken, method);
  }

  /** Abort an in-flight long poll (used on shutdown / stall recovery). */
  abortPoll(): void {
    this.pollController?.abort();
    this.pollController = undefined;
  }

  async getMe(): Promise<TelegramBotInfo> {
    const res = await fetchWithRetry(this.url('getMe'), {}, 15_000);
    const body = (await res.json()) as {
      ok: boolean;
      result?: TelegramBotInfo;
      description?: string;
    };
    if (!res.ok || !body.ok || !body.result) {
      throw new Error(body.description ?? `getMe failed (HTTP ${res.status})`);
    }
    return body.result;
  }

  /**
   * Long-poll getUpdates. Client aborts at GET_UPDATES_CLIENT_GUARD_MS so a
   * dead socket cannot block forever; quiet aborts return [] (liveness tick).
   */
  async getUpdates(
    offset = 0,
    timeoutSec = GET_UPDATES_TIMEOUT_SEC,
  ): Promise<TelegramUpdate[]> {
    const url = this.url('getUpdates');
    url.searchParams.set('timeout', String(timeoutSec));
    url.searchParams.set('offset', String(offset));

    this.abortPoll();
    const controller = new AbortController();
    this.pollController = controller;
    const guardMs = Math.max(GET_UPDATES_CLIENT_GUARD_MS, (timeoutSec + 5) * 1000);
    const timer = setTimeout(() => controller.abort(), guardMs);

    try {
      const res = await tgFetch(url, { signal: controller.signal });
      const body = (await res.json()) as {
        ok: boolean;
        result?: TelegramUpdate[];
        description?: string;
        error_code?: number;
      };
      // Another poller has the token — rebuild sockets before the caller retries.
      if (res.status === 409 || body.error_code === 409) {
        await rebuildTelegramTransport();
        throw new Error(body.description ?? 'getUpdates conflict (409) — another poller may be running');
      }
      if (!res.ok || !body.ok || !body.result) {
        throw new Error(body.description ?? `getUpdates failed (HTTP ${res.status})`);
      }
      return body.result;
    } catch (error) {
      // Client-side abort after a quiet long-poll window → treat as empty, not fatal.
      if (isAbortError(error) && controller.signal.aborted) {
        return [];
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.pollController === controller) this.pollController = undefined;
    }
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const res = await fetchWithRetry(
      this.url('sendMessage'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
      30_000,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendMessage failed: ${res.status} ${body}`);
    }
  }

  /**
   * Register slash commands so Telegram clients show `/` autocomplete suggestions.
   * @see https://core.telegram.org/bots/api#setmycommands
   */
  async setMyCommands(
    commands: ReadonlyArray<{ command: string; description: string }>,
  ): Promise<void> {
    const res = await fetchWithRetry(
      this.url('setMyCommands'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands }),
      },
      15_000,
    );
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !body.ok) {
      throw new Error(body.description ?? `setMyCommands failed (HTTP ${res.status})`);
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENETUNREACH') return true;
  const cause = error.cause;
  if (cause instanceof Error) {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (causeCode === 'ETIMEDOUT' || causeCode === 'ECONNRESET' || causeCode === 'ENETUNREACH') {
      return true;
    }
    if (cause.name === 'AggregateError') return true;
  }
  if (error.message.includes('ETIMEDOUT') || error.message.includes('fetch failed')) {
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code?: string }).code === 'ETIMEDOUT';
    }
    return error.message.includes('ETIMEDOUT');
  }
  return false;
}

async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  ms: number,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(url, init, ms);
    } catch (error) {
      lastError = error;
      if (!isTimeoutError(error) || i === attempts - 1) throw error;
      await sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await tgFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
