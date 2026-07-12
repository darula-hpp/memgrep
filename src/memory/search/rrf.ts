import type { RankedChatHit } from './types.js';

/** Classic RRF constant; 60 is the standard from Cormack et al. */
export const RRF_K = 60;

export interface FusedChatHit {
  chatId: number;
  title: string;
  project: string;
  tool: string;
  createdAt: string;
  chars: number;
  /** Reciprocal-rank fusion score (higher is better). */
  score: number;
  snippet: string;
}

/**
 * Reciprocal Rank Fusion across ranked lists from different backends.
 *
 * Scores from vector (cosine) and FTS (BM25) are not comparable, so we fuse
 * by rank: `score(d) = Σ 1 / (k + rank_i(d))`.
 */
export function reciprocalRankFusion(
  lists: RankedChatHit[][],
  k: number = RRF_K,
): FusedChatHit[] {
  const fused = new Map<number, FusedChatHit & { bestRrfTerm: number }>();

  for (const list of lists) {
    for (const hit of list) {
      const term = 1 / (k + hit.rank);
      const existing = fused.get(hit.chatId);
      if (!existing) {
        fused.set(hit.chatId, {
          chatId: hit.chatId,
          title: hit.title,
          project: hit.project,
          tool: hit.tool,
          createdAt: hit.createdAt,
          chars: hit.chars,
          score: term,
          snippet: hit.snippet,
          bestRrfTerm: term,
        });
        continue;
      }
      existing.score += term;
      // Keep the snippet from the backend that contributed the strongest term.
      if (term > existing.bestRrfTerm) {
        existing.bestRrfTerm = term;
        existing.snippet = hit.snippet;
        existing.title = hit.title;
        existing.project = hit.project;
        existing.tool = hit.tool;
        existing.createdAt = hit.createdAt;
        existing.chars = hit.chars;
      }
    }
  }

  return [...fused.values()]
    .map(({ bestRrfTerm: _, ...hit }) => hit)
    .sort((a, b) => b.score - a.score);
}
