import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import { expandHomePath } from '../telegram/config.js';

export const GCLOUD_CONFIG_FILE = 'gcloud.json';

export type GcloudConfig = {
  version: 1;
  projectId: string;
  /** Optional path to a service-account JSON key (ADC used when omitted). */
  credentialsPath?: string;
  /** Optional default Compute Engine zone (e.g. africa-south1-a). */
  defaultZone?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedGcloudConfig = {
  projectId: string;
  credentialsPath?: string;
  defaultZone?: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const gcloudConfigSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  credentialsPath: z.string().optional(),
  defaultZone: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function gcloudConfigPath(home = defaultHome()): string {
  return path.join(home, GCLOUD_CONFIG_FILE);
}

function readConfigFile(filePath: string): GcloudConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid gcloud config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = gcloudConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid gcloud config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function readGcloudConfig(home = defaultHome()): GcloudConfig | null {
  const filePath = gcloudConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeGcloudConfig(
  config: Omit<GcloudConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): GcloudConfig {
  const existing = readGcloudConfig(home);
  const now = new Date().toISOString();
  const next: GcloudConfig = {
    version: 1,
    projectId: config.projectId.trim(),
    credentialsPath: config.credentialsPath?.trim() || existing?.credentialsPath,
    defaultZone: config.defaultZone?.trim() || existing?.defaultZone,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  if (config.credentialsPath === '') delete next.credentialsPath;
  if (config.defaultZone === '') delete next.defaultZone;
  if (next.credentialsPath) {
    next.credentialsPath = expandHomePath(next.credentialsPath);
  }
  writeFileAtomic(gcloudConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

/** Redact a filesystem path for status output (keep basename). */
export function redactPath(filePath: string): string {
  const base = path.basename(filePath);
  const dir = path.dirname(filePath);
  if (!dir || dir === '.' || dir === '/') return base;
  return `${path.basename(dir)}/…/${base}`;
}

export function resolveGcloudConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedGcloudConfig | undefined {
  const file = readGcloudConfig(home);
  const envProject =
    env.GCLOUD_PROJECT?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || '';
  const envCreds = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || '';

  const projectId = envProject || file?.projectId;
  if (!projectId) return undefined;

  let source: ResolvedGcloudConfig['source'] = 'file';
  if (envProject || envCreds) {
    source = file ? 'mixed' : 'env';
  }

  const credentialsRaw = envCreds || file?.credentialsPath;
  return {
    projectId,
    credentialsPath: credentialsRaw ? expandHomePath(credentialsRaw) : undefined,
    defaultZone: file?.defaultZone,
    configPath: gcloudConfigPath(home),
    source,
  };
}
