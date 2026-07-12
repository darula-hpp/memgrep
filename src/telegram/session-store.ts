import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultHome } from '../memory/store.js';
import {
  DEFAULT_TELEGRAM_PROFILE,
  sanitizeTelegramProfile,
  telegramProfilesDir,
} from './config.js';

export type SessionEntry = {
  agentId: string;
  updatedAt: string;
};

export type SessionStoreFile = {
  version: 1;
  /** telegramUserId → cwd → session */
  byUser: Record<string, Record<string, SessionEntry>>;
};

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
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<SessionStoreFile>;
    if (raw?.version !== 1 || typeof raw.byUser !== 'object' || !raw.byUser) {
      return { version: 1, byUser: {} };
    }
    return { version: 1, byUser: raw.byUser };
  } catch {
    return { version: 1, byUser: {} };
  }
}

function writeSessionStore(
  store: SessionStoreFile,
  home = defaultHome(),
  profile: string = DEFAULT_TELEGRAM_PROFILE,
): void {
  const dir = telegramProfilesDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(telegramSessionsPath(home, profile), `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
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
