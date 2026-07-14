import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

export const NEON_CONFIG_FILE = 'neon.json';
export const NEON_API_BASE = 'https://console.neon.tech/api/v2';

export type NeonConfig = {
  version: 1;
  apiKey: string;
  /** Optional default project id for branch/connection tools. */
  defaultProjectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedNeonConfig = {
  apiKey: string;
  defaultProjectId?: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const neonConfigSchema = z.object({
  version: z.literal(1),
  apiKey: z.string().min(1),
  defaultProjectId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function neonConfigPath(home = defaultHome()): string {
  return path.join(home, NEON_CONFIG_FILE);
}

function readConfigFile(filePath: string): NeonConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid neon config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = neonConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid neon config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function readNeonConfig(home = defaultHome()): NeonConfig | null {
  const filePath = neonConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeNeonConfig(
  config: Omit<NeonConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): NeonConfig {
  const existing = readNeonConfig(home);
  const now = new Date().toISOString();
  const next: NeonConfig = {
    version: 1,
    apiKey: config.apiKey.trim(),
    defaultProjectId: config.defaultProjectId?.trim() || existing?.defaultProjectId,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  if (config.defaultProjectId === '') delete next.defaultProjectId;
  writeFileAtomic(neonConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function resolveNeonConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedNeonConfig | undefined {
  const file = readNeonConfig(home);
  const envKey = env.NEON_API_KEY?.trim();
  const envProject = env.NEON_PROJECT_ID?.trim() || env.NEON_DEFAULT_PROJECT_ID?.trim();

  const apiKey = envKey || file?.apiKey;
  if (!apiKey) return undefined;

  let source: ResolvedNeonConfig['source'] = 'file';
  if (envKey || envProject) {
    source = file ? 'mixed' : 'env';
  }

  return {
    apiKey,
    defaultProjectId: envProject || file?.defaultProjectId,
    configPath: neonConfigPath(home),
    source,
  };
}
