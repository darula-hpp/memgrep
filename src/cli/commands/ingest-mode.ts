import { fail } from '../lib/errors.js';

export type IngestMode =
  | { kind: 'pick-from-scan'; picks: number[] }
  | { kind: 'interactive-pick'; sources?: string[] }
  | { kind: 'last'; n: number; sources?: string[] }
  | { kind: 'files'; paths: string[]; title?: string; project?: string }
  | { kind: 'all'; sources?: string[] };

export interface IngestModeInput {
  /** Present when --pick was passed; undefined value means bare --pick (interactive). */
  pick?: string;
  pickProvided: boolean;
  /** Present when --last was passed; undefined value means bare --last (default 1). */
  last?: string;
  lastProvided: boolean;
  paths: string[];
  sources?: string[];
  title?: string;
  project?: string;
}

/**
 * Resolve ingest mode from CLI options.
 *
 * Priority (same as historical behavior, with explicit conflict errors):
 * 1. --pick <nums> → pick-from-scan
 * 2. bare --pick → interactive-pick
 * 3. --last → last
 * 4. positional file paths → files
 * 5. else → all
 */
export function resolveIngestMode(input: IngestModeInput): IngestMode {
  const { pickProvided, lastProvided, paths, sources, title, project } = input;

  if (pickProvided && lastProvided) {
    fail('Cannot combine --pick and --last. Use one ingest mode at a time.');
  }
  if (pickProvided && paths.length > 0) {
    fail('Cannot combine --pick with file paths. Use one ingest mode at a time.');
  }
  if (lastProvided && paths.length > 0) {
    fail('Cannot combine --last with file paths. Use one ingest mode at a time.');
  }
  if ((title !== undefined || project !== undefined) && (pickProvided || lastProvided)) {
    fail('--title / --project only apply when ingesting specific files.');
  }

  if (pickProvided) {
    if (input.pick !== undefined && input.pick !== '') {
      const picks = input.pick
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1);
      if (picks.length === 0) {
        fail(`Invalid --pick "${input.pick}". Use numbers like 2,5 from the last scan.`);
      }
      return { kind: 'pick-from-scan', picks };
    }
    return { kind: 'interactive-pick', sources };
  }

  if (lastProvided) {
    const n = Math.max(1, Number(input.last) || 1);
    return { kind: 'last', n, sources };
  }

  if (paths.length > 0) {
    return { kind: 'files', paths, title, project };
  }

  return { kind: 'all', sources };
}
