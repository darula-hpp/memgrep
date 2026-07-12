import type DatabaseType from 'better-sqlite3';
import type { HierarchicalNSW as HierarchicalNSWType } from 'hnswlib-node';
import type { Embedder } from '../../embedder.js';
import type { RankedChatHit, SearchBackend } from './types.js';

interface ChunkJoinRow {
  text: string;
  chat_id: number;
  title: string;
  project: string;
  tool: string | null;
  created_at: string;
  chars: number;
}

export interface VectorSearchDeps {
  db: DatabaseType.Database;
  hnsw: HierarchicalNSWType;
  /** Called lazily so heal/reconcile still runs before the first search. */
  ensureReady: () => Promise<Embedder>;
  chunkCount: () => number;
}

/**
 * Semantic search via HNSW cosine nearest neighbors over chunk embeddings.
 */
export class VectorSearchBackend implements SearchBackend {
  readonly name = 'vector';

  constructor(private readonly deps: VectorSearchDeps) {}

  async search(query: string, fetchK: number): Promise<RankedChatHit[]> {
    const total = this.deps.chunkCount();
    if (total === 0 || fetchK <= 0) return [];

    const embedder = await this.deps.ensureReady();
    const vector = await embedder.embedOne(query);
    const neighborK = Math.min(Math.max(fetchK * 4, fetchK), total);
    const { neighbors, distances } = this.deps.hnsw.searchKnn(vector, neighborK);

    const chunkStmt = this.deps.db.prepare(
      `SELECT c.text, c.chat_id, ch.title, ch.project, ch.tool, ch.created_at,
              length(ch.content) AS chars
       FROM chunks c JOIN chats ch ON ch.id = c.chat_id WHERE c.label = ?`,
    );

    const best = new Map<number, RankedChatHit>();
    for (let i = 0; i < neighbors.length; i++) {
      const row = chunkStmt.get(neighbors[i]) as ChunkJoinRow | undefined;
      if (!row) continue;
      const score = 1 - distances[i];
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
