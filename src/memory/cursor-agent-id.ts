/**
 * Derive a Cursor SDK agent id from an ingested transcript path.
 *
 * Paths look like:
 *   .../agent-transcripts/<id>/<id>.jsonl
 * where <id> is either `agent-<uuid>` (SDK/Telegram) or a bare UUID (IDE).
 */

/** Confident match: folder already uses the SDK `agent-` prefix. */
export function extractCursorAgentIdFromSource(
  source: string | null | undefined,
): string | undefined {
  if (!source) return undefined;
  const match = source.replace(/\\/g, '/').match(/agent-transcripts\/([^/]+)\//i);
  const id = match?.[1]?.trim();
  if (!id) return undefined;
  return id.startsWith('agent-') ? id : undefined;
}

/**
 * Best-effort id for resume attempts. Bare UUID folders are tried as
 * `agent-<uuid>` (may fail — caller should fall back to inject).
 */
export function guessCursorAgentIdFromSource(
  source: string | null | undefined,
): string | undefined {
  const confident = extractCursorAgentIdFromSource(source);
  if (confident) return confident;
  if (!source) return undefined;
  const match = source.replace(/\\/g, '/').match(/agent-transcripts\/([^/]+)\//i);
  const id = match?.[1]?.trim();
  if (!id) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return `agent-${id}`;
  }
  return undefined;
}

/** Normalize user/store values to a canonical SDK agent id when possible. */
export function normalizeCursorAgentId(raw: string | null | undefined): string | undefined {
  const id = raw?.trim();
  if (!id) return undefined;
  if (id.startsWith('agent-')) return id;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return `agent-${id}`;
  }
  return id;
}
