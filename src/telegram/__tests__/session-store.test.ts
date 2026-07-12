import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CursorAgentPool,
  type AgentLifecycle,
  type AgentLifecycleOptions,
} from '../cursor-agent.js';
import {
  clearPersistedAgentId,
  getPersistedAgentId,
  readSessionStore,
  setPersistedAgentId,
  telegramSessionsPath,
} from '../session-store.js';
import type { SDKAgent } from '@cursor/sdk';

describe('session store', () => {
  let home: string;

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('persists and clears agent ids per user+cwd', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-sessions-'));
    expect(getPersistedAgentId(42, '/proj-a', home, 'ppp')).toBeUndefined();

    setPersistedAgentId(42, '/proj-a', 'agent-aaa', home, 'ppp');
    setPersistedAgentId(42, '/proj-b', 'agent-bbb', home, 'ppp');
    setPersistedAgentId(7, '/proj-a', 'agent-other', home, 'ppp');

    expect(getPersistedAgentId(42, '/proj-a', home, 'ppp')).toBe('agent-aaa');
    expect(getPersistedAgentId(42, '/proj-b', home, 'ppp')).toBe('agent-bbb');
    expect(telegramSessionsPath(home, 'ppp')).toContain('ppp.sessions.json');

    clearPersistedAgentId(42, '/proj-a', home, 'ppp');
    expect(getPersistedAgentId(42, '/proj-a', home, 'ppp')).toBeUndefined();
    expect(getPersistedAgentId(42, '/proj-b', home, 'ppp')).toBe('agent-bbb');
    expect(getPersistedAgentId(7, '/proj-a', home, 'ppp')).toBe('agent-other');

    const store = readSessionStore(home, 'ppp');
    expect(store.byUser['42']?.['/proj-b']?.agentId).toBe('agent-bbb');
  });
});

function fakeAgent(id: string): SDKAgent {
  return {
    agentId: id,
    model: undefined,
    send: vi.fn(async () => ({
      id: `run-${id}`,
      agentId: id,
      status: 'finished' as const,
      wait: async () => ({ id: `run-${id}`, status: 'finished' as const, result: `ok:${id}` }),
      cancel: async () => {},
      supports: () => true,
      unsupportedReason: () => undefined,
      stream: async function* () {},
      conversation: async () => [],
      onDidChangeStatus: () => () => {},
    })),
    close: () => {},
    reload: async () => {},
    [Symbol.asyncDispose]: async () => {},
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
  } as unknown as SDKAgent;
}

describe('CursorAgentPool resume', () => {
  let home: string;

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('resumes a persisted agent before creating a new one', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-resume-'));
    const cwd = home; // must exist for setCwd later
    setPersistedAgentId(99, cwd, 'agent-persisted', home, 'default');

    const creates: string[] = [];
    const resumes: string[] = [];
    const agents: AgentLifecycle = {
      async create(_options: AgentLifecycleOptions) {
        creates.push('create');
        return fakeAgent('agent-created');
      },
      async resume(agentId: string) {
        resumes.push(agentId);
        return fakeAgent(agentId);
      },
    };

    const pool = new CursorAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      agents,
    });

    const session = pool.sessionFor(99);
    const reply = await session.send('continue please');
    expect(reply).toBe('ok:agent-persisted');
    expect(resumes).toEqual(['agent-persisted']);
    expect(creates).toEqual([]);
    expect(getPersistedAgentId(99, cwd, home, 'default')).toBe('agent-persisted');
  });

  it('creates when nothing is persisted, then resumes after memory dispose', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-create-'));
    const cwd = home;

    const creates: string[] = [];
    const resumes: string[] = [];
    const agents: AgentLifecycle = {
      async create() {
        creates.push('create');
        return fakeAgent('agent-new');
      },
      async resume(agentId: string) {
        resumes.push(agentId);
        return fakeAgent(agentId);
      },
    };

    const pool = new CursorAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      agents,
    });

    const session = pool.sessionFor(1);
    expect(await session.send('first')).toBe('ok:agent-new');
    expect(creates).toEqual(['create']);
    expect(getPersistedAgentId(1, cwd, home, 'default')).toBe('agent-new');

    await pool.disposeAllMemory();
    expect(await session.send('second')).toBe('ok:agent-new');
    expect(resumes).toEqual(['agent-new']);
    expect(creates).toEqual(['create']);
  });

  it('clears persisted id on /new so the next send creates', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-new-'));
    const cwd = home;
    setPersistedAgentId(3, cwd, 'agent-old', home, 'default');

    const creates: string[] = [];
    const agents: AgentLifecycle = {
      async create() {
        creates.push('create');
        return fakeAgent('agent-fresh');
      },
      async resume(agentId: string) {
        return fakeAgent(agentId);
      },
    };

    const pool = new CursorAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      agents,
    });

    const session = pool.sessionFor(3);
    await session.reset();
    expect(getPersistedAgentId(3, cwd, home, 'default')).toBeUndefined();
    expect(await session.send('fresh')).toBe('ok:agent-fresh');
    expect(creates).toEqual(['create']);
  });

  it('falls back to create when resume fails', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-resume-fail-'));
    const cwd = home;
    setPersistedAgentId(5, cwd, 'agent-dead', home, 'default');

    const agents: AgentLifecycle = {
      async create() {
        return fakeAgent('agent-fallback');
      },
      async resume() {
        throw new Error('gone');
      },
    };

    const pool = new CursorAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      agents,
    });

    expect(await pool.sessionFor(5).send('hi')).toBe('ok:agent-fallback');
    expect(getPersistedAgentId(5, cwd, home, 'default')).toBe('agent-fallback');
  });
});
