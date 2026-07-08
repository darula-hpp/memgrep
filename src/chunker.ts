import type { ChunkOptions } from './types.js';

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Split text into overlapping chunks of roughly `chunkSize` characters,
 * preferring to break at paragraph, sentence, or word boundaries.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP, chunkSize - 1);

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);
    if (end < trimmed.length) {
      end = findBreakPoint(trimmed, start, end);
    }
    const chunk = trimmed.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Look backwards from `end` for a natural boundary, but never move more than 20% of the window. */
function findBreakPoint(text: string, start: number, end: number): number {
  const minEnd = end - Math.floor((end - start) * 0.2);
  for (const boundary of ['\n\n', '. ', '\n', ' ']) {
    const idx = text.lastIndexOf(boundary, end);
    if (idx > minEnd) return idx + boundary.length;
  }
  return end;
}
