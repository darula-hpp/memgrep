/**
 * Shared types for memory search backends.
 *
 * Search is two-stage: backends return ranked chat-level candidates, then a
 * fusion strategy (RRF) merges them into a single ranked list.
 */

export type SearchMode = 'hybrid' | 'vector' | 'keyword';

/** One chat candidate from a single backend, already deduped to best chunk. */
export interface RankedChatHit {
  chatId: number;
  title: string;
  project: string;
  tool: string;
  createdAt: string;
  chars: number;
  /** Backend-native score (cosine similarity or BM25); not comparable across backends. */
  score: number;
  snippet: string;
  /** 1-based rank within this backend's result list. */
  rank: number;
}

export interface SearchBackend {
  readonly name: string;
  /**
   * Return up to `fetchK` chats ranked by this backend.
   * Empty array when the backend cannot search (e.g. empty index).
   */
  search(query: string, fetchK: number): Promise<RankedChatHit[]>;
}

export interface SearchOptions {
  /** Default `hybrid`. */
  mode?: SearchMode;
}
