export { VectorIndex } from './vector-index.js';
export { chunkText } from './chunker.js';
export { Embedder, DEFAULT_MODEL } from './embedder.js';
export { MemoryStore, defaultHome } from './memory/store.js';
export {
  ingestTranscripts,
  ingestFile,
  ingestChats,
  collectChats,
  buildSources,
  cursorSource,
  claudeSource,
  kiroSource,
  parseCursorTranscript,
  parseClaudeTranscript,
  parseKiroSession,
  ALL_SOURCES,
} from './memory/ingest.js';
export type { TranscriptSource, SourceName, IngestResult } from './memory/ingest.js';
export type { ChatInput, ChatSummary, ChatRecord, MemoryHit } from './memory/store.js';
export type { SearchMode } from './memory/search/index.js';
export type { SearchOptions as MemorySearchOptions } from './memory/search/index.js';
export type {
  Document,
  SearchHit,
  SearchOptions,
  ChunkOptions,
  CreateOptions,
} from './types.js';
