import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_TELEGRAM_PROFILE,
  expandHomePath,
  normalizeWorkspaces,
  readTelegramConfig,
  sanitizeTelegramProfile,
  type TelegramWorkspace,
} from '../telegram/config.js';
import { DEFAULT_AGENT_RUN_MODE, isAgentRunMode, type AgentRunMode } from './mode.js';

export const CURSOR_CONFIG_FILE = 'cursor.json';

export type CursorWorkspace = TelegramWorkspace;

export type CursorConfig = {
  version: 1;
  cursorApiKey?: string;
  cwd?: string;
  workspaces?: CursorWorkspace[];
  model?: string;
  agentMode?: string;
  /** Optional Telegram profile to import key/workspaces from. */
  telegramProfile?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedCursorConfig = {
  apiKey: string;
  cwd: string;
  workspaces: CursorWorkspace[];
  model: string;
  agentMode: AgentRunMode;
  mcpUrl: string;
  mcpToken?: string;
  telegramProfile?: string;
  configPath: string;
  source: 'file' | 'env' | 'mixed' | 'telegram';
};

const workspaceSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

const cursorConfigSchema = z.object({
  version: z.literal(1),
  cursorApiKey: z.string().optional(),
  cwd: z.string().optional(),
  workspaces: z.array(workspaceSchema).optional(),
  model: z.string().optional(),
  agentMode: z.string().optional(),
  telegramProfile: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function cursorConfigPath(home = defaultHome()): string {
  return path.join(home, CURSOR_CONFIG_FILE);
}

function readConfigFile(filePath: string): CursorConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid cursor config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = cursorConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid cursor config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function readCursorConfig(home = defaultHome()): CursorConfig | null {
  const filePath = cursorConfigPath(home);
  if (!existsSync(filePath)) return null;
  return readConfigFile(filePath);
}

export function writeCursorConfig(
  config: Omit<CursorConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): CursorConfig {
  const existing = readCursorConfig(home);
  const now = new Date().toISOString();
  const cwd = config.cwd?.trim()
    ? expandHomePath(config.cwd)
    : existing?.cwd
      ? expandHomePath(existing.cwd)
      : undefined;
  const next: CursorConfig = {
    version: 1,
    cursorApiKey: config.cursorApiKey?.trim() || existing?.cursorApiKey,
    cwd,
    workspaces: normalizeWorkspaces(config.workspaces ?? existing?.workspaces, cwd),
    model: config.model?.trim() || existing?.model,
    agentMode: config.agentMode?.trim() || existing?.agentMode,
    telegramProfile: config.telegramProfile?.trim() || existing?.telegramProfile,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  writeFileAtomic(cursorConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/**
 * Resolve Cursor API key + workspace allowlist for MCP/CLI.
 * Prefers ~/.memgrep/cursor.json, then a Telegram profile file, then env.
 */
export function resolveCursorConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedCursorConfig | undefined {
  const file = readCursorConfig(home);
  const profileName = sanitizeTelegramProfile(
    env.MEMGREP_CURSOR_PROFILE?.trim() ||
      file?.telegramProfile ||
      env.MEMGREP_TELEGRAM_PROFILE?.trim() ||
      DEFAULT_TELEGRAM_PROFILE,
  );
  const telegram = readTelegramConfig(home, profileName);

  const envKey = env.CURSOR_API_KEY?.trim();
  const apiKey = envKey || file?.cursorApiKey || telegram?.cursorApiKey;
  if (!apiKey) return undefined;

  const cwdRaw =
    env.MEMGREP_CURSOR_CWD?.trim() ||
    env.MEMGREP_TELEGRAM_CWD?.trim() ||
    file?.cwd ||
    telegram?.cwd ||
    process.cwd();
  const cwd = expandHomePath(cwdRaw);

  const workspaces = normalizeWorkspaces(
    file?.workspaces?.length ? file.workspaces : telegram?.workspaces,
    cwd,
  );

  const model =
    env.MEMGREP_CURSOR_MODEL?.trim() ||
    env.MEMGREP_TELEGRAM_MODEL?.trim() ||
    file?.model ||
    telegram?.model ||
    DEFAULT_CURSOR_MODEL;

  const modeRaw = file?.agentMode?.trim() || telegram?.agentMode?.trim() || DEFAULT_AGENT_RUN_MODE;
  const agentMode = isAgentRunMode(modeRaw) ? modeRaw : DEFAULT_AGENT_RUN_MODE;

  let source: ResolvedCursorConfig['source'] = 'file';
  if (envKey || env.MEMGREP_CURSOR_CWD || env.MEMGREP_CURSOR_MODEL) {
    source = file || telegram ? 'mixed' : 'env';
  } else if (!file && telegram) {
    source = 'telegram';
  }

  return {
    apiKey,
    cwd,
    workspaces,
    model,
    agentMode,
    mcpUrl: (env.MEMGREP_MCP_URL ?? 'http://127.0.0.1:3921/mcp').replace(/\/$/, ''),
    mcpToken: env.MEMGREP_MCP_TOKEN,
    telegramProfile: telegram ? profileName : file?.telegramProfile,
    configPath: file ? cursorConfigPath(home) : telegram
      ? path.join(home, 'telegram', `${profileName}.json`)
      : cursorConfigPath(home),
    source,
  };
}
