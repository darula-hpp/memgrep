import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentPool } from '../agent/pool.js';
import type { CodingAgentProvider, ProviderSession } from '../agent/provider.js';
import {
  clearPersistedAgentId,
  getPersistedAgentId,
  readSessionStore,
  setPersistedAgentId,
  telegramSessionsPath,
} from '../session-store.js';

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

function fakeSession(id: string): ProviderSession {
  return {
    id,
    async send() {
      return {
        id: `run-${id}`,
        wait: async () => ({ id: `run-${id}`, status: 'finished' as const, result: `ok:${id}` }),
        cancel: async () => {},
      };
    },
    async dispose() {},
  };
}

function fakeProvider(hooks: {
  creates?: string[];
  resumes?: string[];
  resumeFail?: boolean;
}): CodingAgentProvider {
  return {
    id: 'fake',
    async create() {
      hooks.creates?.push('create');
      return fakeSession('agent-created');
    },
    async resume(agentId: string) {
      if (hooks.resumeFail) throw new Error('gone');
      hooks.resumes?.push(agentId);
      return fakeSession(agentId);
    },
    async listModels() {
      return [{ id: 'composer-2.5' }];
    },
  };
}

describe('AgentPool resume via CodingAgentProvider', () => {
  let home: string;

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('resumes a persisted agent before creating a new one', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-resume-'));
    const cwd = home;
    setPersistedAgentId(99, cwd, 'agent-persisted', home, 'default');

    const creates: string[] = [];
    const resumes: string[] = [];
    const pool = createAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      provider: fakeProvider({ creates, resumes }),
    });

    const session = pool.sessionFor(99);
    expect(await session.send('continue please')).toBe('ok:agent-persisted');
    expect(resumes).toEqual(['agent-persisted']);
    expect(creates).toEqual([]);
    expect(getPersistedAgentId(99, cwd, home, 'default')).toBe('agent-persisted');
  });

  it('creates when nothing is persisted, then resumes after memory dispose', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-create-'));
    const cwd = home;

    const creates: string[] = [];
    const resumes: string[] = [];
    // Override create to return a stable id
    const provider: CodingAgentProvider = {
      id: 'fake',
      async create() {
        creates.push('create');
        return fakeSession('agent-new');
      },
      async resume(agentId: string) {
        resumes.push(agentId);
        return fakeSession(agentId);
      },
      async listModels() {
        return [];
      },
    };

    const pool = createAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      provider,
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
    const provider: CodingAgentProvider = {
      id: 'fake',
      async create() {
        creates.push('create');
        return fakeSession('agent-fresh');
      },
      async resume(agentId: string) {
        return fakeSession(agentId);
      },
      async listModels() {
        return [];
      },
    };

    const pool = createAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      provider,
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

    const provider: CodingAgentProvider = {
      id: 'fake',
      async create() {
        return fakeSession('agent-fallback');
      },
      async resume() {
        throw new Error('gone');
      },
      async listModels() {
        return [];
      },
    };

    const pool = createAgentPool({
      apiKey: 'key',
      cwd,
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      home,
      profile: 'default',
      persistConfig: false,
      provider,
    });

    expect(await pool.sessionFor(5).send('hi')).toBe('ok:agent-fallback');
    expect(getPersistedAgentId(5, cwd, home, 'default')).toBe('agent-fallback');
  });
});
