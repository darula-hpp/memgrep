import type DatabaseType from 'better-sqlite3';
import { buildFtsMatchQuery } from './fts-query.js';
import type { RankedChatHit, SearchBackend } from './types.js';

interface FtsRow {
  label: number;
  text: string;
  chat_id: number;
  title: string;
  project: string;
  tool: string | null;
  created_at: string;
  chars: number;
  bm25: number;
}

/**
 * Keyword / BM25 search over chunk text via SQLite FTS5.
 */
export class FtsSearchBackend implements SearchBackend {
  readonly name = 'fts';

  constructor(private readonly db: DatabaseType.Database) {}

  async search(query: string, fetchK: number): Promise<RankedChatHit[]> {
    if (fetchK <= 0) return [];
    const match = buildFtsMatchQuery(query);
    if (!match) return [];

    // Over-fetch chunks so chat-level dedupe still has headroom.
    const chunkLimit = Math.max(fetchK * 4, fetchK);
    let rows: FtsRow[];
    try {
      rows = this.db
        .prepare(
          `SELECT c.label, c.text, c.chat_id, ch.title, ch.project, ch.tool,
                  ch.created_at, length(ch.content) AS chars,
                  bm25(chunks_fts) AS bm25
           FROM chunks_fts
           JOIN chunks c ON c.label = chunks_fts.rowid
           JOIN chats ch ON ch.id = c.chat_id
           WHERE chunks_fts MATCH ?
           ORDER BY bm25(chunks_fts)
           LIMIT ?`,
        )
        .all(match, chunkLimit) as FtsRow[];
    } catch {
      // Malformed MATCH after escaping should be rare; fail soft to vector-only.
      return [];
    }

    // bm25(): lower (more negative) is better — invert for a "higher is better" score.
    const best = new Map<number, RankedChatHit>();
    for (const row of rows) {
      const score = -row.bm25;
      const existing = best.get(row.chat_id);
      if (!existing || score > existing.score) {
        best.set(row.chat_id, {
          chatId: row.chat_id,
          title: row.title,
          project: row.project,
          tool: row.tool ?? 'unknown',
          createdAt: row.created_at,
          chars: row.chars,
          score,
          snippet: row.text,
          rank: 0,
        });
      }
    }

    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, fetchK)
      .map((hit, i) => ({ ...hit, rank: i + 1 }));
  }
}
