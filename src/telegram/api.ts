import dns from 'node:dns';
import type { TelegramUpdate } from './types.js';
import { isAbortError } from './errors.js';

const TG_API = 'https://api.telegram.org';

// Node often tries IPv6 first; many networks time out on Telegram AAAA records.
dns.setDefaultResultOrder('ipv4first');

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

  /** Abort an in-flight long poll (used on shutdown). */
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

  async getUpdates(offset = 0, timeout = 30): Promise<TelegramUpdate[]> {
    const url = this.url('getUpdates');
    url.searchParams.set('timeout', String(timeout));
    url.searchParams.set('offset', String(offset));

    this.abortPoll();
    const controller = new AbortController();
    this.pollController = controller;
    const timer = setTimeout(() => controller.abort(), (timeout + 10) * 1000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = (await res.json()) as {
        ok: boolean;
        result?: TelegramUpdate[];
        description?: string;
      };
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
    // AggregateError often wraps ETIMEDOUT with an empty message on the cause.
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code?: string }).code === 'ETIMEDOUT';
    }
    // "fetch failed — AggregateError — ETIMEDOUT" style after formatting
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
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
