import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { defaultHome } from '../memory/store.js';

export const TELEGRAM_CONFIG_FILE = 'telegram.json';
export const DEFAULT_CURSOR_MODEL = 'composer-2.5';

export type TelegramWorkspace = {
  name: string;
  path: string;
};

export type TelegramConfig = {
  version: 1;
  botToken: string;
  allowedUserIds: number[];
  botUsername?: string;
  /** Cursor user/service API key for local SDK agents. */
  cursorApiKey?: string;
  /** Working directory for the local Cursor agent. */
  cwd?: string;
  /** Named workspaces switchable via /ws from Telegram. */
  workspaces?: TelegramWorkspace[];
  /** Model id, e.g. composer-2.5 */
  model?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedTelegramConfig = {
  botToken: string;
  allowedUserIds: ReadonlySet<number>;
  botUsername?: string;
  cursorApiKey?: string;
  cwd: string;
  workspaces: TelegramWorkspace[];
  model: string;
  mcpUrl: string;
  mcpToken?: string;
  /** Where the on-disk config lives (if any). */
  configPath: string;
  source: 'file' | 'env' | 'mixed';
};

export function telegramConfigPath(home = defaultHome()): string {
  return path.join(home, TELEGRAM_CONFIG_FILE);
}

export function expandHomePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return path.join(homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

export function workspaceNameFromPath(dir: string): string {
  const base = path.basename(expandHomePath(dir));
  return base || 'workspace';
}

export function normalizeWorkspaces(
  workspaces: TelegramWorkspace[] | undefined,
  cwd?: string,
): TelegramWorkspace[] {
  const byName = new Map<string, TelegramWorkspace>();
  for (const ws of workspaces ?? []) {
    if (!ws?.name?.trim() || !ws?.path?.trim()) continue;
    const name = ws.name.trim();
    const resolved = expandHomePath(ws.path);
    byName.set(name.toLowerCase(), { name, path: resolved });
  }
  if (cwd) {
    const resolved = expandHomePath(cwd);
    const already = [...byName.values()].some((w) => w.path === resolved);
    if (!already) {
      let name = workspaceNameFromPath(resolved);
      const key = name.toLowerCase();
      if (byName.has(key) && byName.get(key)!.path !== resolved) {
        name = `${name}-${byName.size + 1}`;
      }
      byName.set(name.toLowerCase(), { name, path: resolved });
    }
  }
  return [...byName.values()];
}

/** Resolve /ws ref: 1-based index, name, or filesystem path. */
export function resolveWorkspaceRef(
  ref: string,
  workspaces: TelegramWorkspace[],
): TelegramWorkspace | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed) - 1;
    return workspaces[idx] ?? null;
  }

  const byName = workspaces.find((w) => w.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName;

  const resolved = expandHomePath(trimmed);
  const byPath = workspaces.find((w) => w.path === resolved);
  if (byPath) return byPath;
  if (existsSync(resolved)) {
    return { name: workspaceNameFromPath(resolved), path: resolved };
  }
  return null;
}

export function formatWorkspaceList(workspaces: TelegramWorkspace[], currentCwd: string): string {
  if (workspaces.length === 0) {
    return 'No workspaces yet. Add one:\n  /ws add <name> <path>';
  }
  const lines = workspaces.map((ws, i) => {
    const mark = ws.path === currentCwd ? ' *' : '';
    return `${i + 1}. ${ws.name}${mark}\n   ${ws.path}`;
  });
  return `Workspaces (* = current):\n\n${lines.join('\n\n')}\n\nSwitch: /ws <number|name>`;
}

export function readTelegramConfig(home = defaultHome()): TelegramConfig | null {
  const filePath = telegramConfigPath(home);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as TelegramConfig;
  if (raw.version !== 1 || typeof raw.botToken !== 'string' || !Array.isArray(raw.allowedUserIds)) {
    throw new Error(`Invalid telegram config at ${filePath}`);
  }
  return raw;
}

export function writeTelegramConfig(
  config: Omit<TelegramConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
): TelegramConfig {
  mkdirSync(home, { recursive: true });
  const existing = readTelegramConfig(home);
  const now = new Date().toISOString();
  const cwd = config.cwd ?? existing?.cwd;
  const workspaces = normalizeWorkspaces(
    config.workspaces ?? existing?.workspaces,
    cwd,
  );
  const next: TelegramConfig = {
    version: 1,
    botToken: config.botToken,
    allowedUserIds: [...new Set(config.allowedUserIds)].filter((n) => Number.isInteger(n) && n > 0),
    botUsername: config.botUsername ?? existing?.botUsername,
    cursorApiKey: config.cursorApiKey ?? existing?.cursorApiKey,
    cwd,
    workspaces,
    model: config.model ?? existing?.model,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
  // Allow explicit clears via empty string → omit
  if (config.cursorApiKey === '') delete next.cursorApiKey;
  writeFileSync(telegramConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export function updateTelegramConfig(
  patch: Partial<
    Pick<
      TelegramConfig,
      'cursorApiKey' | 'cwd' | 'model' | 'botToken' | 'allowedUserIds' | 'botUsername' | 'workspaces'
    >
  >,
  home = defaultHome(),
): TelegramConfig {
  const existing = readTelegramConfig(home);
  if (!existing) {
    throw new Error(`No telegram config at ${telegramConfigPath(home)}. Run: memgrep telegram setup`);
  }
  return writeTelegramConfig(
    {
      botToken: patch.botToken ?? existing.botToken,
      allowedUserIds: patch.allowedUserIds ?? existing.allowedUserIds,
      botUsername: patch.botUsername ?? existing.botUsername,
      cursorApiKey: patch.cursorApiKey ?? existing.cursorApiKey,
      cwd: patch.cwd ?? existing.cwd,
      workspaces: patch.workspaces ?? existing.workspaces,
      model: patch.model ?? existing.model,
    },
    home,
  );
}

export function redactToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function parseUserIdList(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Resolve runtime config from ~/.memgrep/telegram.json with optional env overrides.
 * Does not throw if missing — caller decides whether to run setup.
 */
export function resolveTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): ResolvedTelegramConfig | null {
  const file = readTelegramConfig(home);
  const envToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const envIds = parseUserIdList(env.TELEGRAM_ALLOWED_USER_IDS);

  const botToken = envToken || file?.botToken;
  const allowedUserIds = envIds.length > 0 ? envIds : (file?.allowedUserIds ?? []);

  if (!botToken || allowedUserIds.length === 0) {
    return null;
  }

  let source: ResolvedTelegramConfig['source'] = 'file';
  if (envToken || envIds.length > 0) {
    source = file ? 'mixed' : 'env';
  }

  const cursorApiKey = env.CURSOR_API_KEY?.trim() || file?.cursorApiKey;
  const cwdRaw = env.MEMGREP_TELEGRAM_CWD?.trim() || file?.cwd || process.cwd();
  const cwd = expandHomePath(cwdRaw);
  const model = env.MEMGREP_TELEGRAM_MODEL?.trim() || file?.model || DEFAULT_CURSOR_MODEL;

  return {
    botToken,
    allowedUserIds: new Set(allowedUserIds),
    botUsername: file?.botUsername,
    cursorApiKey,
    cwd,
    workspaces: normalizeWorkspaces(file?.workspaces, cwd),
    model,
    mcpUrl: (env.MEMGREP_MCP_URL ?? 'http://127.0.0.1:3921/mcp').replace(/\/$/, ''),
    mcpToken: env.MEMGREP_MCP_TOKEN,
    configPath: telegramConfigPath(home),
    source,
  };
}

/** One-shot migrate: if env has full credentials and no file yet, persist them. */
export function maybeMigrateEnvToConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): TelegramConfig | null {
  if (readTelegramConfig(home)) return null;
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const allowedUserIds = parseUserIdList(env.TELEGRAM_ALLOWED_USER_IDS);
  if (!botToken || allowedUserIds.length === 0) return null;
  return writeTelegramConfig(
    {
      botToken,
      allowedUserIds,
      cursorApiKey: env.CURSOR_API_KEY?.trim(),
      cwd: env.MEMGREP_TELEGRAM_CWD?.trim(),
      model: env.MEMGREP_TELEGRAM_MODEL?.trim(),
    },
    home,
  );
}
