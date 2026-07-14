import type { ResolvedUpstashConfig } from './config.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Thin Upstash Redis REST client (Bearer token + JSON command array body).
 * @see https://upstash.com/docs/redis/features/restapi
 */
export class UpstashClient {
  constructor(private readonly config: ResolvedUpstashConfig) {}

  get restUrl(): string {
    return this.config.restUrl;
  }

  /**
   * Run a Redis command via REST. Args are Redis protocol args (command first).
   */
  async command<T = unknown>(args: Array<string | number>): Promise<T> {
    if (args.length === 0) {
      throw new Error('Redis command is required.');
    }

    const res = await fetch(this.config.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args.map(String)),
    });

    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    const rec = asRecord(parsed);
    if (!res.ok || typeof rec.error === 'string') {
      const message =
        (typeof rec.error === 'string' && rec.error) ||
        (typeof parsed === 'string' ? parsed : '') ||
        res.statusText;
      throw new Error(
        `Upstash Redis ${String(args[0])} failed (HTTP ${res.status}): ${message}`,
      );
    }

    return rec.result as T;
  }

  async ping(): Promise<string> {
    const result = await this.command<string>(['PING']);
    return result ?? 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.command<string | null>(['GET', key]);
  }

  async set(key: string, value: string, exSeconds?: number): Promise<string> {
    if (exSeconds !== undefined && exSeconds > 0) {
      return this.command<string>(['SET', key, value, 'EX', exSeconds]);
    }
    return this.command<string>(['SET', key, value]);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.command<number>(['DEL', ...keys]);
  }

  async dbsize(): Promise<number> {
    return this.command<number>(['DBSIZE']);
  }

  async ttl(key: string): Promise<number> {
    return this.command<number>(['TTL', key]);
  }

  async type(key: string): Promise<string> {
    return this.command<string>(['TYPE', key]);
  }

  /**
   * SCAN cursor [MATCH pattern] [COUNT count]
   * Returns [nextCursor, keys].
   */
  async scan(input: {
    cursor?: string;
    match?: string;
    count?: number;
  } = {}): Promise<{ cursor: string; keys: string[] }> {
    const args: Array<string | number> = ['SCAN', input.cursor ?? '0'];
    if (input.match) {
      args.push('MATCH', input.match);
    }
    if (input.count !== undefined) {
      args.push('COUNT', input.count);
    }
    const result = await this.command<[string, string[]]>(args);
    const cursor = Array.isArray(result) ? String(result[0] ?? '0') : '0';
    const keys = Array.isArray(result) && Array.isArray(result[1]) ? result[1].map(String) : [];
    return { cursor, keys };
  }
}
