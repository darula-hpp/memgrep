export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface SearchHit {
  /** Document id the matched chunk belongs to. */
  id: string;
  /** Cosine similarity in [0, 1] (higher is more similar). */
  score: number;
  /** The chunk of text that matched the query. */
  chunk: string;
  /** Index of the matched chunk within the document. */
  chunkIndex: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  /** Number of documents to return. Default 5. */
  k?: number;
}

export interface ChunkOptions {
  /** Target chunk size in characters. Default 1000. */
  chunkSize?: number;
  /** Overlap between consecutive chunks in characters. Default 200. */
  chunkOverlap?: number;
}

export interface CreateOptions extends ChunkOptions {
  /** Hugging Face model id for embeddings. Default "Xenova/all-MiniLM-L6-v2". */
  model?: string;
  /** Initial index capacity (grows automatically). Default 1024. */
  initialCapacity?: number;
}
