import { describe, expect, it } from 'vitest';
import { CliError, fail } from '../lib/errors.js';
import {
  formatListLine,
  formatRecallHit,
  formatScanLine,
  formatScanMark,
  formatWhen,
  parsePickIndices,
  parseSourceList,
} from '../lib/format.js';

describe('CliError', () => {
  it('defaults exitCode to 1', () => {
    const err = new CliError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('boom');
    expect(err.exitCode).toBe(1);
  });

  it('fail throws CliError with custom exit code', () => {
    expect(() => fail('nope', 2)).toThrow(CliError);
    try {
      fail('nope', 2);
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(2);
    }
  });
});

describe('format helpers', () => {
  it('formatWhen truncates and replaces T', () => {
    expect(formatWhen('2026-07-10T21:54:00.000Z')).toBe('2026-07-10 21:54');
    expect(formatWhen(undefined)).toBe('');
  });

  it('formatScanMark returns status markers', () => {
    expect(formatScanMark('ingested')).toBe(' ');
    expect(formatScanMark('changed')).toContain('~');
    expect(formatScanMark('new')).toContain('*');
  });

  it('formatScanLine pads index and truncates title', () => {
    const long = 'x'.repeat(80);
    const line = formatScanLine(3, '*', long, 'cursor', 'proj', '2026-07-10 12:00');
    expect(line.startsWith(' 3. * ')).toBe(true);
    expect(line).toContain('(cursor/proj, 2026-07-10 12:00)');
    expect(line).toContain('x'.repeat(66));
    expect(line).not.toContain('x'.repeat(67));
  });

  it('formatListLine includes id, title, and meta', () => {
    expect(
      formatListLine({
        id: 42,
        title: 'hello',
        tool: 'cursor',
        project: 'dev-project',
        createdAt: '2026-07-10T00:00:00.000Z',
        chars: 120,
      }),
    ).toBe('[42] hello  (cursor/dev-project, 2026-07-10, 120 chars)');
  });

  it('formatRecallHit includes score and truncates snippet', () => {
    const hit = {
      id: 7,
      title: 'auth race',
      tool: 'cursor',
      project: 'app',
      createdAt: '2026-07-01T12:00:00.000Z',
      score: 0.42,
      snippet: 'fixed the auth race  '.repeat(20),
    };
    const top = formatRecallHit(hit, true);
    const rest = formatRecallHit(hit, false);
    expect(top.header).toContain('auth race');
    expect(top.header).toContain('0.420');
    expect(rest.header).toContain('[7]');
    const plainSnippet = top.snippet.replace(/\x1b\[[0-9;]*m/g, '').trim();
    expect(plainSnippet.length).toBeLessThanOrEqual(200);
  });

  it('parseSourceList splits and trims', () => {
    expect(parseSourceList(undefined)).toBeUndefined();
    expect(parseSourceList('')).toBeUndefined();
    expect(parseSourceList('cursor, claude,kiro')).toEqual(['cursor', 'claude', 'kiro']);
  });

  it('parsePickIndices converts 1-based picks and drops invalids', () => {
    expect(parsePickIndices('1,3', 5)).toEqual([0, 2]);
    expect(parsePickIndices('0,99,2', 3)).toEqual([1]);
    expect(parsePickIndices('nope', 5)).toEqual([]);
  });
});
