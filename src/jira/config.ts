import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

export const JIRA_CONFIG_FILE = 'jira.json';

export type JiraConfig = {
  version: 1;
  host: string;
  email: string;
  apiToken: string;
  defaultProject?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedJiraConfig = {
  host: string;
  email: string;
  apiToken: string;
  defaultProject?: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

const jiraConfigSchema = z.object({
  version: z.literal(1),
  host: z.string().min(1),
  email: z.string().min(1),
  apiToken: z.string().min(1),
  defaultProject: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Normalize to origin only (https://example.atlassian.net). */
export function normalizeJiraHost(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Jira host is required.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid Jira host: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid Jira host protocol: ${url.protocol}`);
  }
  return url.origin;
}

export function jiraConfigPath(home = defaultHome()): string {
  return path.join(home, JIRA_CONFIG_FILE);
}

function readConfigFile(filePath: string): JiraConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid jira config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = jiraConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid jira config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return {
    ...parsed.data,
    host: normalizeJiraHost(parsed.data.host),
  };
}

export function readJiraConfig(home = defaultHome()): JiraConfig | null {
  const filePath = jiraConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeJiraConfig(
  config: Omit<JiraConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): JiraConfig {
  const existing = readJiraConfig(home);
  const now = new Date().toISOString();
  const next: JiraConfig = {
    version: 1,
    host: normalizeJiraHost(config.host),
    email: config.email.trim(),
    apiToken: config.apiToken.trim(),
    defaultProject: config.defaultProject?.trim() || existing?.defaultProject,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  if (config.defaultProject === '') delete next.defaultProject;
  writeFileAtomic(jiraConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/**
 * Resolve Jira credentials from disk + env.
 * Returns undefined when host/email/token are incomplete.
 */
export function resolveJiraConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedJiraConfig | undefined {
  const file = readJiraConfig(home);
  const envHost = env.JIRA_HOST?.trim();
  const envEmail = env.JIRA_EMAIL?.trim();
  const envToken = env.JIRA_API_TOKEN?.trim();

  const hostRaw = envHost || file?.host;
  const email = envEmail || file?.email;
  const apiToken = envToken || file?.apiToken;

  if (!hostRaw || !email || !apiToken) {
    return undefined;
  }

  let source: ResolvedJiraConfig['source'] = 'file';
  if (envHost || envEmail || envToken) {
    source = file ? 'mixed' : 'env';
  }

  return {
    host: normalizeJiraHost(hostRaw),
    email,
    apiToken,
    defaultProject: env.JIRA_DEFAULT_PROJECT?.trim() || file?.defaultProject,
    configPath: jiraConfigPath(home),
    source,
  };
}
