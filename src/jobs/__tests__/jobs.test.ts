import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStore } from '../store.js';
import { JobsService } from '../service.js';
import { getScheduleProvider } from '../schedule.js';
import { buildPlaybookPrompt } from '../executor.js';
import { JobsTools } from '../tools.js';
import type { Job } from '../types.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-jobs-'));
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

describe('CronScheduleProvider', () => {
  it('validates and computes next', () => {
    const cron = getScheduleProvider('cron');
    cron.validate('0 9 * * 1-5');
    expect(() => cron.validate('not a cron')).toThrow(/Invalid cron/);
    const next = cron.next('0 0 * * *', new Date('2026-07-11T12:00:00Z'));
    expect(next.getTime()).toBeGreaterThan(new Date('2026-07-11T12:00:00Z').getTime());
  });
});

describe('JobStore + JobsService', () => {
  it('adds, lists, updates, disables, removes', () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);
    const store = JobStore.open(home);
    const service = new JobsService({ store });

    const job = service.add({
      name: 'outreach-am',
      cron: '0 9 * * 1-5',
      prompt: 'Process queue',
      cwd,
      playbookId: 331,
      mode: 'notify',
    });
    expect(job.id).toContain('outreach-am');
    expect(job.nextRunAt).toBeTruthy();
    expect(service.list()).toHaveLength(1);

    service.enable(job.name, false);
    expect(service.get(job.name)?.enabled).toBe(false);

    service.update(job.id, { prompt: 'Process queue v2' });
    expect(service.get(job.id)?.prompt).toBe('Process queue v2');

    service.remove(job.name);
    expect(service.list()).toHaveLength(0);
    store.close();
  });

  it('claims runs uniquely', () => {
    const home = tempHome();
    const store = JobStore.open(home);
    const a = store.tryClaim('job-1', '2026-07-11T09:00:00.000Z');
    const b = store.tryClaim('job-1', '2026-07-11T09:00:00.000Z');
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    store.finishRun(a!.id, 'succeeded', 'ok');
    const runs = store.listRuns('job-1');
    expect(runs[0]?.status).toBe('succeeded');
    store.close();
  });

  it('skips missed ticks beyond grace', async () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);
    const store = JobStore.open(home);
    const service = new JobsService({ store });
    const job = service.add({
      name: 'stale',
      cron: '0 9 * * *',
      prompt: 'x',
      cwd,
      playbookId: 1,
    });
    // Force nextRunAt far in the past
    store.setNextAndLast(job.id, '2020-01-01T09:00:00.000Z', '2020-01-01T09:00:00.000Z');
    const msgs = await service.tick(new Date('2026-07-11T12:00:00Z'));
    expect(msgs.some((m) => m.includes('skipped_missed'))).toBe(true);
    const updated = service.get(job.id)!;
    expect(updated.nextRunAt).not.toBe('2020-01-01T09:00:00.000Z');
    store.close();
  });
});

describe('buildPlaybookPrompt', () => {
  it('includes get_chat instruction', () => {
    const job = {
      id: 'j1',
      name: 'outreach',
      playbookId: 331,
      prompt: 'Send previews',
      mode: 'notify',
    } as Job;
    const text = buildPlaybookPrompt(job, '2026-07-11T09:00:00.000Z');
    expect(text).toContain('chatId=331');
    expect(text).toContain('Send previews');
    expect(text).toContain('notify');
  });
});

describe('JobsTools', () => {
  it('formats add/list via tools surface', () => {
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);
    writeFileSync(path.join(cwd, 'x.txt'), 'x');
    const store = JobStore.open(home);
    const tools = new JobsTools(new JobsService({ store }));
    const created = tools.add({
      name: 'scan-inbox',
      cron: '30 8 * * 1-5',
      prompt: 'Summarize unread',
      cwd,
      playbookQuery: 'email scan summarize',
      mode: 'auto',
    });
    expect(created.isError).toBeFalsy();
    expect(tools.list().text).toContain('scan-inbox');
    store.close();
  });
});

describe('CursorJobExecutor', () => {
  it('runs through CodingAgentProvider and disposes the session', async () => {
    const { CursorJobExecutor } = await import('../cursor-executor.js');
    const home = tempHome();
    const cwd = path.join(home, 'proj');
    mkdirSync(cwd);

    let disposed = false;
    const executor = new CursorJobExecutor({
      id: 'fake',
      async create() {
        return {
          id: 'agent-job',
          async send() {
            return {
              id: 'run-1',
              wait: async () => ({ id: 'run-1', status: 'finished' as const, result: 'done' }),
              cancel: async () => {},
            };
          },
          async dispose() {
            disposed = true;
          },
        };
      },
      async resume() {
        throw new Error('not used');
      },
      async listModels() {
        return [];
      },
    });

    const job: Job = {
      id: 'j1',
      name: 'smoke',
      cron: '0 9 * * *',
      prompt: 'ping',
      cwd,
      mode: 'notify',
      executor: 'cursor',
      enabled: true,
      nextRunAt: new Date().toISOString(),
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await executor.execute(job, {
      scheduledAt: new Date().toISOString(),
      cursorApiKey: 'key',
      model: 'composer-2.5',
      mcpUrl: 'http://127.0.0.1:3921/mcp',
    });
    expect(result).toEqual({ ok: true, summary: 'done' });
    expect(disposed).toBe(true);
  });
});
