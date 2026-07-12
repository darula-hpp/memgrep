import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseClaudeTranscript, parseCursorTranscript, parseKiroSession } from '../ingest.js';
import { MemoryStore } from '../store.js';

describe('parseCursorTranscript', () => {
  it('extracts user queries and assistant text, ignoring tool calls', () => {
    const lines = [
      JSON.stringify({
        role: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<user_info>\nOS: mac\n</user_info>\n<user_query>\nhow do I fix the auth bug?\n</user_query>',
            },
          ],
        },
      }),
      JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'The bug is a race condition in the token refresh.' },
            { type: 'tool_use', name: 'Shell', input: { command: 'ls' } },
          ],
        },
      }),
      JSON.stringify({ type: 'turn_ended', status: 'done' }),
    ].join('\n');

    const parsed = parseCursorTranscript(lines);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('how do I fix the auth bug?');
    expect(parsed!.content).toContain('User: how do I fix the auth bug?');
    expect(parsed!.content).toContain('Assistant: The bug is a race condition');
    expect(parsed!.content).not.toContain('tool_use');
    expect(parsed!.content).not.toContain('user_info');
  });

  it('returns null for empty transcripts', () => {
    expect(parseCursorTranscript('')).toBeNull();
    expect(parseCursorTranscript(JSON.stringify({ type: 'turn_ended' }))).toBeNull();
  });
});

describe('parseClaudeTranscript', () => {
  it('extracts turns, project, and date from Claude Code sessions', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        cwd: '/Users/jane/dev/my-app',
        timestamp: '2026-06-24T06:24:56.222Z',
        message: { role: 'user', content: 'deploy the staging environment' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Deployed via the GitHub Action.' }] },
      }),
      JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'sidechain noise' } }),
    ].join('\n');

    const parsed = parseClaudeTranscript(lines);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('deploy the staging environment');
    expect(parsed!.project).toBe('my-app');
    expect(parsed!.createdAt).toBe('2026-06-24T06:24:56.222Z');
    expect(parsed!.content).toContain('Assistant: Deployed via the GitHub Action.');
    expect(parsed!.content).not.toContain('sidechain noise');
  });
});

describe('ingestFile format detection', () => {
  let dir: string;
  let store: MemoryStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'memgrep-ingest-'));
    store = await MemoryStore.open(dir);
  }, 300_000);

  afterAll(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('detects Cursor JSONL and plain markdown', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { ingestFile } = await import('../ingest.js');

    const cursorFile = path.join(dir, 'chat.jsonl');
    await writeFile(
      cursorFile,
      JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: '<user_query>fix the flaky test</user_query>' }] },
      }) +
        '\n' +
        JSON.stringify({
          role: 'assistant',
          message: { content: [{ type: 'text', text: 'The test raced the server startup; added a wait.' }] },
        }),
    );
    const cursor = await ingestFile(store, cursorFile);
    expect(cursor.tool).toBe('cursor');
    expect(cursor.id).not.toBeNull();

    const mdFile = path.join(dir, 'notes.md');
    await writeFile(mdFile, '# Postgres tuning notes\n\nWe raised shared_buffers to 4GB.');
    const md = await ingestFile(store, mdFile, { project: 'infra' });
    expect(md.tool).toBe('import');
    expect(md.id).not.toBeNull();
    expect(store.getChat(md.id!)?.title).toBe('Postgres tuning notes');
    expect(store.getChat(md.id!)?.project).toBe('infra');

    expect((await ingestFile(store, mdFile, { project: 'infra' })).id).toBeNull();
  });
});

describe('parseKiroSession', () => {
  it('extracts user turns and session title, dropping stub replies', () => {
    const parsed = parseKiroSession({
      title: 'wire up payments',
      workspacePath: '/Users/jane/dev/shop',
      history: [
        { message: { role: 'user', content: [{ type: 'text', text: 'add stripe checkout' }] } },
        { message: { role: 'assistant', content: 'On it.' } },
        { message: { role: 'assistant', content: 'Added checkout session endpoint.' } },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('wire up payments');
    expect(parsed!.project).toBe('shop');
    expect(parsed!.content).toContain('User: add stripe checkout');
    expect(parsed!.content).toContain('Assistant: Added checkout session endpoint.');
    expect(parsed!.content).not.toContain('On it.');
  });

  it('returns null for sessions with no usable turns', () => {
    expect(parseKiroSession({ history: [] })).toBeNull();
    expect(parseKiroSession({})).toBeNull();
  });
});

describe('MemoryStore', () => {
  let dir: string;
  let store: MemoryStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'memgrep-mem-'));
    store = await MemoryStore.open(dir);
  }, 300_000);

  afterAll(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('adds, lists, and searches chats across projects', async () => {
    await store.addChat({
      title: 'Fix auth race condition',
      project: 'api',
      content:
        'User: the login randomly fails\n\nAssistant: The token refresh has a race condition; we fixed it with a mutex around refresh.',
    });
    await store.addChat({
      title: 'Set up CI pipeline',
      project: 'web',
      content:
        'User: add github actions\n\nAssistant: Created a workflow that runs vitest and deploys on tag push.',
    });

    expect(store.listChats()).toHaveLength(2);
    expect(store.listChats('api')).toHaveLength(1);

    const hits = await store.search('login authentication failing intermittently', 2);
    expect(hits[0].title).toBe('Fix auth race condition');
    expect(hits[0].project).toBe('api');
  });

  it('hybrid search finds exact ids that vector-only may miss', async () => {
    const id = (await store.addChat({
      title: 'Acquirer timeout for merchant 7712',
      project: 'payments',
      content:
        'User: checkout fails for merchant 7712\n\nAssistant: The acquirer returned ECONNREFUSED on the settlement endpoint for merchant 7712 only.',
    }))!;

    const keywordHits = await store.search('7712', 3, { mode: 'keyword' });
    expect(keywordHits[0].id).toBe(id);
    expect(keywordHits[0].snippet).toMatch(/7712/);

    const hybridHits = await store.search('merchant 7712 ECONNREFUSED', 3);
    expect(hybridHits[0].id).toBe(id);

    const codeHits = await store.search('ECONNREFUSED', 3, { mode: 'keyword' });
    expect(codeHits[0].id).toBe(id);
  });

  it('skips unchanged content on re-add (idempotent ingest)', async () => {
    const input = {
      title: 'Fix auth race condition',
      project: 'api',
      content:
        'User: the login randomly fails\n\nAssistant: The token refresh has a race condition; we fixed it with a mutex around refresh.',
    };
    expect(await store.addChat(input)).toBeNull();
    // auth + CI + merchant incident from the hybrid test
    expect(store.listChats()).toHaveLength(3);
  });

  it('deletes chats and excludes them from search', async () => {
    const id = (await store.addChat({
      title: 'Volcano notes',
      project: 'geo',
      content: 'Assistant: Volcanoes erupt molten lava from deep underground magma chambers.',
    }))!;
    expect(store.deleteChat(id)).toBe(true);
    expect(store.deleteChat(id)).toBe(false);
    const hits = await store.search('lava eruption magma', 3);
    expect(hits.map((h) => h.id)).not.toContain(id);
  });

  it('deleteAll empties the store and search returns nothing', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'memgrep-wipe-'));
    const s = await MemoryStore.open(scratch);
    await s.addChat({ title: 'a', project: 'p', content: 'Assistant: alpha beta gamma content here.' });
    await s.addChat({ title: 'b', project: 'p', content: 'Assistant: delta epsilon zeta content here.' });
    expect(s.deleteAll()).toBe(2);
    expect(s.listChats()).toHaveLength(0);
    expect(await s.search('alpha beta', 3)).toHaveLength(0);
    const id = await s.addChat({ title: 'c', project: 'p', content: 'Assistant: fresh start after wipe.' });
    expect(id).not.toBeNull();
    s.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it('persists and reopens with a rebuilt or loaded index', async () => {
    await store.persist();
    store.close();
    store = await MemoryStore.open(dir);
    expect(store.listChats()).toHaveLength(3);
    const hits = await store.search('continuous integration github', 1);
    expect(hits[0].title).toBe('Set up CI pipeline');
    // FTS backfill on reopen still finds exact ids
    const idHits = await store.search('7712', 1, { mode: 'keyword' });
    expect(idHits[0].title).toContain('7712');
  }, 120_000);
});
