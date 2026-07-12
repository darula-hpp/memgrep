import { describe, expect, it } from 'vitest';
import {
  extractCursorAgentIdFromSource,
  guessCursorAgentIdFromSource,
  normalizeCursorAgentId,
} from '../cursor-agent-id.js';

describe('cursor agent id helpers', () => {
  it('extracts SDK-style folder names', () => {
    expect(
      extractCursorAgentIdFromSource(
        '/Users/x/.cursor/projects/foo/agent-transcripts/agent-dc0cf69f-baa3-4c52-9207-fcaf3724a08f/agent-dc0cf69f-baa3-4c52-9207-fcaf3724a08f.jsonl',
      ),
    ).toBe('agent-dc0cf69f-baa3-4c52-9207-fcaf3724a08f');
  });

  it('ignores bare UUID folders for confident extract', () => {
    expect(
      extractCursorAgentIdFromSource(
        '/Users/x/.cursor/projects/foo/agent-transcripts/85e797e1-a0f2-44d3-8a41-0d5c84f677a9/85e797e1-a0f2-44d3-8a41-0d5c84f677a9.jsonl',
      ),
    ).toBeUndefined();
  });

  it('guesses agent- prefix for bare UUID folders', () => {
    expect(
      guessCursorAgentIdFromSource(
        '/Users/x/.cursor/projects/foo/agent-transcripts/85e797e1-a0f2-44d3-8a41-0d5c84f677a9/85e797e1-a0f2-44d3-8a41-0d5c84f677a9.jsonl',
      ),
    ).toBe('agent-85e797e1-a0f2-44d3-8a41-0d5c84f677a9');
  });

  it('normalizes bare uuids', () => {
    expect(normalizeCursorAgentId('85e797e1-a0f2-44d3-8a41-0d5c84f677a9')).toBe(
      'agent-85e797e1-a0f2-44d3-8a41-0d5c84f677a9',
    );
  });
});
