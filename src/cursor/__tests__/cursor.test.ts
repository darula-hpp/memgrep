import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cursorConfigPath,
  resolveCursorConfig,
  writeCursorConfig,
} from '../config.js';
import { usefulRunErrorDetail, runAgentTurn } from '../runner.js';
import { CursorAgentService } from '../service.js';
import { CursorTools } from '../tools.js';
import type { CodingAgentProvider, ProviderSession } from '../provider.js';
import type { ResolvedCursorConfig } from '../config.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-cursor-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('resolveCursorConfig', () => {
  it('returns undefined without api key', () => {
    expect(resolveCursorConfig({}, tempHome())).toBeUndefined();
  });

  it('reads cursor.json', () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);
    writeCursorConfig(
      {
        cursorApiKey: 'crsr_test_key_abcdefghijklmnop',
        cwd,
        workspaces: [{ name: 'proj', path: cwd }],
        model: 'composer-2.5',
      },
      home,
    );
    const resolved = resolveCursorConfig({}, home);
    expect(resolved).toMatchObject({
      apiKey: 'crsr_test_key_abcdefghijklmnop',
      cwd,
      model: 'composer-2.5',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(cursorConfigPath(home));
  });

  it('lets env override key', () => {
    const home = tempHome();
    writeCursorConfig({ cursorApiKey: 'crsr_file_key_abcdefghijklmnop' }, home);
    const resolved = resolveCursorConfig(
      { CURSOR_API_KEY: 'crsr_env_key_abcdefghijklmnop' },
      home,
    );
    expect(resolved?.apiKey).toBe('crsr_env_key_abcdefghijklmnop');
    expect(resolved?.source).toBe('mixed');
  });
});

describe('usefulRunErrorDetail', () => {
  it('treats empty and conversation dumps as opaque', () => {
    expect(usefulRunErrorDetail(undefined)).toBeUndefined();
    expect(usefulRunErrorDetail('')).toBeUndefined();
    expect(
      usefulRunErrorDetail('{"type":"thinkingMessage","agentConversationTurn":[]}'),
    ).toBeUndefined();
    expect(usefulRunErrorDetail('Disk full')).toBe('Disk full');
  });
});

describe('runAgentTurn', () => {
  it('returns finished text', async () => {
    const session: ProviderSession = {
      id: 'agent-1',
      send: vi.fn().mockResolvedValue({
        id: 'run-1',
        wait: async () => ({
          id: 'run-1',
          status: 'finished' as const,
          result: '  hello  ',
        }),
        cancel: async () => undefined,
      }),
      dispose: async () => undefined,
    };
    const turn = await runAgentTurn(session, 'hi', { timeoutMs: 5_000 });
    expect(turn).toMatchObject({ ok: true, text: 'hello', runId: 'run-1', agentId: 'agent-1' });
  });

  it('maps busy errors', async () => {
    const session: ProviderSession = {
      id: 'agent-1',
      send: vi.fn().mockRejectedValue(new Error('Agent already has active run')),
      dispose: async () => undefined,
    };
    const turn = await runAgentTurn(session, 'hi', { timeoutMs: 5_000 });
    expect(turn.ok).toBe(false);
    if (!turn.ok) expect(turn.kind).toBe('busy');
  });
});

describe('CursorAgentService allowlist', () => {
  function baseConfig(home: string, cwd: string): ResolvedCursorConfig {
    return {
      apiKey: 'crsr_test_key_abcdefghijklmnop',
      cwd,
      workspaces: [
        { name: 'proj', path: cwd },
        { name: 'other', path: path.join(home, 'other') },
      ],
      model: 'composer-2.5',
      agentMode: 'agent',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
      configPath: cursorConfigPath(home),
      source: 'file',
    };
  }

  it('resolves workspace by name and rejects unknown paths', () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    const other = path.join(home, 'other');
    mkdirSync(cwd);
    mkdirSync(other);
    const outside = path.join(home, 'outside');
    mkdirSync(outside);

    const service = new CursorAgentService(baseConfig(home, cwd), {
      id: 'fake',
      create: vi.fn(),
      resume: vi.fn(),
      listModels: vi.fn(),
    } as unknown as CodingAgentProvider);

    expect(service.resolveCwd('proj')).toBe(cwd);
    expect(service.resolveCwd('2')).toBe(other);
    expect(() => service.resolveCwd(outside)).toThrow(/not in the Cursor workspace allowlist/);
  });

  it('cursor_run returns isError on failure', async () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);
    const provider: CodingAgentProvider = {
      id: 'fake',
      create: vi.fn().mockResolvedValue({
        id: 'a1',
        send: vi.fn().mockRejectedValue(new Error('boom')),
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      resume: vi.fn(),
      listModels: vi.fn(),
    };
    const tools = new CursorTools(new CursorAgentService(baseConfig(home, cwd), provider));
    const result = await tools.run({ prompt: 'hi' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/boom/);
  });
});
