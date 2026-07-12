/**
 * Build a safe FTS5 MATCH expression from a free-text user query.
 *
 * Identifier-like tokens (ticket ids, error codes, numeric ids, hashes) are
 * quoted for exact matching. Tokens with FTS-special characters are also
 * quoted so `-` is not interpreted as NOT. Regular words stay bare so Porter
 * stemming still applies. Terms are OR-combined so a single exact id in a
 * longer query still hits.
 */

/** Escape a string for use inside an FTS5 double-quoted phrase. */
export function escapeFtsPhrase(text: string): string {
  return text.replace(/"/g, '""');
}

export function isIdentifierToken(token: string): boolean {
  if (token.length < 2) return false;
  // Numeric ids (merchant 7712)
  if (/^\d{3,}$/.test(token)) return true;
  // Ticket-style #42
  if (/^#\d+$/.test(token)) return true;
  // UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return true;
  }
  // Hex / short hashes (require a digit so plain words do not match)
  if (/^[0-9a-f]{7,}$/i.test(token) && /\d/.test(token)) return true;
  // SCREAMING codes: ECONNREFUSED, ERR_TIMEOUT, ENOENT
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(token) && token.length >= 4) return true;
  // Letter+digits codes: ABC123, err12
  if (/^[A-Za-z]{2,}\d+$/.test(token)) return true;
  return false;
}

/** Characters that change FTS5 MATCH meaning if left bare. */
function hasFtsSpecialChars(token: string): boolean {
  return /[^A-Za-z0-9_]/.test(token);
}

const FTS_TOKEN = /[A-Za-z0-9_#.-]+/g;

export function tokenizeQuery(query: string): string[] {
  const matches = query.match(FTS_TOKEN);
  if (!matches) return [];
  // Drop tiny noise tokens that only hurt OR queries ("a", "to", …).
  return matches.filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

/**
 * Convert a user query into an FTS5 MATCH string, or `null` when nothing
 * searchable remains (caller should skip keyword search).
 */
export function buildFtsMatchQuery(query: string): string | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return null;

  const terms = tokens.map((token) => {
    if (isIdentifierToken(token) || hasFtsSpecialChars(token)) {
      return `"${escapeFtsPhrase(token)}"`;
    }
    return token;
  });

  return terms.join(' OR ');
}
