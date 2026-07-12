import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import {
  DEFAULT_TELEGRAM_PROFILE,
  sanitizeTelegramProfile,
  telegramProfilesDir,
} from './config.js';

const sessionEntrySchema = z.object({
  agentId: z.string().min(1),
  updatedAt: z.string().min(1),
});

const sessionStoreSchema = z.object({
  version: z.literal(1),
  byUser: z.record(z.string(), z.record(z.string(), sessionEntrySchema)),
});

export type SessionEntry = z.infer<typeof sessionEntrySchema>;
export type SessionStoreFile = z.infer<typeof sessionStoreSchema>;

/** Sessions live beside profile configs: ~/.memgrep/telegram/<profile>.sessions.json */
export function telegramSessionsPath(
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): string {
  return path.join(
    telegramProfilesDir(home),
    `${sanitizeTelegramProfile(profile)}.sessions.json`,
  );
}

export function readSessionStore(
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): SessionStoreFile {
  const filePath = telegramSessionsPath(home, profile);
  if (!existsSync(filePath)) {
    return { version: 1, byUser: {} };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const parsed = sessionStoreSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `memgrep telegram: invalid session store at ${filePath}; starting empty (${parsed.error.issues[0]?.message ?? 'schema'})`,
      );
      return { version: 1, byUser: {} };
    }
    return parsed.data;
  } catch {
    return { version: 1, byUser: {} };
  }
}

function writeSessionStore(
  store: SessionStoreFile,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): void {
  mkdirSync(telegramProfilesDir(home), { recursive: true });
  writeFileAtomic(
    telegramSessionsPath(home, profile),
    `${JSON.stringify(store, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function getPersistedAgentId(
  userId: number,
  cwd: string,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): string | undefined {
  const entry = readSessionStore(home, profile).byUser[String(userId)]?.[cwd];
  return entry?.agentId;
}

export function setPersistedAgentId(
  userId: number,
  cwd: string,
  agentId: string,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): void {
  const store = readSessionStore(home, profile);
  const key = String(userId);
  const forUser = { ...(store.byUser[key] ?? {}) };
  forUser[cwd] = { agentId, updatedAt: new Date().toISOString() };
  store.byUser[key] = forUser;
  writeSessionStore(store, home, profile);
}

/** Clear the persisted agent for one user+cwd (used by /new). */
export function clearPersistedAgentId(
  userId: number,
  cwd: string,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): void {
  const store = readSessionStore(home, profile);
  const key = String(userId);
  const forUser = store.byUser[key];
  if (!forUser || !(cwd in forUser)) return;
  const next = { ...forUser };
  delete next[cwd];
  if (Object.keys(next).length === 0) {
    delete store.byUser[key];
  } else {
    store.byUser[key] = next;
  }
  writeSessionStore(store, home, profile);
}
