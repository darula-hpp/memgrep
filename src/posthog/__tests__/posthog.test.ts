import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePostHogHost,
  posthogConfigPath,
  resolvePostHogConfig,
  writePostHogConfig,
} from '../config.js';
import { PostHogService } from '../service.js';
import { PostHogTools } from '../tools.js';
import type { PostHogClient } from '../client.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-posthog-'));
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

describe('normalizePostHogHost', () => {
  it('normalizes to origin', () => {
    expect(normalizePostHogHost('https://app.posthog.com/')).toBe('https://app.posthog.com');
    expect(normalizePostHogHost('eu.posthog.com')).toBe('https://eu.posthog.com');
  });
});

describe('resolvePostHogConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolvePostHogConfig({}, home)).toBeUndefined();
  });

  it('reads from file', () => {
    const home = tempHome();
    writePostHogConfig(
      {
        host: 'https://us.posthog.com',
        apiKey: 'phx_abcdefghijklmnopqrstuvwxyz',
        projectId: '12345',
      },
      home,
    );
    const resolved = resolvePostHogConfig({}, home);
    expect(resolved).toMatchObject({
      host: 'https://us.posthog.com',
      projectId: '12345',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(posthogConfigPath(home));
  });

  it('lets env override file', () => {
    const home = tempHome();
    writePostHogConfig(
      {
        host: 'https://us.posthog.com',
        apiKey: 'phx_filekeyabcdefghijklmnop',
        projectId: '111',
      },
      home,
    );
    const resolved = resolvePostHogConfig(
      {
        POSTHOG_HOST: 'https://eu.posthog.com',
        POSTHOG_API_KEY: 'phx_envkeyabcdefghijklmnop',
        POSTHOG_PROJECT_ID: '999',
      },
      home,
    );
    expect(resolved).toMatchObject({
      host: 'https://eu.posthog.com',
      apiKey: 'phx_envkeyabcdefghijklmnop',
      projectId: '999',
      source: 'mixed',
    });
  });

  it('accepts POSTHOG_PERSONAL_API_KEY alias', () => {
    const home = tempHome();
    const resolved = resolvePostHogConfig(
      {
        POSTHOG_PERSONAL_API_KEY: 'phx_personalabcdefghijklmn',
        POSTHOG_PROJECT_ID: '42',
      },
      home,
    );
    expect(resolved?.apiKey).toBe('phx_personalabcdefghijklmn');
    expect(resolved?.source).toBe('env');
  });

  it('throws on corrupt config file', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(posthogConfigPath(home), '{not-json', 'utf8');
    expect(() => resolvePostHogConfig({}, home)).toThrow(/Invalid posthog config/);
  });
});

describe('PostHogTools', () => {
  function mockClient(overrides: Partial<PostHogClient> = {}): PostHogClient {
    return {
      projectId: '1',
      getProject: vi.fn(),
      query: vi.fn(),
      listFeatureFlags: vi.fn(),
      getFeatureFlag: vi.fn(),
      ...overrides,
    } as unknown as PostHogClient;
  }

  it('formats query results', async () => {
    const client = mockClient({
      query: vi.fn().mockResolvedValue({
        columns: ['event', 'count'],
        results: [
          ['$pageview', 10],
          ['click', 3],
        ],
      }),
    });
    const tools = new PostHogTools(new PostHogService(client));
    const result = await tools.query({ hogql: 'SELECT 1' });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('event\tcount');
    expect(result.text).toContain('$pageview\t10');
  });

  it('formats feature flags', async () => {
    const client = mockClient({
      listFeatureFlags: vi.fn().mockResolvedValue([
        { id: 1, key: 'new-checkout', name: 'Checkout', active: true },
      ]),
    });
    const tools = new PostHogTools(new PostHogService(client));
    const result = await tools.featureFlags();
    expect(result.text).toContain('ON  new-checkout');
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      getFeatureFlag: vi.fn().mockRejectedValue(new Error('Feature flag not found: nope')),
    });
    const tools = new PostHogTools(new PostHogService(client));
    const result = await tools.getFlag({ idOrKey: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
  });

  it('builds top_events HogQL via service', async () => {
    const query = vi.fn().mockResolvedValue({ columns: ['event', 'count'], results: [] });
    const client = mockClient({ query });
    const tools = new PostHogTools(new PostHogService(client));
    await tools.topEvents({ days: 3, limit: 5 });
    expect(query).toHaveBeenCalled();
    const hogql = String(query.mock.calls[0]?.[0] ?? '');
    expect(hogql).toMatch(/INTERVAL 3 DAY/);
    expect(hogql).toMatch(/LIMIT 5/);
  });
});
