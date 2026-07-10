import { describe, expect, it } from 'vitest';
import { CliError } from '../lib/errors.js';
import { resolveIngestMode } from '../commands/ingest-mode.js';

describe('resolveIngestMode', () => {
  it('resolves --pick with indices to pick-from-scan', () => {
    expect(
      resolveIngestMode({
        pick: '2,5',
        pickProvided: true,
        lastProvided: false,
        paths: [],
      }),
    ).toEqual({ kind: 'pick-from-scan', picks: [2, 5] });
  });

  it('resolves bare --pick to interactive-pick', () => {
    expect(
      resolveIngestMode({
        pickProvided: true,
        lastProvided: false,
        paths: [],
        sources: ['cursor'],
      }),
    ).toEqual({ kind: 'interactive-pick', sources: ['cursor'] });
  });

  it('resolves --last to last mode with default n=1', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        lastProvided: true,
        paths: [],
      }),
    ).toEqual({ kind: 'last', n: 1, sources: undefined });
  });

  it('resolves --last 3 to last mode with n=3', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        last: '3',
        lastProvided: true,
        paths: [],
        sources: ['kiro'],
      }),
    ).toEqual({ kind: 'last', n: 3, sources: ['kiro'] });
  });

  it('resolves file paths to files mode', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        lastProvided: false,
        paths: ['a.jsonl', 'b.jsonl'],
        title: 't',
        project: 'p',
      }),
    ).toEqual({
      kind: 'files',
      paths: ['a.jsonl', 'b.jsonl'],
      title: 't',
      project: 'p',
    });
  });

  it('resolves bare ingest to all mode', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        lastProvided: false,
        paths: [],
        sources: ['cursor', 'claude'],
      }),
    ).toEqual({ kind: 'all', sources: ['cursor', 'claude'] });
  });

  it('rejects --pick combined with --last', () => {
    expect(() =>
      resolveIngestMode({
        pick: '1',
        pickProvided: true,
        lastProvided: true,
        paths: [],
      }),
    ).toThrow(CliError);
  });

  it('rejects --pick combined with file paths', () => {
    expect(() =>
      resolveIngestMode({
        pickProvided: true,
        lastProvided: false,
        paths: ['a.jsonl'],
      }),
    ).toThrow(CliError);
  });

  it('rejects --last combined with file paths', () => {
    expect(() =>
      resolveIngestMode({
        pickProvided: false,
        lastProvided: true,
        paths: ['a.jsonl'],
      }),
    ).toThrow(CliError);
  });

  it('rejects --title with --pick', () => {
    expect(() =>
      resolveIngestMode({
        pick: '1',
        pickProvided: true,
        lastProvided: false,
        paths: [],
        title: 'x',
      }),
    ).toThrow(CliError);
  });

  it('rejects invalid --pick values', () => {
    expect(() =>
      resolveIngestMode({
        pick: 'nope',
        pickProvided: true,
        lastProvided: false,
        paths: [],
      }),
    ).toThrow(CliError);
  });

  it('treats empty --pick string as interactive-pick', () => {
    expect(
      resolveIngestMode({
        pick: '',
        pickProvided: true,
        lastProvided: false,
        paths: [],
      }),
    ).toEqual({ kind: 'interactive-pick', sources: undefined });
  });

  it('clamps --last 0 up to 1', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        last: '0',
        lastProvided: true,
        paths: [],
      }),
    ).toEqual({ kind: 'last', n: 1, sources: undefined });
  });

  it('allows --title/--project with file paths', () => {
    expect(
      resolveIngestMode({
        pickProvided: false,
        lastProvided: false,
        paths: ['chat.jsonl'],
        title: 'note',
        project: 'app',
      }),
    ).toMatchObject({ kind: 'files', title: 'note', project: 'app' });
  });

  it('rejects --project with --last', () => {
    expect(() =>
      resolveIngestMode({
        pickProvided: false,
        lastProvided: true,
        last: '2',
        paths: [],
        project: 'app',
      }),
    ).toThrow(CliError);
  });
});
