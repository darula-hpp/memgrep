import type { ChatInput, MemoryStore } from './store.js';
import { claudeSource, parseClaudeTranscript } from './sources/claude.js';
import { cursorSource, parseCursorTranscript } from './sources/cursor.js';
import { kiroSource, parseKiroSession } from './sources/kiro.js';
import type { TranscriptSource } from './sources/types.js';

export { claudeSource, cursorSource, kiroSource };
export type { TranscriptSource };
/** @deprecated Use parseCursorTranscript. */
export const parseTranscript = parseCursorTranscript;
export { parseCursorTranscript, parseClaudeTranscript, parseKiroSession };

export const ALL_SOURCES = ['cursor', 'claude', 'kiro'] as const;
export type SourceName = (typeof ALL_SOURCES)[number];

export interface IngestResult {
  scanned: number;
  added: number;
  skipped: number;
  bySource: Record<string, number>;
}

export function buildSources(names?: readonly string[]): TranscriptSource[] {
  const wanted = names && names.length > 0 ? names : ALL_SOURCES;
  const factories: Record<string, () => TranscriptSource> = {
    cursor: () => cursorSource(),
    claude: () => claudeSource(),
    kiro: () => kiroSource(),
  };
  return wanted.map((name) => {
    const factory = factories[name];
    if (!factory) {
      throw new Error(`Unknown source "${name}". Available: ${Object.keys(factories).join(', ')}`);
    }
    return factory();
  });
}

/**
 * Ingest chat history from the given sources (default: every supported tool
 * found on this machine). Idempotent: unchanged chats are skipped by hash.
 */
export async function ingestTranscripts(
  store: MemoryStore,
  sources: TranscriptSource[] = buildSources(),
  onProgress?: (message: string) => void,
): Promise<IngestResult> {
  const result: IngestResult = { scanned: 0, added: 0, skipped: 0, bySource: {} };
  for (const source of sources) {
    for await (const chat of source.scan()) {
      result.scanned++;
      const id = await store.addChat(chat);
      if (id === null) {
        result.skipped++;
      } else {
        result.added++;
        result.bySource[source.name] = (result.bySource[source.name] ?? 0) + 1;
        onProgress?.(`+ [${source.name}] ${chat.title}`);
      }
    }
  }
  return result;
}

/** @deprecated Use ingestTranscripts with buildSources(['cursor']). */
export async function ingestCursorTranscripts(
  store: MemoryStore,
  projectsDir?: string,
  onProgress?: (message: string) => void,
): Promise<IngestResult> {
  return ingestTranscripts(store, [cursorSource(projectsDir)], onProgress);
}

export interface CandidateChat extends ChatInput {
  sourceName: string;
}

/** Scan all sources and return every chat found, most recently active first. */
export async function collectChats(
  sources: TranscriptSource[] = buildSources(),
): Promise<CandidateChat[]> {
  const chats: CandidateChat[] = [];
  for (const source of sources) {
    for await (const chat of source.scan()) {
      chats.push({ ...chat, sourceName: source.name });
    }
  }
  return chats.sort((a, b) =>
    (b.modifiedAt ?? b.createdAt ?? '').localeCompare(a.modifiedAt ?? a.createdAt ?? ''),
  );
}

/** Ingest an explicit list of chats (e.g. a recency- or user-selected subset). */
export async function ingestChats(
  store: MemoryStore,
  chats: CandidateChat[],
  onProgress?: (message: string) => void,
): Promise<IngestResult> {
  const result: IngestResult = { scanned: chats.length, added: 0, skipped: 0, bySource: {} };
  for (const chat of chats) {
    const id = await store.addChat(chat);
    if (id === null) {
      result.skipped++;
      onProgress?.(`= unchanged [${chat.sourceName}] ${chat.title}`);
    } else {
      result.added++;
      result.bySource[chat.sourceName] = (result.bySource[chat.sourceName] ?? 0) + 1;
      onProgress?.(`+ added as chat ${id} [${chat.sourceName}] ${chat.title}`);
    }
  }
  return result;
}

export interface IngestFileOverrides {
  title?: string;
  project?: string;
}

/**
 * Ingest a single chat file, auto-detecting its format:
 * Cursor JSONL, Claude Code JSONL, Kiro session JSON, or plain text/markdown.
 * Returns the chat id, or null when the store already has identical content.
 */
export async function ingestFile(
  store: MemoryStore,
  filePath: string,
  overrides: IngestFileOverrides = {},
): Promise<{ id: number | null; tool: string }> {
  const { readFile, stat } = await import('node:fs/promises');
  const path = await import('node:path');

  const absolute = path.resolve(filePath);
  const raw = await readFile(absolute, 'utf8');
  const detected = detectAndParse(raw);
  if (!detected) {
    throw new Error(`Could not extract any conversation from ${filePath}`);
  }

  const info = await stat(absolute);
  const id = await store.addChat({
    title: overrides.title ?? detected.title,
    project: overrides.project ?? detected.project ?? path.basename(path.dirname(absolute)),
    content: detected.content,
    source: absolute,
    tool: detected.tool,
    createdAt: detected.createdAt ?? info.birthtime.toISOString(),
  });
  return { id, tool: detected.tool };
}

interface DetectedChat {
  tool: string;
  title: string;
  content: string;
  project?: string;
  createdAt?: string;
}

function detectAndParse(raw: string): DetectedChat | null {
  // 1. Whole file is one JSON object with a history array -> Kiro session.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && Array.isArray(obj.history)) {
      const parsed = parseKiroSession(obj);
      return parsed ? { tool: 'kiro', ...parsed } : null;
    }
  } catch {
    // not a single JSON document
  }

  // 2. JSONL: sniff the first parseable line to tell Cursor from Claude Code.
  //    Cursor lines carry role at the top level; Claude lines carry type + message.
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: { role?: unknown; type?: unknown; message?: unknown };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      break; // malformed JSON line; treat file as plain text
    }
    if (typeof obj.role === 'string' && obj.message) {
      const parsed = parseCursorTranscript(raw);
      return parsed ? { tool: 'cursor', ...parsed } : null;
    }
    if (typeof obj.type === 'string') {
      const parsed = parseClaudeTranscript(raw);
      return parsed ? { tool: 'claude', ...parsed } : null;
    }
    break; // JSON but unrecognized shape; treat as plain text
  }

  // 3. Anything else: plain text or markdown export.
  const content = raw.trim();
  if (!content) return null;
  const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return { tool: 'import', title, content };
}
