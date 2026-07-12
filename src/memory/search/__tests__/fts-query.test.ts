import { describe, expect, it } from 'vitest';
import {
  buildFtsMatchQuery,
  escapeFtsPhrase,
  isIdentifierToken,
  tokenizeQuery,
} from '../fts-query.js';

describe('tokenizeQuery', () => {
  it('extracts alphanumeric tokens and drops tiny noise', () => {
    expect(tokenizeQuery('fix the auth race for merchant 7712')).toEqual([
      'fix',
      'the',
      'auth',
      'race',
      'for',
      'merchant',
      '7712',
    ]);
  });

  it('returns empty for punctuation-only input', () => {
    expect(tokenizeQuery('   !!!   ')).toEqual([]);
  });
});

describe('isIdentifierToken', () => {
  it('detects numeric ids, error codes, tickets, and hashes', () => {
    expect(isIdentifierToken('7712')).toBe(true);
    expect(isIdentifierToken('ECONNREFUSED')).toBe(true);
    expect(isIdentifierToken('ERR_TIMEOUT')).toBe(true);
    expect(isIdentifierToken('ABC_123')).toBe(true);
    expect(isIdentifierToken('#42')).toBe(true);
    expect(isIdentifierToken('a1b2c3d')).toBe(true);
    expect(isIdentifierToken('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects ordinary words', () => {
    expect(isIdentifierToken('login')).toBe(false);
    expect(isIdentifierToken('authentication')).toBe(false);
    expect(isIdentifierToken('12')).toBe(false); // too short for numeric id rule (need 3+)
  });
});

describe('escapeFtsPhrase', () => {
  it('doubles embedded quotes', () => {
    expect(escapeFtsPhrase('say "hi"')).toBe('say ""hi""');
  });
});

describe('buildFtsMatchQuery', () => {
  it('quotes identifier tokens and OR-joins terms', () => {
    const match = buildFtsMatchQuery('merchant 7712 ECONNREFUSED login');
    expect(match).toContain('"7712"');
    expect(match).toContain('"ECONNREFUSED"');
    expect(match).toContain('merchant');
    expect(match).toContain('login');
    expect(match?.split(' OR ')).toHaveLength(4);
  });

  it('returns null when nothing searchable remains', () => {
    expect(buildFtsMatchQuery('!')).toBeNull();
    expect(buildFtsMatchQuery('')).toBeNull();
  });
});
