import { describe, expect, it } from 'vitest';
import { chunkText } from '../chunker.js';

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
  });

  it('splits long text into overlapping chunks', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(100); // ~4600 chars
    const chunks = chunkText(text, { chunkSize: 1000, chunkOverlap: 200 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      expect(chunk.length).toBeGreaterThan(0);
    }
    expect(chunks.join(' ')).toContain('quick brown fox');
  });

  it('prefers paragraph boundaries', () => {
    const para = 'a'.repeat(400);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkText(text, { chunkSize: 900, chunkOverlap: 50 });
    expect(chunks[0].endsWith('a')).toBe(true);
    expect(chunks[0].length).toBeLessThanOrEqual(900);
  });
});
