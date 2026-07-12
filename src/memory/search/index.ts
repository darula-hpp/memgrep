export type { SearchMode, SearchOptions, RankedChatHit, SearchBackend } from './types.js';
export { buildFtsMatchQuery, escapeFtsPhrase, isIdentifierToken, tokenizeQuery } from './fts-query.js';
export { ensureChunksFts } from './fts-schema.js';
export { FtsSearchBackend } from './fts-backend.js';
export { VectorSearchBackend } from './vector-backend.js';
export { HybridSearchBackend } from './hybrid-backend.js';
export { reciprocalRankFusion, RRF_K } from './rrf.js';
