import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

export const POSTHOG_CONFIG_FILE = 'posthog.json';
export const DEFAULT_POSTHOG_HOST = 'https://app.posthog.com';

export type PostHogConfig = {
  version: 1;
  host: string;
  apiKey: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedPostHogConfig = {
  host: string;
  apiKey: string;
  projectId: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const posthogConfigSchema = z.object({
  version: z.literal(1),
  host: z.string().min(1),
  apiKey: z.string().min(1),
  projectId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Normalize to origin only (https://us.posthog.com). */
export function normalizePostHogHost(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('PostHog host is required.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid PostHog host: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid PostHog host protocol: ${url.protocol}`);
  }
  return url.origin;
}

export function posthogConfigPath(home = defaultHome()): string {
  return path.join(home, POSTHOG_CONFIG_FILE);
}

function readConfigFile(filePath: string): PostHogConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid posthog config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = posthogConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid posthog config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return {
    ...parsed.data,
    host: normalizePostHogHost(parsed.data.host),
    projectId: String(parsed.data.projectId).trim(),
  };
}

export function readPostHogConfig(home = defaultHome()): PostHogConfig | null {
  const filePath = posthogConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writePostHogConfig(
  config: Omit<PostHogConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): PostHogConfig {
  const existing = readPostHogConfig(home);
  const now = new Date().toISOString();
  const next: PostHogConfig = {
    version: 1,
    host: normalizePostHogHost(config.host || existing?.host || DEFAULT_POSTHOG_HOST),
    apiKey: config.apiKey.trim(),
    projectId: String(config.projectId).trim(),
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  writeFileAtomic(posthogConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/**
 * Resolve PostHog credentials from disk + env.
 * Returns undefined when apiKey or projectId are incomplete.
 */
export function resolvePostHogConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedPostHogConfig | undefined {
  const file = readPostHogConfig(home);
  const envHost = env.POSTHOG_HOST?.trim();
  const envKey =
    env.POSTHOG_API_KEY?.trim() || env.POSTHOG_PERSONAL_API_KEY?.trim();
  const envProject = env.POSTHOG_PROJECT_ID?.trim();

  const hostRaw = envHost || file?.host || DEFAULT_POSTHOG_HOST;
  const apiKey = envKey || file?.apiKey;
  const projectId = envProject || file?.projectId;

  if (!apiKey || !projectId) {
    return undefined;
  }

  let source: ResolvedPostHogConfig['source'] = 'file';
  if (envHost || envKey || envProject) {
    source = file ? 'mixed' : 'env';
  }

  return {
    host: normalizePostHogHost(hostRaw),
    apiKey,
    projectId,
    configPath: posthogConfigPath(home),
    source,
  };
}
