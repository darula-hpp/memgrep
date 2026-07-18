import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actionsManifestPath,
  exitsManifestPath,
  getActiveLoopProfile,
  initLoopProfile,
  inputsManifestPath,
  legacyLoopConfigPath,
  listLoopProfiles,
  loopProfileDir,
  mergeArtifacts,
  migrateLegacyLoopIfNeeded,
  readLoopConfig,
  resolveLoopConfig,
  setActiveLoopProfile,
  upsertLoopAction,
  upsertLoopExit,
  upsertLoopInput,
  writeLoopConfig,
} from '../config.js';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import {
  buildPinnedFromConfig,
  parseLoopActionsTrailer,
  parseLoopStatusTrailer,
} from '../prompt.js';
import { LoopService } from '../service.js';
import { startLoopBackground, formatLoopStartedAck } from '../background.js';
import {
  createLoopRun,
  readLoopRun,
  reconcileLoopRunIfStale,
  updateLoopRun,
} from '../runs.js';
import type { CursorAgentService } from '../../cursor/service.js';
import type { MemoryTools } from '../../memory/tools.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-loop-'));
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

function touchFile(home: string, rel: string, body = 'x\n'): string {
  const abs = path.join(home, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  return abs;
}

describe('loop config + manifests', () => {
  it('writes config and regenerates three manifests under loops/default', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    const arch = touchFile(home, 'docs/arch.md', '# arch\n');

    writeLoopConfig(
      {
        cwd,
        defaults: {
          inputs: [
            {
              id: 'architecture',
              kind: 'path',
              value: arch,
              label: 'Architecture',
            },
          ],
          exits: [
            {
              id: 'tests',
              kind: 'text',
              value: 'All tests pass',
              label: 'Tests',
            },
          ],
          actions: [
            {
              id: 'github_pr',
              kind: 'builtin',
              value: 'github_pr',
              label: 'PR',
            },
          ],
        },
      },
      home,
    );

    const scope = { home };
    expect(existsSync(path.join(loopProfileDir('default', home), 'loop.json'))).toBe(true);
    expect(getActiveLoopProfile(home)).toBe('default');
    expect(readFileSync(inputsManifestPath(scope), 'utf8')).toContain('## architecture');
    expect(readFileSync(exitsManifestPath(scope), 'utf8')).toContain('## tests');
    expect(readFileSync(actionsManifestPath(scope), 'utf8')).toContain('## github_pr');
  });

  it('upserts defaults on the fly and refreshes manifests', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeLoopConfig(
      { cwd, defaults: { inputs: [], exits: [], actions: [] } },
      home,
    );

    upsertLoopInput(
      { id: 'docs', kind: 'url', value: 'https://example.com/docs', label: 'Docs' },
      home,
    );
    upsertLoopExit(
      { id: 'lint', kind: 'text', value: 'lint clean', label: 'Lint' },
      home,
    );
    upsertLoopAction(
      {
        id: 'deploy',
        kind: 'text',
        value: 'vercel deploy --prod',
        label: 'Deploy',
      },
      home,
    );

    const cfg = readLoopConfig(home)!;
    expect(cfg.defaults.inputs).toHaveLength(1);
    expect(cfg.defaults.exits).toHaveLength(1);
    expect(cfg.defaults.actions).toHaveLength(1);
    expect(readFileSync(actionsManifestPath(home), 'utf8')).toContain('vercel deploy');
  });
});

describe('loop profiles', () => {
  it('init creates missing cwd directory', () => {
    const home = tempHome();
    const cwd = path.join(home, 'new-repo');
    expect(existsSync(cwd)).toBe(false);

    const { config } = initLoopProfile('memgrep-mm', { home, cwd, setActive: true });
    expect(existsSync(cwd)).toBe(true);
    expect(config.cwd).toBe(realpathSync(cwd));
  });

  it('init copies base and isolates upserts across profiles', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });

    initLoopProfile('launchpad', { home, cwd, setActive: true });
    initLoopProfile('prepaid', { home, cwd, setActive: false });

    upsertLoopExit(
      { id: 'sso', kind: 'text', value: 'GitHub SSO required', label: 'SSO' },
      { home, profile: 'launchpad' },
    );
    upsertLoopExit(
      { id: 'billing', kind: 'text', value: 'Billing works', label: 'Billing' },
      { home, profile: 'prepaid' },
    );

    const launchpad = readLoopConfig({ home, profile: 'launchpad' })!;
    const prepaid = readLoopConfig({ home, profile: 'prepaid' })!;
    expect(launchpad.defaults.exits.map((e) => e.id)).toEqual(['sso']);
    expect(prepaid.defaults.exits.map((e) => e.id)).toEqual(['billing']);
    expect(listLoopProfiles(home)).toEqual(['launchpad', 'prepaid']);
  });

  it('setActiveLoopProfile switches resolveLoopConfig defaults', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    initLoopProfile('a', { home, cwd, setActive: true });
    initLoopProfile('b', { home, cwd, setActive: false });
    upsertLoopInput(
      { id: 'from-a', kind: 'text', value: 'A', label: 'A' },
      { home, profile: 'a' },
    );
    upsertLoopInput(
      { id: 'from-b', kind: 'text', value: 'B', label: 'B' },
      { home, profile: 'b' },
    );

    setActiveLoopProfile('b', home);
    const resolved = resolveLoopConfig(home)!;
    expect(resolved.profile).toBe('b');
    expect(resolved.defaults.inputs.map((i) => i.id)).toEqual(['from-b']);
  });

  it('migrates legacy loop.json into loops/default and seeds loop.base', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    const now = new Date().toISOString();
    writeFileAtomic(
      legacyLoopConfigPath(home),
      `${JSON.stringify(
        {
          version: 1,
          cwd,
          defaults: {
            inputs: [{ id: 'old', kind: 'text', value: 'legacy', label: 'Old' }],
            exits: [],
            actions: [],
          },
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    expect(migrateLegacyLoopIfNeeded(home)).toBe(true);
    expect(existsSync(path.join(home, 'loop.base', 'loop.json'))).toBe(true);
    expect(existsSync(path.join(loopProfileDir('default', home), 'loop.json'))).toBe(true);
    expect(getActiveLoopProfile(home)).toBe('default');
    const migrated = readLoopConfig({ home, profile: 'default' })!;
    expect(migrated.defaults.inputs[0]?.id).toBe('old');
    // Base template should be empty defaults
    const base = JSON.parse(readFileSync(path.join(home, 'loop.base', 'loop.json'), 'utf8'));
    expect(base.defaults.inputs).toEqual([]);
  });
});

describe('mergeArtifacts', () => {
  it('lets run overrides win on id', () => {
    const merged = mergeArtifacts(
      [{ id: 'a', kind: 'text', value: 'default', label: 'A' }],
      [{ id: 'a', kind: 'text', value: 'override', label: 'A' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe('override');
  });
});

describe('trailers', () => {
  it('parses LOOP_STATUS trailer', () => {
    const t = parseLoopStatusTrailer(`
done
LOOP_STATUS: PASS
LOOP_FAILURES: none
LOOP_PR_SUMMARY: Added feature
LOOP_DEPLOY_NOTES: None
LOOP_CHANGED_FILES:
src/a.ts
src/b.ts
`);
    expect(t.status).toBe('PASS');
    expect(t.changedFiles).toContain('src/a.ts');
  });

  it('parses LOOP_ACTIONS trailer', () => {
    const t = parseLoopActionsTrailer(`
LOOP_ACTIONS_STATUS: FAIL
LOOP_ACTIONS_FAILURES: vercel deploy timed out
`);
    expect(t.status).toBe('FAIL');
    expect(t.failures).toMatch(/vercel/);
  });
});

describe('LoopService', () => {
  it('requires task and allows run without jira', async () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeLoopConfig(
      {
        cwd,
        defaults: {
          inputs: [],
          exits: [{ id: 'done', kind: 'text', value: 'done', label: 'Done' }],
          actions: [],
        },
      },
      home,
    );
    const config = resolveLoopConfig(home)!;

    const cursor = {
      resolveCwd: vi.fn((p: string) => p),
      run: vi.fn().mockResolvedValue({
        ok: true,
        agentId: 'agent-1',
        text: [
          'LOOP_STATUS: PASS',
          'LOOP_FAILURES: none',
          'LOOP_PR_SUMMARY: ok',
          'LOOP_DEPLOY_NOTES: None',
          'LOOP_CHANGED_FILES:',
          'src/x.ts',
        ].join('\n'),
      }),
    } as unknown as CursorAgentService;

    const memory = {
      remember: vi.fn().mockResolvedValue({ text: 'ok' }),
      recall: vi.fn(),
    } as unknown as MemoryTools;

    const service = new LoopService(config, cursor, memory);
    const result = await service.run({ task: 'Ship the thing' });
    expect(result.ok).toBe(true);
    expect(memory.remember).toHaveBeenCalled();
    expect(cursor.run).toHaveBeenCalled();
  });

  it('errors when jiraKey set without jira service', async () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeLoopConfig(
      { cwd, defaults: { inputs: [], exits: [], actions: [] } },
      home,
    );
    const config = resolveLoopConfig(home)!;
    const cursor = {
      resolveCwd: vi.fn((p: string) => p),
      run: vi.fn(),
    } as unknown as CursorAgentService;
    const memory = { remember: vi.fn(), recall: vi.fn() } as unknown as MemoryTools;
    const service = new LoopService(config, cursor, memory);
    await expect(service.run({ task: 'x', jiraKey: 'TASK-1' })).rejects.toThrow(/Jira/);
  });

  it('runs github_pr builtin after PASS', async () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    const pr = touchFile(home, 'pr.md', '## Summary\n\nTODO\n');
    writeLoopConfig(
      {
        cwd,
        defaults: {
          inputs: [
            { id: 'prTemplate', kind: 'path', value: pr, label: 'PR template' },
          ],
          exits: [],
          actions: [
            { id: 'github_pr', kind: 'builtin', value: 'github_pr', label: 'PR' },
          ],
        },
      },
      home,
    );
    const config = resolveLoopConfig(home)!;
    const cursor = {
      resolveCwd: vi.fn((p: string) => p),
      run: vi.fn().mockResolvedValue({
        ok: true,
        agentId: 'a1',
        text: 'LOOP_STATUS: PASS\nLOOP_FAILURES: none\nLOOP_PR_SUMMARY: hi\nLOOP_DEPLOY_NOTES: None\nLOOP_CHANGED_FILES:\nsrc/a.ts\n',
      }),
    } as unknown as CursorAgentService;
    const memory = {
      remember: vi.fn().mockResolvedValue({ text: 'ok' }),
      recall: vi.fn(),
    } as unknown as MemoryTools;
    const publish = vi.fn().mockResolvedValue({
      prUrl: 'https://github.com/x/y/pull/1',
      branch: 'cursor/Ship',
      files: ['src/a.ts'],
      source: 'trailer',
      warnings: [],
    });
    const service = new LoopService(config, cursor, memory, undefined, undefined, publish);
    const result = await service.run({ task: 'Ship' });
    expect(result.ok).toBe(true);
    expect(result.prUrl).toContain('pull/1');
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe('reconcileLoopRunIfStale', () => {
  it('marks running runs fail when pid is dead', () => {
    const home = tempHome();
    const meta = createLoopRun({ task: 't' }, home);
    updateLoopRun(meta.runId, { status: 'running', pid: 999_999_999 }, home);
    const next = reconcileLoopRunIfStale(readLoopRun(meta.runId, home)!, home);
    expect(next.status).toBe('fail');
    expect(next.error).toMatch(/exited without updating status/);
  });
});

describe('background start', () => {
  it('spawns detached cli and returns immediately', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    initLoopProfile('launchpad', { home, cwd, setActive: true });
    const spawnFn = vi.fn().mockReturnValue({
      pid: 4242,
      unref: vi.fn(),
    });
    const { meta } = startLoopBackground({
      task: 'Do work',
      home,
      profile: 'launchpad',
      cliPath: '/tmp/fake-cli.js',
      spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });
    expect(meta.runId).toBeTruthy();
    expect(meta.profile).toBe('launchpad');
    expect(readLoopRun(meta.runId, home)?.status).toBe('running');
    expect(formatLoopStartedAck(meta, home)).toContain('loop started');
    expect(spawnFn).toHaveBeenCalled();
    const args = spawnFn.mock.calls[0]![1] as string[];
    expect(args).toContain('loop');
    expect(args).toContain('run');
    expect(args).toContain('--profile');
    expect(args).toContain('launchpad');
  });
});

describe('buildPinnedFromConfig', () => {
  it('merges defaults and run artifacts', () => {
    const home = tempHome();
    const cwd = path.join(home, 'repo');
    mkdirSync(cwd, { recursive: true });
    writeLoopConfig(
      {
        cwd,
        defaults: {
          inputs: [{ id: 'a', kind: 'text', value: '1', label: 'A' }],
          exits: [],
          actions: [],
        },
      },
      home,
    );
    const config = resolveLoopConfig(home)!;
    const pin = buildPinnedFromConfig(config, {
      task: 't',
      inputs: [{ id: 'b', kind: 'text', value: '2', label: 'B' }],
    });
    expect(pin.inputs.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
});
