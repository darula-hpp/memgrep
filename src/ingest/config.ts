import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { ALL_SOURCES, type SourceName } from '../memory/ingest.js';
import { defaultHome } from '../memory/store.js';

export const INGEST_CONFIG_FILE = 'ingest.json';
/** Default background ingest interval: 1 hour. */
export const DEFAULT_INGEST_INTERVAL_MS = 60 * 60_000;
export const MIN_INGEST_INTERVAL_MS = 60_000;

export type IngestDaemonConfig = {
  version: 1;
  /** Sleep between ingest ticks. */
  intervalMs: number;
  /** Optional source filter (cursor, claude, kiro). Omit / empty = all. */
  sources?: SourceName[];
  createdAt: string;
  updatedAt: string;
};

const configSchema = z.object({
  version: z.literal(1),
  intervalMs: z.number().int().positive(),
  sources: z.array(z.enum(ALL_SOURCES)).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function ingestConfigPath(home = defaultHome()): string {
  return path.join(home, INGEST_CONFIG_FILE);
}

/**
 * Parse interval strings like `15m`, `1h`, `3600`, `3600s`.
 * Bare numbers are seconds.
 */
export function parseIntervalMs(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Interval is empty. Use e.g. 15m, 1h, or 3600.');
  }

  const m = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) {
    throw new Error(
      `Invalid interval "${raw}". Use a number with optional unit: ms, s, m, h (e.g. 15m, 1h, 3600).`,
    );
  }

  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid interval "${raw}".`);
  }

  const unit = m[2] ?? 's';
  const ms =
    unit === 'ms'
      ? value
      : unit === 's'
        ? value * 1000
        : unit === 'm'
          ? value * 60_000
          : value * 3_600_000;

  const rounded = Math.round(ms);
  if (rounded < MIN_INGEST_INTERVAL_MS) {
    throw new Error(
      `Interval too short (${raw}). Minimum is ${MIN_INGEST_INTERVAL_MS / 1000}s.`,
    );
  }
  return rounded;
}

export function formatInterval(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function normalizeSources(sources?: string[]): SourceName[] | undefined {
  if (!sources?.length) return undefined;
  const out: SourceName[] = [];
  for (const raw of sources) {
    const name = raw.trim().toLowerCase();
    if (!(ALL_SOURCES as readonly string[]).includes(name)) {
      throw new Error(
        `Unknown source "${raw}". Available: ${ALL_SOURCES.join(', ')}`,
      );
    }
    if (!out.includes(name as SourceName)) out.push(name as SourceName);
  }
  return out.length > 0 ? out : undefined;
}

export function readIngestConfig(home = defaultHome()): IngestDaemonConfig | null {
  const filePath = ingestConfigPath(home);
  if (!existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid ingest config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid ingest config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

export function writeIngestConfig(
  input: {
    intervalMs?: number;
    sources?: string[];
    createdAt?: string;
  },
  home = defaultHome(),
): IngestDaemonConfig {
  const existing = readIngestConfig(home);
  const now = new Date().toISOString();
  const next: IngestDaemonConfig = {
    version: 1,
    intervalMs: input.intervalMs ?? existing?.intervalMs ?? DEFAULT_INGEST_INTERVAL_MS,
    sources: normalizeSources(input.sources) ?? existing?.sources,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (next.intervalMs < MIN_INGEST_INTERVAL_MS) {
    throw new Error(`intervalMs must be >= ${MIN_INGEST_INTERVAL_MS}`);
  }
  writeFileAtomic(ingestConfigPath(home), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

/** Resolve runtime settings: CLI overrides > config file > defaults. */
export function resolveIngestDaemonSettings(options: {
  home?: string;
  interval?: string;
  sources?: string[];
} = {}): { home: string; intervalMs: number; sources?: SourceName[]; configPath: string } {
  const home = options.home ?? defaultHome();
  const file = readIngestConfig(home);
  const intervalMs = options.interval
    ? parseIntervalMs(options.interval)
    : (file?.intervalMs ?? DEFAULT_INGEST_INTERVAL_MS);
  const sources = options.sources?.length
    ? normalizeSources(options.sources)
    : file?.sources;
  return {
    home,
    intervalMs,
    sources,
    configPath: ingestConfigPath(home),
  };
}
