import { existsSync } from 'node:fs';
import { expandHomePath } from '../telegram/config.js';
import type { ToolResult } from '../memory/tools.js';
import { getScheduleProvider } from './schedule.js';
import type { JobStore } from './store.js';
import { MISSED_GRACE_MS } from './store.js';
import type { ExecutorRegistry, JobExecuteContext } from './executor.js';
import type { NotifierRegistry } from './notifier.js';
import type {
  Job,
  JobCreateInput,
  JobExecuteResult,
  JobRun,
  JobUpdateInput,
} from './types.js';

export type ResolveRunContext = (job: Job) => Promise<JobExecuteContext> | JobExecuteContext;

export type JobsServiceOptions = {
  store: JobStore;
  executors?: ExecutorRegistry;
  notifiers?: NotifierRegistry;
  /** Build Cursor/MCP credentials for a job run. Required for runNow / daemon. */
  resolveContext?: ResolveRunContext;
  /** Which notifier kind to use when job.mode is notify (or always on failure). Default: telegram. */
  notifyKind?: string;
};

/**
 * Shared CRUD + run orchestration for CLI and MCP.
 */
export class JobsService {
  constructor(private readonly options: JobsServiceOptions) {}

  private get store(): JobStore {
    return this.options.store;
  }

  list(): Job[] {
    return this.store.list();
  }

  get(idOrName: string): Job | undefined {
    return this.store.get(idOrName);
  }

  add(input: JobCreateInput): Job {
    const cwd = expandHomePath(input.cwd);
    if (!existsSync(cwd)) {
      throw new Error(`Directory does not exist: ${cwd}`);
    }
    return this.store.add({ ...input, cwd });
  }

  update(idOrName: string, patch: JobUpdateInput): Job {
    const next = { ...patch };
    if (next.cwd !== undefined && next.cwd !== null) {
      const cwd = expandHomePath(next.cwd);
      if (!existsSync(cwd)) {
        throw new Error(`Directory does not exist: ${cwd}`);
      }
      next.cwd = cwd;
    }
    return this.store.update(idOrName, next);
  }

  remove(idOrName: string): Job {
    return this.store.remove(idOrName);
  }

  enable(idOrName: string, enabled: boolean): Job {
    return this.store.update(idOrName, { enabled });
  }

  logs(idOrName: string, limit = 20): { job: Job; runs: JobRun[] } {
    const job = this.store.get(idOrName);
    if (!job) throw new Error(`Job not found: ${idOrName}`);
    return { job, runs: this.store.listRuns(job.id, limit) };
  }

  /**
   * Fire a job immediately (manual). Uses a unique scheduledAt so it never
   * collides with a cron slot.
   */
  async runNow(idOrName: string): Promise<{ job: Job; run: JobRun; result: JobExecuteResult }> {
    const job = this.store.get(idOrName);
    if (!job) throw new Error(`Job not found: ${idOrName}`);
    const scheduledAt = new Date().toISOString();
    return this.executeClaimed(job, scheduledAt, true);
  }

  /**
   * Daemon tick: find due jobs, claim, run, advance nextRunAt.
   * Returns summaries for logging.
   */
  async tick(now = new Date()): Promise<string[]> {
    const schedule = getScheduleProvider('cron');
    const messages: string[] = [];
    const jobs = this.store.list().filter((j) => j.enabled && j.nextRunAt);

    for (const job of jobs) {
      const dueAt = new Date(job.nextRunAt!);
      if (dueAt.getTime() > now.getTime()) continue;

      const lag = now.getTime() - dueAt.getTime();
      if (lag > MISSED_GRACE_MS) {
        const claim = this.store.tryClaim(job.id, dueAt.toISOString());
        if (claim) {
          this.store.finishRun(
            claim.id,
            'skipped_missed',
            `Missed by ${Math.round(lag / 60000)}m; skipped.`,
          );
        }
        const next = schedule.next(job.cron, now).toISOString();
        this.store.setNextAndLast(job.id, next, now.toISOString());
        messages.push(`skipped_missed ${job.name} → next ${next}`);
        continue;
      }

      try {
        const { result } = await this.executeClaimed(job, dueAt.toISOString(), false);
        const next = schedule.next(job.cron, now).toISOString();
        this.store.setNextAndLast(job.id, next, now.toISOString());
        messages.push(
          `${result.ok ? 'ok' : 'fail'} ${job.name} → next ${next}`,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const next = schedule.next(job.cron, now).toISOString();
        this.store.setNextAndLast(job.id, next, now.toISOString());
        messages.push(`error ${job.name}: ${detail} → next ${next}`);
      }
    }

    return messages;
  }

  private async executeClaimed(
    job: Job,
    scheduledAt: string,
    manual: boolean,
  ): Promise<{ job: Job; run: JobRun; result: JobExecuteResult }> {
    const run = this.store.tryClaim(job.id, scheduledAt);
    if (!run) {
      throw new Error(`Could not claim run for ${job.name} at ${scheduledAt} (already claimed).`);
    }

    if (!this.options.executors || !this.options.resolveContext) {
      this.store.finishRun(run.id, 'failed', undefined, 'Executor not configured in this process.');
      throw new Error('Job executor is not configured. Run via memgrep jobs daemon / jobs run.');
    }

    let result: JobExecuteResult;
    try {
      const ctx = await this.options.resolveContext(job);
      const executor = this.options.executors.get(job.executor);
      result = await executor.execute(job, { ...ctx, scheduledAt, manual });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { ok: false, summary: '', error: message };
    }

    this.store.finishRun(
      run.id,
      result.ok ? 'succeeded' : 'failed',
      result.summary.slice(0, 20_000),
      result.error,
    );

    // Notify on notify mode always; on auto mode only when failed.
    const shouldNotify = job.mode === 'notify' || !result.ok;
    if (shouldNotify && this.options.notifiers) {
      const notifier = this.options.notifiers.get(this.options.notifyKind ?? 'telegram');
      try {
        await notifier.notify(job, result, { scheduledAt, manual });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`memgrep jobs: notify failed for ${job.name}: ${detail}`);
      }
    }

    return { job, run: this.store.getRun(run.id)!, result };
  }

  // --- Tool-facing formatters (MCP / CLI) ---

  formatList(): ToolResult {
    const jobs = this.list();
    if (jobs.length === 0) return { text: 'No jobs. Add one with jobs_add / memgrep jobs add.' };
    const text = jobs
      .map((j) => {
        const state = j.enabled ? 'on' : 'off';
        return `[${j.id}] ${j.name} (${state}) cron="${j.cron}" mode=${j.mode} next=${j.nextRunAt ?? '—'} playbook=${j.playbookId ?? j.playbookQuery ?? '—'}`;
      })
      .join('\n');
    return { text };
  }

  formatShow(idOrName: string): ToolResult {
    const job = this.get(idOrName);
    if (!job) return { text: `Job not found: ${idOrName}`, isError: true };
    return { text: JSON.stringify(job, null, 2) };
  }

  formatLogs(idOrName: string, limit = 10): ToolResult {
    try {
      const { job, runs } = this.logs(idOrName, limit);
      if (runs.length === 0) return { text: `No runs yet for ${job.name}.` };
      const text = runs
        .map(
          (r) =>
            `#${r.id} ${r.status} scheduled=${r.scheduledAt}` +
            (r.error ? ` err=${r.error}` : '') +
            (r.summary ? `\n  ${r.summary.replace(/\s+/g, ' ').slice(0, 200)}` : ''),
        )
        .join('\n');
      return { text: `Runs for ${job.name}:\n${text}` };
    } catch (error) {
      return {
        text: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }
}
