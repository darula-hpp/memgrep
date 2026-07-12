import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, RRF_K } from '../rrf.js';
import type { RankedChatHit } from '../types.js';

function hit(chatId: number, rank: number, snippet = `chat-${chatId}`): RankedChatHit {
  return {
    chatId,
    title: `Title ${chatId}`,
    project: 'p',
    tool: 'note',
    createdAt: '2026-01-01T00:00:00.000Z',
    chars: 10,
    score: 1 / rank,
    snippet,
    rank,
  };
}

describe('reciprocalRankFusion', () => {
  it('uses the standard RRF constant', () => {
    expect(RRF_K).toBe(60);
  });

  it('promotes chats that rank well in either list', () => {
    const vector = [hit(1, 1), hit(2, 2), hit(3, 3)];
    const keyword = [hit(3, 1, 'exact-id-snippet'), hit(4, 2)];

    const fused = reciprocalRankFusion([vector, keyword]);

    expect(fused[0].chatId).toBe(3); // rank 3 in vector + rank 1 in keyword
    expect(fused[0].snippet).toBe('exact-id-snippet'); // stronger keyword term
    expect(fused.map((h) => h.chatId)).toEqual([3, 1, 2, 4]);
  });

  it('sums 1/(k+rank) across lists', () => {
    const fused = reciprocalRankFusion([[hit(1, 1)], [hit(1, 1)]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(2 / (RRF_K + 1));
  });

  it('handles a single non-empty list', () => {
    const fused = reciprocalRankFusion([[hit(9, 1)], []]);
    expect(fused).toHaveLength(1);
    expect(fused[0].chatId).toBe(9);
    expect(fused[0].score).toBeCloseTo(1 / (RRF_K + 1));
  });
});
