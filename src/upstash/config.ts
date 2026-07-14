import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

export const UPSTASH_CONFIG_FILE = 'upstash.json';

export type UpstashConfig = {
  version: 1;
  restUrl: string;
  token: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedUpstashConfig = {
  restUrl: string;
  token: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const upstashConfigSchema = z.object({
  version: z.literal(1),
  restUrl: z.string().min(1),
  token: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Normalize Upstash REST URL to origin (no trailing slash / path). */
export function normalizeUpstashRestUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Upstash REST URL is required.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid Upstash REST URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid Upstash REST URL protocol: ${url.protocol}`);
  }
  return url.origin;
}

export function upstashConfigPath(home = defaultHome()): string {
  return path.join(home, UPSTASH_CONFIG_FILE);
}

function readConfigFile(filePath: string): UpstashConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid upstash config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = upstashConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid upstash config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return {
    ...parsed.data,
    restUrl: normalizeUpstashRestUrl(parsed.data.restUrl),
  };
}

export function readUpstashConfig(home = defaultHome()): UpstashConfig | null {
  const filePath = upstashConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeUpstashConfig(
  config: Omit<UpstashConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): UpstashConfig {
  const existing = readUpstashConfig(home);
  const now = new Date().toISOString();
  const next: UpstashConfig = {
    version: 1,
    restUrl: normalizeUpstashRestUrl(config.restUrl),
    token: config.token.trim(),
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  writeFileAtomic(upstashConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function resolveUpstashConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedUpstashConfig | undefined {
  const file = readUpstashConfig(home);
  const envUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const envToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();

  const restUrlRaw = envUrl || file?.restUrl;
  const token = envToken || file?.token;
  if (!restUrlRaw || !token) return undefined;

  let source: ResolvedUpstashConfig['source'] = 'file';
  if (envUrl || envToken) {
    source = file ? 'mixed' : 'env';
  }

  return {
    restUrl: normalizeUpstashRestUrl(restUrlRaw),
    token,
    configPath: upstashConfigPath(home),
    source,
  };
}
