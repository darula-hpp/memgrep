import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { HierarchicalNSW as HierarchicalNSWType } from 'hnswlib-node';
import { chunkText, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from './chunker.js';
import { DEFAULT_MODEL, Embedder } from './embedder.js';
import type { CreateOptions, Document, SearchHit, SearchOptions } from './types.js';

// hnswlib-node is a CommonJS native addon; load it via require so the
// compiled ESM output works under plain Node (named ESM imports from CJS fail).
const require = createRequire(import.meta.url);
const { HierarchicalNSW } = require('hnswlib-node') as typeof import('hnswlib-node');

const INDEX_FILE = 'index.bin';
const META_FILE = 'meta.json';
const META_VERSION = 1;

interface ChunkRecord {
  docId: string;
  chunkIndex: number;
  text: string;
}

interface DocRecord {
  labels: number[];
  metadata?: Record<string, unknown>;
}

interface Meta {
  version: number;
  model: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  capacity: number;
  nextLabel: number;
  docs: Record<string, DocRecord>;
  chunks: Record<string, ChunkRecord>;
}

/**
 * An embedded semantic search index: local Hugging Face embeddings
 * (Transformers.js, ONNX/WASM) + HNSW approximate nearest-neighbor retrieval.
 */
export class VectorIndex {
  private constructor(
    private readonly embedder: Embedder,
    private readonly hnsw: HierarchicalNSWType,
    private readonly chunkSize: number,
    private readonly chunkOverlap: number,
    private capacity: number,
    private nextLabel: number,
    private readonly docs: Map<string, DocRecord>,
    private readonly chunks: Map<number, ChunkRecord>,
  ) {}

  /** Create a fresh, empty index. Downloads the model on first use (cached afterwards). */
  static async create(options: CreateOptions = {}): Promise<VectorIndex> {
    const embedder = await Embedder.create(options.model ?? DEFAULT_MODEL);
    const capacity = options.initialCapacity ?? 1024;
    const hnsw = new HierarchicalNSW('cosine', embedder.dimensions);
    hnsw.initIndex(capacity);
    return new VectorIndex(
      embedder,
      hnsw,
      options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      capacity,
      0,
      new Map(),
      new Map(),
    );
  }

  /** Load an index previously persisted with {@link save}. */
  static async load(dir: string): Promise<VectorIndex> {
    const meta: Meta = JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8'));
    if (meta.version !== META_VERSION) {
      throw new Error(`Unsupported index version ${meta.version} (expected ${META_VERSION})`);
    }
    const embedder = await Embedder.create(meta.model);
    if (embedder.dimensions !== meta.dimensions) {
      throw new Error(
        `Model "${meta.model}" produces ${embedder.dimensions}-dim vectors but index was built with ${meta.dimensions}`,
      );
    }
    const hnsw = new HierarchicalNSW('cosine', meta.dimensions);
    await hnsw.readIndex(path.join(dir, INDEX_FILE));
    const chunks = new Map<number, ChunkRecord>(
      Object.entries(meta.chunks).map(([label, record]) => [Number(label), record]),
    );
    return new VectorIndex(
      embedder,
      hnsw,
      meta.chunkSize,
      meta.chunkOverlap,
      meta.capacity,
      meta.nextLabel,
      new Map(Object.entries(meta.docs)),
      chunks,
    );
  }

  /** Number of documents in the index. */
  get size(): number {
    return this.docs.size;
  }

  /** The embedding model id this index was built with. */
  get model(): string {
    return this.embedder.model;
  }

  /** Add documents. Re-adding an existing id replaces the previous version. */
  async add(documents: Document | Document[]): Promise<void> {
    const docs = Array.isArray(documents) ? documents : [documents];
    for (const doc of docs) {
      if (this.docs.has(doc.id)) this.remove(doc.id);

      const pieces = chunkText(doc.text, {
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
      });
      if (pieces.length === 0) continue;

      const vectors = await this.embedder.embed(pieces);
      const labels: number[] = [];
      for (let i = 0; i < pieces.length; i++) {
        const label = this.nextLabel++;
        this.ensureCapacity();
        this.hnsw.addPoint(vectors[i], label);
        this.chunks.set(label, { docId: doc.id, chunkIndex: i, text: pieces[i] });
        labels.push(label);
      }
      this.docs.set(doc.id, { labels, metadata: doc.metadata });
    }
  }

  /** Remove a document. Returns false if the id was not in the index. */
  remove(id: string): boolean {
    const record = this.docs.get(id);
    if (!record) return false;
    for (const label of record.labels) {
      this.hnsw.markDelete(label);
      this.chunks.delete(label);
    }
    this.docs.delete(id);
    return true;
  }

  /** Search for the documents most similar to `query`. Returns the best-matching chunk per document. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const k = options.k ?? 5;
    if (this.docs.size === 0) return [];

    const vector = await this.embedder.embedOne(query);
    // Over-fetch so that k distinct documents survive per-document deduplication.
    const fetchK = Math.min(k * 4, this.chunks.size);
    const { neighbors, distances } = this.hnsw.searchKnn(vector, fetchK);

    const best = new Map<string, SearchHit>();
    for (let i = 0; i < neighbors.length; i++) {
      const chunk = this.chunks.get(neighbors[i]);
      if (!chunk) continue;
      const score = 1 - distances[i]; // cosine distance -> similarity
      const existing = best.get(chunk.docId);
      if (!existing || score > existing.score) {
        best.set(chunk.docId, {
          id: chunk.docId,
          score,
          chunk: chunk.text,
          chunkIndex: chunk.chunkIndex,
          metadata: this.docs.get(chunk.docId)?.metadata,
        });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Persist the index to a directory (created if missing). */
  async save(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const meta: Meta = {
      version: META_VERSION,
      model: this.embedder.model,
      dimensions: this.embedder.dimensions,
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      capacity: this.capacity,
      nextLabel: this.nextLabel,
      docs: Object.fromEntries(this.docs),
      chunks: Object.fromEntries(
        [...this.chunks.entries()].map(([label, record]) => [String(label), record]),
      ),
    };
    await this.hnsw.writeIndex(path.join(dir, INDEX_FILE));
    await writeFile(path.join(dir, META_FILE), JSON.stringify(meta), 'utf8');
  }

  private ensureCapacity(): void {
    if (this.nextLabel > this.capacity) {
      this.capacity = Math.max(this.capacity * 2, this.nextLabel);
      this.hnsw.resizeIndex(this.capacity);
    }
  }
}
