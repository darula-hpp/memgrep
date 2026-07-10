import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VectorIndex } from '../vector-index.js';

// Integration test: downloads the embedding model on first run (cached afterwards).
describe('VectorIndex', () => {
  let index: VectorIndex;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'memgrep-'));
    index = await VectorIndex.create();
    await index.add([
      { id: 'fruit', text: 'Apples, bananas, and oranges are healthy fruits full of vitamins.' },
      { id: 'auth', text: 'To reset your password, click the forgot password link on the login page.' },
      { id: 'space', text: 'The James Webb telescope observes distant galaxies in infrared light.' },
    ]);
  }, 300_000);

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('retrieves semantically relevant documents', async () => {
    const hits = await index.search('I forgot my login credentials', { k: 2 });
    expect(hits[0].id).toBe('auth');
    expect(hits[0].score).toBeGreaterThan(0.3);
  });

  it('returns at most k results', async () => {
    const hits = await index.search('anything', { k: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('removes documents', async () => {
    await index.add({ id: 'temp', text: 'Volcanoes erupt molten lava from deep underground.' });
    expect(index.remove('temp')).toBe(true);
    expect(index.remove('temp')).toBe(false);
    const hits = await index.search('lava eruption', { k: 3 });
    expect(hits.map((h) => h.id)).not.toContain('temp');
  });

  it('replaces documents re-added with the same id', async () => {
    await index.add({ id: 'fruit', text: 'Guitars and pianos are musical instruments.' });
    const hits = await index.search('musical instruments', { k: 1 });
    expect(hits[0].id).toBe('fruit');
    expect(index.size).toBe(3);
  });

  it('persists and reloads', async () => {
    await index.save(tempDir);
    const loaded = await VectorIndex.load(tempDir);
    expect(loaded.size).toBe(index.size);
    const hits = await loaded.search('reset my password', { k: 1 });
    expect(hits[0].id).toBe('auth');
  }, 120_000);
});
