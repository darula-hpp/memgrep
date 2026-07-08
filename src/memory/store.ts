import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import type DatabaseType from 'better-sqlite3';
import type { HierarchicalNSW as HierarchicalNSWType } from 'hnswlib-node';
import { chunkText } from '../chunker.js';
import { DEFAULT_MODEL, Embedder } from '../embedder.js';

// Both better-sqlite3 and hnswlib-node are CommonJS native addons.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof DatabaseType;
const { HierarchicalNSW } = require('hnswlib-node') as typeof import('hnswlib-node');

const INDEX_FILE = 'index.bin';
const DB_FILE = 'memory.db';
const EMBED_BATCH = 32;

export function defaultHome(): string {
  return process.env.MEMGREP_HOME ?? path.join(homedir(), '.memgrep');
}

export interface ChatInput {
  title: string;
  project: string;
  content: string;
  /** Origin file path; used to detect re-ingestion of a chat that has grown. */
  source?: string;
  /** Which agent tool the chat came from, e.g. "cursor", "claude", "kiro", "note". */
  tool?: string;
  createdAt?: string;
  /** Last activity timestamp (file mtime); used to rank recency, not stored. */
  modifiedAt?: string;
}

export interface ChatSummary {
  id: number;
  title: string;
  project: string;
  tool: string;
  createdAt: string;
  chars: number;
}

export interface ChatRecord extends ChatSummary {
  content: string;
  source: string | null;
}

export interface MemoryHit extends ChatSummary {
  score: number;
  snippet: string;
}

interface ChatRow {
  id: number;
  title: string;
  project: string;
  source: string | null;
  tool: string | null;
  hash: string;
  content: string;
  created_at: string;
}

/**
 * Global chat memory: SQLite is the source of truth (chats, chunk text,
 * config), the HNSW index is a rebuildable search accelerator for the vectors.
 */
export class MemoryStore {
  private constructor(
    private readonly dir: string,
    private readonly db: DatabaseType.Database,
    private readonly embedder: Embedder,
    private hnsw: HierarchicalNSWType,
    private nextLabel: number,
  ) {}

  /**
   * Open the store. `heal: false` skips index repair and rebuild; use it for
   * commands that never touch vectors (list, show, copy, delete). Search and
   * ingest must open with healing enabled (the default).
   */
  static async open(
    dir: string = defaultHome(),
    options: { heal?: boolean } = {},
  ): Promise<MemoryStore> {
    const heal = options.heal ?? true;
    mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, DB_FILE));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        project TEXT NOT NULL,
        source TEXT UNIQUE,
        hash TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        label INTEGER PRIMARY KEY,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_chunks_chat ON chunks(chat_id);
      CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project);
    `);
    migrate(db);

    const storedModel = getMeta(db, 'model');
    const model = storedModel ?? DEFAULT_MODEL;
    const embedder = await Embedder.create(model);
    if (!storedModel) setMeta(db, 'model', model);

    const indexPath = path.join(dir, INDEX_FILE);
    const hnsw = new HierarchicalNSW('cosine', embedder.dimensions);

    const store = new MemoryStore(dir, db, embedder, hnsw, 0);
    if (existsSync(indexPath)) {
      await hnsw.readIndex(indexPath);
      await store.reconcile(heal);
    } else {
      hnsw.initIndex(1024);
      store.deriveNextLabel(0);
      if (heal) await store.rebuildFromDb();
    }
    return store;
  }

  private deriveNextLabel(indexCount: number): void {
    const { maxLabel } = this.db
      .prepare('SELECT COALESCE(MAX(label), -1) AS maxLabel FROM chunks')
      .get() as { maxLabel: number };
    this.nextLabel = Math.max(indexCount, maxLabel + 1);
  }

  /**
   * SQLite commits per chat, but the HNSW index is only written on persist().
   * If a previous process died in between, the index on disk lags the
   * database: chunks exist whose vectors were never saved. Detect that here,
   * re-embed the missing chunks, and repair the index. SQLite is always the
   * source of truth; the index is a rebuildable cache.
   */
  private async reconcile(heal: boolean): Promise<void> {
    const indexCount = this.hnsw.getCurrentCount();
    this.deriveNextLabel(indexCount);
    if (!heal) return;

    // Labels are issued sequentially, so anything >= indexCount never reached disk.
    const missing = this.db
      .prepare('SELECT label, text FROM chunks WHERE label >= ? ORDER BY label')
      .all(indexCount) as { label: number; text: string }[];
    if (missing.length === 0) return;

    console.error(
      `memgrep: index is behind the database, re-embedding ${missing.length} missing chunk(s)...`,
    );
    const vectors = await this.embedBatched(missing.map((m) => m.text));
    for (let i = 0; i < missing.length; i++) {
      this.growToFit(missing[i].label + 1);
      this.hnsw.addPoint(vectors[i], missing[i].label);
    }
    await this.persist();
  }

  /**
   * Add a chat. Returns the chat id, or null when skipped as unchanged.
   * A chat with the same `source` but different content is replaced.
   */
  async addChat(input: ChatInput): Promise<number | null> {
    const hash = sha256(input.content);
    const existing = input.source
      ? (this.db.prepare('SELECT id, hash FROM chats WHERE source = ?').get(input.source) as
          | { id: number; hash: string }
          | undefined)
      : (this.db.prepare('SELECT id, hash FROM chats WHERE hash = ?').get(hash) as
          | { id: number; hash: string }
          | undefined);
    if (existing) {
      if (existing.hash === hash) return null;
      this.deleteChat(existing.id);
    }

    const pieces = chunkText(input.content);
    if (pieces.length === 0) return null;
    const vectors = await this.embedBatched(pieces);

    const now = new Date().toISOString();
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO chats (title, project, source, tool, hash, content, created_at, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.title,
        input.project,
        input.source ?? null,
        input.tool ?? null,
        hash,
        input.content,
        input.createdAt ?? now,
        now,
      );
    const chatId = Number(lastInsertRowid);

    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (label, chat_id, chunk_index, text) VALUES (?, ?, ?, ?)',
    );
    for (let i = 0; i < pieces.length; i++) {
      const label = this.nextLabel++;
      this.growToFit(this.nextLabel);
      this.hnsw.addPoint(vectors[i], label);
      insertChunk.run(label, chatId, i, pieces[i]);
    }
    return chatId;
  }

  listChats(project?: string): ChatSummary[] {
    const rows = (
      project
        ? this.db
            .prepare('SELECT * FROM chats WHERE project = ? ORDER BY created_at DESC')
            .all(project)
        : this.db.prepare('SELECT * FROM chats ORDER BY created_at DESC').all()
    ) as ChatRow[];
    return rows.map(toSummary);
  }

  getChat(id: number): ChatRecord | undefined {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined;
    if (!row) return undefined;
    return { ...toSummary(row), content: row.content, source: row.source };
  }

  /** How a candidate chat relates to what is stored, keyed by its source path. */
  sourceStatus(source: string, content: string): 'new' | 'ingested' | 'changed' {
    const row = this.db.prepare('SELECT hash FROM chats WHERE source = ?').get(source) as
      | { hash: string }
      | undefined;
    if (!row) return 'new';
    return row.hash === sha256(content) ? 'ingested' : 'changed';
  }

  deleteChat(id: number): boolean {
    const labels = this.db.prepare('SELECT label FROM chunks WHERE chat_id = ?').all(id) as {
      label: number;
    }[];
    for (const { label } of labels) {
      try {
        this.hnsw.markDelete(label);
      } catch {
        // Label may be missing if the index was rebuilt; SQLite remains authoritative.
      }
    }
    const { changes } = this.db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    return changes > 0;
  }

  async search(query: string, k = 5): Promise<MemoryHit[]> {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
    if (total === 0) return [];

    const vector = await this.embedder.embedOne(query);
    const fetchK = Math.min(k * 4, total);
    const { neighbors, distances } = this.hnsw.searchKnn(vector, fetchK);

    const chunkStmt = this.db.prepare(
      `SELECT c.text, c.chat_id, ch.title, ch.project, ch.tool, ch.created_at, length(ch.content) AS chars
       FROM chunks c JOIN chats ch ON ch.id = c.chat_id WHERE c.label = ?`,
    );
    const best = new Map<number, MemoryHit>();
    for (let i = 0; i < neighbors.length; i++) {
      const row = chunkStmt.get(neighbors[i]) as
        | { text: string; chat_id: number; title: string; project: string; tool: string | null; created_at: string; chars: number }
        | undefined;
      if (!row) continue;
      const score = 1 - distances[i];
      const existing = best.get(row.chat_id);
      if (!existing || score > existing.score) {
        best.set(row.chat_id, {
          id: row.chat_id,
          title: row.title,
          project: row.project,
          tool: row.tool ?? 'unknown',
          createdAt: row.created_at,
          chars: row.chars,
          score,
          snippet: row.text,
        });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Delete every chat and reset the vector index. Returns the number of chats removed. */
  deleteAll(): number {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM chats').get() as { n: number };
    this.db.exec('DELETE FROM chats'); // cascades to chunks
    this.hnsw.initIndex(1024);
    this.nextLabel = 0;
    return n;
  }

  /** Persist a small piece of CLI state (e.g. last recall results). */
  setState(key: string, value: string): void {
    setMeta(this.db, `state:${key}`, value);
  }

  getState(key: string): string | undefined {
    return getMeta(this.db, `state:${key}`);
  }

  /** Write the HNSW index to disk. Call after mutations. */
  async persist(): Promise<void> {
    await this.hnsw.writeIndex(path.join(this.dir, INDEX_FILE));
  }

  close(): void {
    this.db.close();
  }

  /** Re-embed every chunk in SQLite into a fresh HNSW index. */
  private async rebuildFromDb(): Promise<void> {
    const rows = this.db.prepare('SELECT label, text FROM chunks ORDER BY label').all() as {
      label: number;
      text: string;
    }[];
    if (rows.length === 0) return;
    const vectors = await this.embedBatched(rows.map((r) => r.text));
    for (let i = 0; i < rows.length; i++) {
      this.nextLabel = Math.max(this.nextLabel, rows[i].label + 1);
      this.growToFit(rows[i].label + 1);
      this.hnsw.addPoint(vectors[i], rows[i].label);
    }
    await this.persist();
  }

  private async embedBatched(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      vectors.push(...(await this.embedder.embed(texts.slice(i, i + EMBED_BATCH))));
    }
    return vectors;
  }

  /**
   * Grow the index so it can hold `needed` elements. Always asks the index
   * for its true capacity rather than tracking it separately; a tracked
   * number can drift from reality if a previous process died before persist.
   */
  private growToFit(needed: number): void {
    const max = this.hnsw.getMaxElements();
    if (needed > max) {
      this.hnsw.resizeIndex(Math.max(max * 2, needed));
    }
  }
}

function toSummary(row: ChatRow & { chars?: number }): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    tool: row.tool ?? 'unknown',
    createdAt: row.created_at,
    chars: row.chars ?? row.content.length,
  };
}

/** Additive schema migrations for stores created by older versions. */
function migrate(db: DatabaseType.Database): void {
  const columns = db.prepare("PRAGMA table_info('chats')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'tool')) {
    db.exec("ALTER TABLE chats ADD COLUMN tool TEXT");
    // Everything ingested before multi-tool support came from Cursor transcripts.
    db.exec("UPDATE chats SET tool = 'cursor' WHERE source IS NOT NULL");
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function getMeta(db: DatabaseType.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setMeta(db: DatabaseType.Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
