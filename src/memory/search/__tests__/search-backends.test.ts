import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type DatabaseType from 'better-sqlite3';
import { ensureChunksFts } from '../fts-schema.js';
import { FtsSearchBackend } from '../fts-backend.js';
import { HybridSearchBackend } from '../hybrid-backend.js';
import type { RankedChatHit, SearchBackend } from '../types.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof DatabaseType;

function openTestDb(dir: string): DatabaseType.Database {
  const db = new Database(path.join(dir, 'memory.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      project TEXT NOT NULL,
      source TEXT UNIQUE,
      tool TEXT,
      hash TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );
    CREATE TABLE chunks (
      label INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL
    );
  `);
  ensureChunksFts(db);
  return db;
}

function insertChat(
  db: DatabaseType.Database,
  opts: { title: string; content: string; label: number },
): number {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO chats (title, project, source, tool, hash, content, created_at, ingested_at)
       VALUES (?, 'p', NULL, 'note', ?, ?, ?, ?)`,
    )
    .run(opts.title, `hash-${opts.label}`, opts.content, now, now);
  const chatId = Number(lastInsertRowid);
  db.prepare('INSERT INTO chunks (label, chat_id, chunk_index, text) VALUES (?, ?, 0, ?)').run(
    opts.label,
    chatId,
    opts.content,
  );
  return chatId;
}

describe('FtsSearchBackend', () => {
  let dir: string;
  let db: DatabaseType.Database;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'memgrep-fts-'));
    db = openTestDb(dir);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('ranks chats that contain an exact numeric id', async () => {
    const target = insertChat(db, {
      title: 'Merchant incident',
      content: 'Checkout failed for merchant 7712 with a timeout from the acquirer.',
      label: 0,
    });
    insertChat(db, {
      title: 'Unrelated deploy',
      content: 'We rolled out the blue-green deploy checklist for staging.',
      label: 1,
    });

    const backend = new FtsSearchBackend(db);
    const hits = await backend.search('7712', 5);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chatId).toBe(target);
    expect(hits[0].rank).toBe(1);
    expect(hits[0].snippet).toContain('7712');
  });

  it('matches error codes like ECONNREFUSED', async () => {
    const target = insertChat(db, {
      title: 'DB connection flake',
      content: 'Assistant: Postgres returned ECONNREFUSED during the health check.',
      label: 0,
    });
    insertChat(db, {
      title: 'UI polish',
      content: 'Assistant: Tweaked button padding on the settings screen.',
      label: 1,
    });

    const hits = await new FtsSearchBackend(db).search('ECONNREFUSED', 3);
    expect(hits[0].chatId).toBe(target);
  });

  it('returns empty for queries with no searchable tokens', async () => {
    insertChat(db, { title: 'a', content: 'hello world', label: 0 });
    expect(await new FtsSearchBackend(db).search('!!!', 5)).toEqual([]);
  });

  it('stays in sync when a chat is deleted', async () => {
    const id = insertChat(db, {
      title: 'gone',
      content: 'unique-token-xyz-999',
      label: 0,
    });
    const backend = new FtsSearchBackend(db);
    expect((await backend.search('unique-token-xyz-999', 5))[0].chatId).toBe(id);

    db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    expect(await backend.search('unique-token-xyz-999', 5)).toEqual([]);
  });
});

class StubBackend implements SearchBackend {
  readonly name: string;
  constructor(
    name: string,
    private readonly hits: RankedChatHit[],
  ) {
    this.name = name;
  }
  async search(): Promise<RankedChatHit[]> {
    return this.hits;
  }
}

describe('HybridSearchBackend', () => {
  it('falls back to vector when keyword finds nothing', async () => {
    const vectorHits: RankedChatHit[] = [
      {
        chatId: 1,
        title: 'sem',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 0.9,
        snippet: 'semantic',
        rank: 1,
      },
    ];
    const hybrid = new HybridSearchBackend(
      new StubBackend('vector', vectorHits),
      new StubBackend('fts', []),
    );
    const hits = await hybrid.searchWithMode('anything', 5, 'hybrid');
    expect(hits).toEqual(vectorHits);
  });

  it('fuses ranks so a keyword-only top hit surfaces', async () => {
    const vector: RankedChatHit[] = [
      {
        chatId: 1,
        title: 'auth',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 0.8,
        snippet: 'login race',
        rank: 1,
      },
      {
        chatId: 2,
        title: 'merchant',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 0.4,
        snippet: 'merchant 7712',
        rank: 2,
      },
    ];
    const keyword: RankedChatHit[] = [
      {
        chatId: 2,
        title: 'merchant',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 12,
        snippet: 'merchant 7712',
        rank: 1,
      },
    ];

    const hybrid = new HybridSearchBackend(
      new StubBackend('vector', vector),
      new StubBackend('fts', keyword),
    );
    const hits = await hybrid.searchWithMode('merchant 7712', 5, 'hybrid');
    expect(hits[0].chatId).toBe(2);
  });

  it('respects mode overrides', async () => {
    const vector = new StubBackend('vector', [
      {
        chatId: 1,
        title: 'v',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 1,
        snippet: 'v',
        rank: 1,
      },
    ]);
    const keyword = new StubBackend('fts', [
      {
        chatId: 2,
        title: 'k',
        project: 'p',
        tool: 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
        chars: 1,
        score: 1,
        snippet: 'k',
        rank: 1,
      },
    ]);
    const hybrid = new HybridSearchBackend(vector, keyword);

    expect((await hybrid.searchWithMode('q', 5, 'vector'))[0].chatId).toBe(1);
    expect((await hybrid.searchWithMode('q', 5, 'keyword'))[0].chatId).toBe(2);
  });
});
