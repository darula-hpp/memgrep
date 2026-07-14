import type { UpstashClient } from './client.js';

/**
 * Shared Upstash Redis business logic for MCP and CLI.
 */
export class UpstashService {
  constructor(private readonly client: UpstashClient) {}

  async verify(): Promise<{ pong: string; restUrl: string; dbsize: number }> {
    const pong = await this.client.ping();
    const dbsize = await this.client.dbsize();
    return { pong, restUrl: this.client.restUrl, dbsize };
  }

  async get(key: string): Promise<string | null> {
    const k = key.trim();
    if (!k) throw new Error('key is required.');
    return this.client.get(k);
  }

  async set(key: string, value: string, exSeconds?: number): Promise<string> {
    const k = key.trim();
    if (!k) throw new Error('key is required.');
    if (exSeconds !== undefined && (!Number.isFinite(exSeconds) || exSeconds <= 0)) {
      throw new Error('exSeconds must be a positive number when set.');
    }
    return this.client.set(k, value, exSeconds);
  }

  async del(keys: string[]): Promise<number> {
    const cleaned = keys.map((k) => k.trim()).filter(Boolean);
    if (cleaned.length === 0) throw new Error('At least one key is required.');
    return this.client.del(...cleaned);
  }

  async dbsize(): Promise<number> {
    return this.client.dbsize();
  }

  async ttl(key: string): Promise<number> {
    const k = key.trim();
    if (!k) throw new Error('key is required.');
    return this.client.ttl(k);
  }

  async type(key: string): Promise<string> {
    const k = key.trim();
    if (!k) throw new Error('key is required.');
    return this.client.type(k);
  }

  async scan(input: {
    cursor?: string;
    match?: string;
    count?: number;
  } = {}): Promise<{ cursor: string; keys: string[] }> {
    const count = input.count ?? 50;
    if (count < 1 || count > 500) {
      throw new Error('count must be between 1 and 500.');
    }
    return this.client.scan({
      cursor: input.cursor?.trim() || '0',
      match: input.match?.trim() || undefined,
      count,
    });
  }

  formatGet(key: string, value: string | null): string {
    if (value === null) return `(nil) key=${key}`;
    return `key=${key}\n${value}`;
  }

  formatScan(result: { cursor: string; keys: string[] }): string {
    const lines = [
      `cursor=${result.cursor}`,
      `keys=${result.keys.length}`,
      ...(result.keys.length ? result.keys.map((k) => `  ${k}`) : ['  (none)']),
    ];
    return lines.join('\n');
  }

  formatTtl(key: string, ttl: number): string {
    if (ttl === -2) return `key=${key} ttl=-2 (does not exist)`;
    if (ttl === -1) return `key=${key} ttl=-1 (no expiry)`;
    return `key=${key} ttl=${ttl}s`;
  }
}
