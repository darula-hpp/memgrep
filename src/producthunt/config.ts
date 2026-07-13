import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

export const PRODUCTHUNT_CONFIG_FILE = 'producthunt.json';
export const PRODUCTHUNT_GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';
export const PRODUCTHUNT_TOKEN_URL = 'https://api.producthunt.com/v2/oauth/token';

export type ProductHuntConfig = {
  version: 1;
  /** Developer token or any Bearer access token. */
  token?: string;
  /** OAuth application API key (client_id). */
  apiKey?: string;
  /** OAuth application API secret (client_secret). */
  apiSecret?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedProductHuntConfig = {
  token: string;
  apiKey?: string;
  apiSecret?: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const productHuntConfigSchema = z.object({
  version: z.literal(1),
  token: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function productHuntConfigPath(home = defaultHome()): string {
  return path.join(home, PRODUCTHUNT_CONFIG_FILE);
}

function readConfigFile(filePath: string): ProductHuntConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid producthunt config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = productHuntConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid producthunt config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function readProductHuntConfig(home = defaultHome()): ProductHuntConfig | null {
  const filePath = productHuntConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeProductHuntConfig(
  config: Omit<ProductHuntConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): ProductHuntConfig {
  const existing = readProductHuntConfig(home);
  const now = new Date().toISOString();
  const next: ProductHuntConfig = {
    version: 1,
    token: config.token?.trim() || existing?.token,
    apiKey: config.apiKey?.trim() || existing?.apiKey,
    apiSecret: config.apiSecret?.trim() || existing?.apiSecret,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  if (config.token === '') delete next.token;
  if (config.apiKey === '') delete next.apiKey;
  if (config.apiSecret === '') delete next.apiSecret;
  writeFileAtomic(productHuntConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** Exchange API key/secret for a client-credentials access token. */
export async function fetchClientCredentialsToken(
  apiKey: string,
  apiSecret: string,
): Promise<string> {
  const res = await fetch(PRODUCTHUNT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'error_description' in parsed
        ? String((parsed as { error_description: unknown }).error_description)
        : typeof parsed === 'string'
          ? parsed
          : res.statusText;
    throw new Error(`Product Hunt token request failed (HTTP ${res.status}): ${detail}`);
  }
  const token =
    parsed && typeof parsed === 'object' && 'access_token' in parsed
      ? String((parsed as { access_token: unknown }).access_token)
      : '';
  if (!token) {
    throw new Error('Product Hunt token response missing access_token.');
  }
  return token;
}

/**
 * Resolve a Bearer token from disk + env.
 * Prefers PRODUCTHUNT_TOKEN / developer token; falls back to api key+secret (caller may refresh).
 */
export function resolveProductHuntConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedProductHuntConfig | undefined {
  const file = readProductHuntConfig(home);
  const envToken =
    env.PRODUCTHUNT_TOKEN?.trim() ||
    env.PRODUCT_HUNT_TOKEN?.trim() ||
    env.PH_DEVELOPER_TOKEN?.trim();
  const envKey = env.PRODUCTHUNT_API_KEY?.trim() || env.PH_API_KEY?.trim();
  const envSecret = env.PRODUCTHUNT_API_SECRET?.trim() || env.PH_API_SECRET?.trim();

  const token = envToken || file?.token;
  const apiKey = envKey || file?.apiKey;
  const apiSecret = envSecret || file?.apiSecret;

  if (!token && !(apiKey && apiSecret)) {
    return undefined;
  }

  let source: ResolvedProductHuntConfig['source'] = 'file';
  if (envToken || envKey || envSecret) {
    source = file ? 'mixed' : 'env';
  }

  return {
    // Placeholder empty token when only key/secret — openProductHuntTools exchanges it.
    token: token ?? '',
    apiKey,
    apiSecret,
    configPath: productHuntConfigPath(home),
    source,
  };
}
