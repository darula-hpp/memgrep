import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeUpstashRestUrl,
  resolveUpstashConfig,
  upstashConfigPath,
  writeUpstashConfig,
} from '../config.js';
import { UpstashService } from '../service.js';
import { UpstashTools } from '../tools.js';
import type { UpstashClient } from '../client.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-upstash-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('normalizeUpstashRestUrl', () => {
  it('strips path and trailing slash', () => {
    expect(normalizeUpstashRestUrl('https://example.upstash.io/')).toBe(
      'https://example.upstash.io',
    );
  });
});

describe('resolveUpstashConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolveUpstashConfig({}, home)).toBeUndefined();
  });

  it('reads from file', () => {
    const home = tempHome();
    writeUpstashConfig(
      {
        restUrl: 'https://example.upstash.io',
        token: 'upstash_token_abcdefghijklmnop',
      },
      home,
    );
    const resolved = resolveUpstashConfig({}, home);
    expect(resolved).toMatchObject({
      restUrl: 'https://example.upstash.io',
      token: 'upstash_token_abcdefghijklmnop',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(upstashConfigPath(home));
  });

  it('lets env override file', () => {
    const home = tempHome();
    writeUpstashConfig(
      { restUrl: 'https://file.upstash.io', token: 'file_token_abcdefghijklmnop' },
      home,
    );
    const resolved = resolveUpstashConfig(
      {
        UPSTASH_REDIS_REST_URL: 'https://env.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'env_token_abcdefghijklmnop',
      },
      home,
    );
    expect(resolved).toMatchObject({
      restUrl: 'https://env.upstash.io',
      token: 'env_token_abcdefghijklmnop',
      source: 'mixed',
    });
  });

  it('throws on corrupt config', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(upstashConfigPath(home), '{bad', 'utf8');
    expect(() => resolveUpstashConfig({}, home)).toThrow(/Invalid upstash config/);
  });
});

describe('UpstashTools', () => {
  function mockClient(overrides: Partial<UpstashClient> = {}): UpstashClient {
    return {
      restUrl: 'https://example.upstash.io',
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      dbsize: vi.fn().mockResolvedValue(3),
      ttl: vi.fn(),
      type: vi.fn(),
      scan: vi.fn(),
      command: vi.fn(),
      ...overrides,
    } as unknown as UpstashClient;
  }

  it('formats get nil and value', async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('hello'),
    });
    const tools = new UpstashTools(new UpstashService(client));
    const missing = await tools.get({ key: 'k' });
    expect(missing.text).toContain('(nil)');
    const hit = await tools.get({ key: 'k' });
    expect(hit.text).toContain('hello');
  });

  it('set with expiry', async () => {
    const client = mockClient({
      set: vi.fn().mockResolvedValue('OK'),
    });
    const tools = new UpstashTools(new UpstashService(client));
    const result = await tools.set({ key: 'k', value: 'v', exSeconds: 60 });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('EX 60');
    expect(client.set).toHaveBeenCalledWith('k', 'v', 60);
  });

  it('formats scan', async () => {
    const client = mockClient({
      scan: vi.fn().mockResolvedValue({ cursor: '12', keys: ['a', 'b'] }),
    });
    const tools = new UpstashTools(new UpstashService(client));
    const result = await tools.scan({ match: 'a*' });
    expect(result.text).toContain('cursor=12');
    expect(result.text).toContain('a');
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      get: vi.fn().mockRejectedValue(new Error('Upstash Redis GET failed (HTTP 401): unauthorized')),
    });
    const tools = new UpstashTools(new UpstashService(client));
    const result = await tools.get({ key: 'x' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/401/);
  });

  it('formats ttl states', () => {
    const service = new UpstashService(mockClient());
    expect(service.formatTtl('k', -2)).toMatch(/does not exist/);
    expect(service.formatTtl('k', -1)).toMatch(/no expiry/);
    expect(service.formatTtl('k', 42)).toBe('key=k ttl=42s');
  });
});
