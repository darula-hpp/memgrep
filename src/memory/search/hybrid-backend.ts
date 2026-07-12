import { reciprocalRankFusion } from './rrf.js';
import type { RankedChatHit, SearchBackend, SearchMode } from './types.js';

/**
 * Composite search: run vector + keyword backends and fuse with RRF.
 * Strategy pattern — callers depend on {@link SearchBackend}, not HNSW/FTS.
 */
export class HybridSearchBackend implements SearchBackend {
  readonly name = 'hybrid';

  constructor(
    private readonly vector: SearchBackend,
    private readonly keyword: SearchBackend,
  ) {}

  async search(query: string, fetchK: number): Promise<RankedChatHit[]> {
    return this.searchWithMode(query, fetchK, 'hybrid');
  }

  async searchWithMode(
    query: string,
    fetchK: number,
    mode: SearchMode,
  ): Promise<RankedChatHit[]> {
    if (fetchK <= 0) return [];

    if (mode === 'vector') {
      return this.vector.search(query, fetchK);
    }
    if (mode === 'keyword') {
      return this.keyword.search(query, fetchK);
    }

    const [vectorHits, keywordHits] = await Promise.all([
      this.vector.search(query, fetchK),
      this.keyword.search(query, fetchK),
    ]);

    // If keyword finds nothing, keep pure vector ranking (and scores).
    if (keywordHits.length === 0) return vectorHits;
    if (vectorHits.length === 0) return keywordHits;

    const fused = reciprocalRankFusion([vectorHits, keywordHits]);
    return fused.slice(0, fetchK).map((hit, i) => ({
      chatId: hit.chatId,
      title: hit.title,
      project: hit.project,
      tool: hit.tool,
      createdAt: hit.createdAt,
      chars: hit.chars,
      score: hit.score,
      snippet: hit.snippet,
      rank: i + 1,
    }));
  }
}
