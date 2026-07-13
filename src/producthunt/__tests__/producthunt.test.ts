import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  productHuntConfigPath,
  resolveProductHuntConfig,
  writeProductHuntConfig,
} from '../config.js';
import { summarizePost } from '../client.js';
import { ProductHuntService } from '../service.js';
import { ProductHuntTools } from '../tools.js';
import type { ProductHuntClient, ProductHuntPost } from '../client.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-ph-'));
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

describe('resolveProductHuntConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolveProductHuntConfig({}, home)).toBeUndefined();
  });

  it('reads token from file', () => {
    const home = tempHome();
    writeProductHuntConfig({ token: 'token-abcdefghijklmnopqrstuvwxyz' }, home);
    const resolved = resolveProductHuntConfig({}, home);
    expect(resolved).toMatchObject({
      token: 'token-abcdefghijklmnopqrstuvwxyz',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(productHuntConfigPath(home));
  });

  it('lets env token override file', () => {
    const home = tempHome();
    writeProductHuntConfig({ token: 'file-token-abcdefghijklmnop' }, home);
    const resolved = resolveProductHuntConfig(
      { PRODUCTHUNT_TOKEN: 'env-token-abcdefghijklmnopqr' },
      home,
    );
    expect(resolved).toMatchObject({
      token: 'env-token-abcdefghijklmnopqr',
      source: 'mixed',
    });
  });

  it('accepts api key+secret without token', () => {
    const home = tempHome();
    const resolved = resolveProductHuntConfig(
      {
        PRODUCTHUNT_API_KEY: 'key-abcdefghijklmnopqrst',
        PRODUCTHUNT_API_SECRET: 'secret-abcdefghijklmnop',
      },
      home,
    );
    expect(resolved?.token).toBe('');
    expect(resolved?.apiKey).toBe('key-abcdefghijklmnopqrst');
    expect(resolved?.source).toBe('env');
  });

  it('throws on corrupt config file', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(productHuntConfigPath(home), '{not-json', 'utf8');
    expect(() => resolveProductHuntConfig({}, home)).toThrow(/Invalid producthunt config/);
  });
});

describe('summarizePost', () => {
  it('maps GraphQL node fields', () => {
    expect(
      summarizePost({
        id: '1',
        name: 'Notion',
        tagline: 'Notes',
        slug: 'notion',
        url: 'https://www.producthunt.com/posts/notion',
        votesCount: 10,
        commentsCount: 2,
      }),
    ).toMatchObject({
      id: '1',
      name: 'Notion',
      slug: 'notion',
      votesCount: 10,
    });
  });
});

describe('ProductHuntTools', () => {
  function mockClient(overrides: Partial<ProductHuntClient> = {}): ProductHuntClient {
    return {
      verify: vi.fn(),
      today: vi.fn(),
      recent: vi.fn(),
      getPost: vi.fn(),
      comments: vi.fn(),
      graphql: vi.fn(),
      ...overrides,
    } as unknown as ProductHuntClient;
  }

  const sample: ProductHuntPost = {
    id: '1',
    name: 'Notion',
    tagline: 'All-in-one workspace',
    slug: 'notion',
    url: 'https://www.producthunt.com/posts/notion',
    votesCount: 100,
    commentsCount: 12,
  };

  it('formats today results', async () => {
    const client = mockClient({ today: vi.fn().mockResolvedValue([sample]) });
    const tools = new ProductHuntTools(new ProductHuntService(client));
    const result = await tools.today({ limit: 5 });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('Notion');
    expect(result.text).toContain('100▲');
  });

  it('filters search by substring', async () => {
    const client = mockClient({
      recent: vi.fn().mockResolvedValue([
        sample,
        {
          ...sample,
          id: '2',
          name: 'Linear',
          tagline: 'Issue tracking',
          slug: 'linear',
        },
      ]),
    });
    const tools = new ProductHuntTools(new ProductHuntService(client));
    const result = await tools.search({ query: 'notion' });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('Notion');
    expect(result.text).not.toContain('Linear');
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      getPost: vi.fn().mockRejectedValue(new Error('Product Hunt post not found: nope')),
    });
    const tools = new ProductHuntTools(new ProductHuntService(client));
    const result = await tools.getPost({ idOrSlug: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
  });
});
