import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome, MemoryStore, type ChatRecord } from '../memory/store.js';
import type { SyncChatPayload } from './protocol.js';

const SYNCED_FILE = 'edge-synced.json';

type SyncedFile = {
  version: 1;
  /** Content hashes successfully accepted by the hub. */
  hashes: string[];
};

function syncedPath(home: string): string {
  return path.join(home, SYNCED_FILE);
}

function readSynced(home: string): Set<string> {
  const file = syncedPath(home);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as SyncedFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.hashes)) return new Set();
    return new Set(parsed.hashes.filter((h) => typeof h === 'string'));
  } catch {
    return new Set();
  }
}

function writeSynced(home: string, hashes: Set<string>): void {
  mkdirSync(home, { recursive: true });
  const data: SyncedFile = {
    version: 1,
    hashes: [...hashes].sort(),
  };
  writeFileAtomic(syncedPath(home), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function markHashesSynced(hashes: string[], home = defaultHome()): void {
  const set = readSynced(home);
  for (const h of hashes) set.add(h);
  writeSynced(home, set);
}

export function pendingSyncCount(home = defaultHome()): number {
  // Cheap estimate: requires store open for exact; status uses this after a collect.
  return readSynced(home).size >= 0 ? -1 : 0;
}

export function getSyncedHashCount(home = defaultHome()): number {
  return readSynced(home).size;
}

/** Build payloads for chats not yet acked by the hub. */
export async function collectUnsyncedChats(
  store: MemoryStore,
  home = defaultHome(),
  limit = 25,
): Promise<SyncChatPayload[]> {
  const synced = readSynced(home);
  const summaries = store.listChats();
  const out: SyncChatPayload[] = [];

  for (const summary of summaries) {
    if (out.length >= limit) break;
    const chat = store.getChat(summary.id) as ChatRecord | undefined;
    if (!chat) continue;
    const hash = contentHash(chat.content);
    if (synced.has(hash)) continue;
    out.push({
      title: chat.title,
      project: chat.project,
      content: chat.content,
      source: chat.source,
      tool: chat.tool,
      cursorAgentId: chat.cursorAgentId,
      createdAt: chat.createdAt,
      hash,
    });
  }

  return out;
}

/** Upsert edge-originated chats into the cloud store (re-embed on hub). */
export async function ingestSyncedChats(
  store: MemoryStore,
  deviceId: string,
  chats: SyncChatPayload[],
): Promise<{ accepted: string[]; skipped: string[] }> {
  const accepted: string[] = [];
  const skipped: string[] = [];

  for (const chat of chats) {
    const source = `edge:${deviceId}:${chat.source ?? chat.hash}`;
    const id = await store.addChat({
      title: chat.title.startsWith('[edge]') ? chat.title : `[edge] ${chat.title}`,
      project: chat.project || 'edge',
      content: chat.content,
      source,
      tool: chat.tool ?? 'edge',
      cursorAgentId: chat.cursorAgentId,
      createdAt: chat.createdAt,
    });
    if (id == null) skipped.push(chat.hash);
    else accepted.push(chat.hash);
  }

  if (accepted.length + skipped.length > 0) {
    await store.persist();
  }

  return { accepted, skipped };
}
