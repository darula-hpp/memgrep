import type DatabaseType from 'better-sqlite3';

/**
 * FTS5 external-content index over `chunks.text`, keyed by `label`.
 * Triggers keep FTS in sync with INSERT/UPDATE/DELETE on `chunks`.
 */
export function ensureChunksFts(db: DatabaseType.Database): void {
  const exists = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'")
    .get() as { ok: number } | undefined;
  if (exists) return;

  db.exec(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='label',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.label, new.text);
    END;

    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.label, old.text);
    END;

    CREATE TRIGGER chunks_au AFTER UPDATE OF text ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.label, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.label, new.text);
    END;
  `);

  // Backfill existing rows (no-op on a fresh empty store).
  db.exec(`INSERT INTO chunks_fts(rowid, text) SELECT label, text FROM chunks`);
}
