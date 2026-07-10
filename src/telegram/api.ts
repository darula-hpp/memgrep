import type { TelegramUpdate } from './types.js';

const TG_API = 'https://api.telegram.org';

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
  constructor(private readonly botToken: string) {}

  private url(method: string): URL {
    return telegramMethodUrl(this.botToken, method);
  }

  async getMe(): Promise<TelegramBotInfo> {
    const res = await fetch(this.url('getMe'), { signal: AbortSignal.timeout(15_000) });
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
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    const body = (await res.json()) as {
      ok: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    if (!res.ok || !body.ok || !body.result) {
      throw new Error(body.description ?? `getUpdates failed (HTTP ${res.status})`);
    }
    return body.result;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const res = await fetch(this.url('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendMessage failed: ${res.status} ${body}`);
    }
  }
}
