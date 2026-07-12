import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import { getScheduleProvider } from './schedule.js';
import type {
  Job,
  JobCreateInput,
  JobRun,
  JobRunStatus,
  JobUpdateInput,
  JobsFile,
} from './types.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof DatabaseType;

export const JOBS_DIR = 'jobs';
export const JOBS_FILE = 'jobs.json';
export const RUNS_DB_FILE = 'runs.db';

/** Missed-tick grace: if due within this window after wake, still run. */
export const MISSED_GRACE_MS = 6 * 60 * 60 * 1000;

export function jobsDir(home = defaultHome()): string {
  return path.join(home, JOBS_DIR);
}

export function jobsFilePath(home = defaultHome()): string {
  return path.join(jobsDir(home), JOBS_FILE);
}

export function runsDbPath(home = defaultHome()): string {
  return path.join(jobsDir(home), RUNS_DB_FILE);
}

function emptyFile(): JobsFile {
  return { version: 1, jobs: [] };
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Persist job definitions (JSON) and run history / claim locks (SQLite).
 * Extensible: add columns/migrations on runs.db; jobs.json stays the editable source of truth.
 */
export class JobStore {
  private constructor(
    private readonly home: string,
    private readonly db: DatabaseType.Database,
  ) {}

  static open(home = defaultHome()): JobStore {
    const dir = jobsDir(home);
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const db = new Database(runsDbPath(home));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        status TEXT NOT NULL,
        summary TEXT,
        error TEXT,
        UNIQUE(job_id, scheduled_at)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id, id DESC);
    `);
    return new JobStore(home, db);
  }

  close(): void {
    this.db.close();
  }

  private readFile(): JobsFile {
    const file = jobsFilePath(this.home);
    if (!existsSync(file)) return emptyFile();
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as JobsFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) return emptyFile();
      return parsed;
    } catch {
      return emptyFile();
    }
  }

  private writeFile(data: JobsFile): void {
    writeFileAtomic(jobsFilePath(this.home), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  }

  list(): Job[] {
    return this.readFile().jobs.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  get(idOrName: string): Job | undefined {
    const key = idOrName.trim().toLowerCase();
    return this.list().find((j) => j.id === idOrName || j.name.toLowerCase() === key);
  }

  add(input: JobCreateInput): Job {
    const schedule = getScheduleProvider('cron');
    schedule.validate(input.cron);
    if (!input.playbookId && !input.playbookQuery?.trim()) {
      throw new Error('Provide playbookId or playbookQuery.');
    }
    if (!input.prompt.trim()) throw new Error('prompt is required.');
    if (!input.cwd.trim()) throw new Error('cwd is required.');

    const data = this.readFile();
    const name = input.name.trim();
    if (!name) throw new Error('name is required.');
    if (data.jobs.some((j) => j.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Job name "${name}" already exists.`);
    }

    const now = new Date();
    const id = `${slugify(name) || 'job'}-${randomUUID().slice(0, 8)}`;
    const job: Job = {
      id,
      name,
      cron: input.cron.trim(),
      playbookId: input.playbookId,
      playbookQuery: input.playbookQuery?.trim() || undefined,
      prompt: input.prompt.trim(),
      cwd: input.cwd.trim(),
      model: input.model?.trim() || undefined,
      telegramProfile: input.telegramProfile?.trim() || undefined,
      mode: input.mode ?? 'notify',
      executor: input.executor ?? 'cursor',
      enabled: input.enabled ?? true,
      nextRunAt: schedule.next(input.cron.trim(), now).toISOString(),
      lastRunAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    data.jobs.push(job);
    this.writeFile(data);
    return job;
  }

  update(idOrName: string, patch: JobUpdateInput): Job {
    const data = this.readFile();
    const idx = data.jobs.findIndex(
      (j) => j.id === idOrName || j.name.toLowerCase() === idOrName.trim().toLowerCase(),
    );
    if (idx < 0) throw new Error(`Job not found: ${idOrName}`);
    const prev = data.jobs[idx]!;
    const schedule = getScheduleProvider('cron');

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('name cannot be empty.');
      if (data.jobs.some((j, i) => i !== idx && j.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Job name "${name}" already exists.`);
      }
      prev.name = name;
    }
    if (patch.cron !== undefined) {
      schedule.validate(patch.cron);
      prev.cron = patch.cron.trim();
      prev.nextRunAt = schedule.next(prev.cron, new Date()).toISOString();
    }
    if (patch.prompt !== undefined) {
      if (!patch.prompt.trim()) throw new Error('prompt cannot be empty.');
      prev.prompt = patch.prompt.trim();
    }
    if (patch.cwd !== undefined) {
      if (!patch.cwd.trim()) throw new Error('cwd cannot be empty.');
      prev.cwd = patch.cwd.trim();
    }
    if (patch.playbookId !== undefined) {
      prev.playbookId = patch.playbookId ?? undefined;
    }
    if (patch.playbookQuery !== undefined) {
      prev.playbookQuery = patch.playbookQuery?.trim() || undefined;
    }
    if (patch.model !== undefined) {
      prev.model = patch.model?.trim() || undefined;
    }
    if (patch.telegramProfile !== undefined) {
      prev.telegramProfile = patch.telegramProfile?.trim() || undefined;
    }
    if (patch.mode !== undefined) prev.mode = patch.mode;
    if (patch.executor !== undefined) prev.executor = patch.executor;
    if (patch.enabled !== undefined) prev.enabled = patch.enabled;

    if (!prev.playbookId && !prev.playbookQuery) {
      throw new Error('Job must keep playbookId or playbookQuery.');
    }

    prev.updatedAt = new Date().toISOString();
    data.jobs[idx] = prev;
    this.writeFile(data);
    return prev;
  }

  remove(idOrName: string): Job {
    const data = this.readFile();
    const idx = data.jobs.findIndex(
      (j) => j.id === idOrName || j.name.toLowerCase() === idOrName.trim().toLowerCase(),
    );
    if (idx < 0) throw new Error(`Job not found: ${idOrName}`);
    const [removed] = data.jobs.splice(idx, 1);
    this.writeFile(data);
    return removed!;
  }

  setNextAndLast(jobId: string, nextRunAt: string | null, lastRunAt: string): void {
    const data = this.readFile();
    const job = data.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.nextRunAt = nextRunAt;
    job.lastRunAt = lastRunAt;
    job.updatedAt = new Date().toISOString();
    this.writeFile(data);
  }

  /**
   * Claim a scheduled slot. Returns the run row if we won the lock, else null
   * (another daemon already claimed it).
   */
  tryClaim(jobId: string, scheduledAt: string): JobRun | null {
    try {
      const info = this.db
        .prepare(
          `INSERT INTO runs (job_id, scheduled_at, started_at, status)
           VALUES (?, ?, ?, 'running')`,
        )
        .run(jobId, scheduledAt, new Date().toISOString());
      return this.getRun(Number(info.lastInsertRowid))!;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') {
        return null;
      }
      throw error;
    }
  }

  finishRun(
    runId: number,
    status: Extract<JobRunStatus, 'succeeded' | 'failed' | 'skipped_missed'>,
    summary?: string,
    error?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET finished_at = ?, status = ?, summary = ?, error = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), status, summary ?? null, error ?? null, runId);
  }

  /** Mark abandoned running rows as failed (daemon crash recovery). */
  recoverStaleRuns(): number {
    const info = this.db
      .prepare(
        `UPDATE runs SET status = 'failed', finished_at = ?, error = COALESCE(error, 'Abandoned: daemon restarted')
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString());
    return info.changes;
  }

  listRuns(jobId: string, limit = 20): JobRun[] {
    const rows = this.db
      .prepare(
        `SELECT id, job_id, scheduled_at, started_at, finished_at, status, summary, error
         FROM runs WHERE job_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(jobId, limit) as Array<{
      id: number;
      job_id: string;
      scheduled_at: string;
      started_at: string | null;
      finished_at: string | null;
      status: JobRunStatus;
      summary: string | null;
      error: string | null;
    }>;
    return rows.map(rowToRun);
  }

  getRun(id: number): JobRun | undefined {
    const row = this.db
      .prepare(
        `SELECT id, job_id, scheduled_at, started_at, finished_at, status, summary, error
         FROM runs WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number;
          job_id: string;
          scheduled_at: string;
          started_at: string | null;
          finished_at: string | null;
          status: JobRunStatus;
          summary: string | null;
          error: string | null;
        }
      | undefined;
    return row ? rowToRun(row) : undefined;
  }
}

function rowToRun(row: {
  id: number;
  job_id: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: JobRunStatus;
  summary: string | null;
  error: string | null;
}): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    summary: row.summary,
    error: row.error,
  };
}
