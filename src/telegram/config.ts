import { mkdirSync, readFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';

/** Legacy single-bot file (migrated to telegram/default.json). */
export const TELEGRAM_CONFIG_FILE = 'telegram.json';
export const TELEGRAM_PROFILES_DIR = 'telegram';
export const DEFAULT_TELEGRAM_PROFILE = 'default';
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
  profile: string;
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

export function telegramProfilesDir(home = defaultHome()): string {
  return path.join(home, TELEGRAM_PROFILES_DIR);
}

export function legacyTelegramConfigPath(home = defaultHome()): string {
  return path.join(home, TELEGRAM_CONFIG_FILE);
}

/** Normalize a profile name: lowercase, [a-z0-9_-], 1–64 chars. */
export function sanitizeTelegramProfile(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) {
    throw new Error('Profile name is required.');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      `Invalid profile "${raw}". Use letters, numbers, _ or - (max 64), starting with alphanumeric.`,
    );
  }
  return name;
}

export function telegramConfigPath(
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): string {
  return path.join(telegramProfilesDir(home), `${sanitizeTelegramProfile(profile)}.json`);
}

/**
 * Move ~/.memgrep/telegram.json → ~/.memgrep/telegram/default.json once.
 * Returns the profile name if a migration ran.
 */
export function migrateLegacyTelegramConfig(home = defaultHome()): string | null {
  const legacy = legacyTelegramConfigPath(home);
  const dest = telegramConfigPath(home, DEFAULT_TELEGRAM_PROFILE);
  if (!existsSync(legacy) || existsSync(dest)) return null;
  mkdirSync(telegramProfilesDir(home), { recursive: true });
  renameSync(legacy, dest);
  return DEFAULT_TELEGRAM_PROFILE;
}

export function listTelegramProfiles(home = defaultHome()): string[] {
  migrateLegacyTelegramConfig(home);
  const dir = telegramProfilesDir(home);
  if (!existsSync(dir)) {
    // Still support unmigrated legacy for status before any write.
    if (existsSync(legacyTelegramConfigPath(home))) return [DEFAULT_TELEGRAM_PROFILE];
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter((name) => {
      try {
        sanitizeTelegramProfile(name);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

/** Pick which profile to run when --profile is omitted. */
export function resolveDefaultProfileName(home = defaultHome()): string | null {
  const profiles = listTelegramProfiles(home);
  if (profiles.length === 0) return null;
  if (profiles.includes(DEFAULT_TELEGRAM_PROFILE)) return DEFAULT_TELEGRAM_PROFILE;
  if (profiles.length === 1) return profiles[0]!;
  return null;
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

const telegramWorkspaceSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

const telegramConfigSchema = z.object({
  version: z.literal(1),
  botToken: z.string().min(1),
  allowedUserIds: z.array(z.number().int().positive()),
  botUsername: z.string().optional(),
  cursorApiKey: z.string().optional(),
  cwd: z.string().optional(),
  workspaces: z.array(telegramWorkspaceSchema).optional(),
  model: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function readConfigFile(filePath: string): TelegramConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid telegram config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = telegramConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid telegram config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function readTelegramConfig(
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): TelegramConfig | null {
  migrateLegacyTelegramConfig(home);
  const name = sanitizeTelegramProfile(profile);
  const filePath = telegramConfigPath(home, name);
  if (existsSync(filePath)) return readConfigFile(filePath);

  // Unmigrated legacy only maps to the default profile.
  if (name === DEFAULT_TELEGRAM_PROFILE) {
    const legacy = legacyTelegramConfigPath(home);
    if (existsSync(legacy)) return readConfigFile(legacy);
  }
  return null;
}

/** First profile that already has a Cursor API key (for reuse during setup). */
export function findSharedCursorApiKey(
  home = defaultHome(),
  preferProfile?: string,
): string | undefined {
  const order = [
    ...(preferProfile ? [sanitizeTelegramProfile(preferProfile)] : []),
    ...listTelegramProfiles(home),
  ];
  const seen = new Set<string>();
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const key = readTelegramConfig(home, name)?.cursorApiKey?.trim();
    if (key) return key;
  }
  return undefined;
}

export function writeTelegramConfig(
  config: Omit<TelegramConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): TelegramConfig {
  migrateLegacyTelegramConfig(home);
  const name = sanitizeTelegramProfile(profile);
  mkdirSync(telegramProfilesDir(home), { recursive: true });
  const existing = readTelegramConfig(home, name);
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
  writeFileAtomic(telegramConfigPath(home, name), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
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
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): TelegramConfig {
  const name = sanitizeTelegramProfile(profile);
  const existing = readTelegramConfig(home, name);
  if (!existing) {
    throw new Error(
      `No telegram config at ${telegramConfigPath(home, name)}. Run: memgrep telegram setup ${name}`,
    );
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
    name,
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
 * Resolve runtime config for a profile from disk with optional env overrides.
 * Does not throw if missing — caller decides whether to run setup.
 */
export function resolveTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): ResolvedTelegramConfig | null {
  migrateLegacyTelegramConfig(home);
  const name = sanitizeTelegramProfile(profile);
  const file = readTelegramConfig(home, name);
  const envToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const envIds = parseUserIdList(env.TELEGRAM_ALLOWED_USER_IDS);

  // Env bot credentials only apply to the default profile (legacy single-bot).
  const useEnvBot = name === DEFAULT_TELEGRAM_PROFILE;
  const botToken = (useEnvBot ? envToken : undefined) || file?.botToken;
  const allowedUserIds =
    useEnvBot && envIds.length > 0 ? envIds : (file?.allowedUserIds ?? []);

  if (!botToken || allowedUserIds.length === 0) {
    return null;
  }

  let source: ResolvedTelegramConfig['source'] = 'file';
  if (useEnvBot && (envToken || envIds.length > 0)) {
    source = file ? 'mixed' : 'env';
  }

  const cursorApiKey = env.CURSOR_API_KEY?.trim() || file?.cursorApiKey;
  const cwdRaw = env.MEMGREP_TELEGRAM_CWD?.trim() || file?.cwd || process.cwd();
  const cwd = expandHomePath(cwdRaw);
  const model = env.MEMGREP_TELEGRAM_MODEL?.trim() || file?.model || DEFAULT_CURSOR_MODEL;

  return {
    profile: name,
    botToken,
    allowedUserIds: new Set(allowedUserIds),
    botUsername: file?.botUsername,
    cursorApiKey,
    cwd,
    workspaces: normalizeWorkspaces(file?.workspaces, cwd),
    model,
    mcpUrl: (env.MEMGREP_MCP_URL ?? 'http://127.0.0.1:3921/mcp').replace(/\/$/, ''),
    mcpToken: env.MEMGREP_MCP_TOKEN,
    configPath: telegramConfigPath(home, name),
    source,
  };
}

/** One-shot migrate: if env has full credentials and no profiles yet, persist default. */
export function maybeMigrateEnvToConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = defaultHome(),
): TelegramConfig | null {
  migrateLegacyTelegramConfig(home);
  if (listTelegramProfiles(home).length > 0) return null;
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
    DEFAULT_TELEGRAM_PROFILE,
  );
}
