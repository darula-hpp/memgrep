import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  neonConfigPath,
  resolveNeonConfig,
  writeNeonConfig,
} from '../config.js';
import { NeonService } from '../service.js';
import { NeonTools } from '../tools.js';
import type { NeonClient } from '../client.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-neon-'));
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

describe('resolveNeonConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolveNeonConfig({}, home)).toBeUndefined();
  });

  it('reads from file', () => {
    const home = tempHome();
    writeNeonConfig(
      { apiKey: 'neon_api_key_abcdefghijklmnopqrst', defaultProjectId: 'proj-1' },
      home,
    );
    const resolved = resolveNeonConfig({}, home);
    expect(resolved).toMatchObject({
      apiKey: 'neon_api_key_abcdefghijklmnopqrst',
      defaultProjectId: 'proj-1',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(neonConfigPath(home));
  });

  it('lets env override file', () => {
    const home = tempHome();
    writeNeonConfig({ apiKey: 'neon_file_key_abcdefghijklmnop' }, home);
    const resolved = resolveNeonConfig(
      {
        NEON_API_KEY: 'neon_env_key_abcdefghijklmnop',
        NEON_PROJECT_ID: 'proj-env',
      },
      home,
    );
    expect(resolved).toMatchObject({
      apiKey: 'neon_env_key_abcdefghijklmnop',
      defaultProjectId: 'proj-env',
      source: 'mixed',
    });
  });

  it('throws on corrupt config', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(neonConfigPath(home), '{bad', 'utf8');
    expect(() => resolveNeonConfig({}, home)).toThrow(/Invalid neon config/);
  });
});

describe('NeonTools', () => {
  function mockClient(overrides: Partial<NeonClient> = {}): NeonClient {
    return {
      defaultProjectId: 'proj-1',
      whoami: vi.fn(),
      listProjects: vi.fn(),
      getProject: vi.fn(),
      listBranches: vi.fn(),
      getConnectionUri: vi.fn(),
      ...overrides,
    } as unknown as NeonClient;
  }

  it('formats projects', async () => {
    const client = mockClient({
      listProjects: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'App', regionId: 'aws-us-east-1' },
      ]),
    });
    const tools = new NeonTools(new NeonService(client));
    const result = await tools.listProjects();
    expect(result.text).toContain('App (p1)');
  });

  it('requires project id when no default', async () => {
    const client = mockClient({ defaultProjectId: undefined });
    const tools = new NeonTools(new NeonService(client));
    const result = await tools.listBranches({});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Project id is required/);
  });

  it('redacts password in connection uri display', async () => {
    const client = mockClient({
      getConnectionUri: vi.fn().mockResolvedValue({
        uri: 'postgresql://user:secret@ep-x.aws.neon.tech/neondb?sslmode=require',
      }),
    });
    const tools = new NeonTools(new NeonService(client));
    const result = await tools.connectionUri({ projectId: 'proj-1' });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain(':***@');
    expect(result.text).toContain('secret'); // full URI also included for local use
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      getProject: vi.fn().mockRejectedValue(new Error('Neon API GET failed (HTTP 404)')),
    });
    const tools = new NeonTools(new NeonService(client));
    const result = await tools.getProject({ projectId: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/404/);
  });

  it('verify falls back when whoami is forbidden for org keys', async () => {
    const client = mockClient({
      defaultProjectId: undefined,
      listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'App' }]),
      whoami: vi.fn().mockRejectedValue(new Error('not allowed for organization API keys')),
    });
    const service = new NeonService(client);
    const me = await service.verify();
    expect(me.projectCount).toBe(1);
    expect(me.email).toBeUndefined();
  });

  it('verify uses subject_project_id when list projects is scoped', async () => {
    const client = mockClient({
      defaultProjectId: undefined,
      listProjects: vi.fn().mockRejectedValue(
        new Error(
          'Neon API GET /projects failed (HTTP 404): not allowed to perform actions outside the project this key is scoped to; subject_project_id:"holy-violet-56502803"',
        ),
      ),
      getProject: vi.fn().mockResolvedValue({
        id: 'holy-violet-56502803',
        name: 'gitwork',
      }),
    });
    const service = new NeonService(client);
    const me = await service.verify();
    expect(me.projectId).toBe('holy-violet-56502803');
    expect(me.projectName).toBe('gitwork');
  });
});

describe('NeonService.formatConnectionUri', () => {
  it('redacts password', () => {
    const service = new NeonService({} as NeonClient);
    expect(
      service.formatConnectionUri('postgresql://u:pass@host/db'),
    ).toBe('postgresql://u:***@host/db');
  });
});
