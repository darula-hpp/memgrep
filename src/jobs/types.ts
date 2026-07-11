/** How a job handles side effects after the agent run. */
export type JobMode = 'notify' | 'auto';

/** Which executor runs the job (extensible registry). */
export type JobExecutorKind = 'cursor' | (string & {});

export type Job = {
  id: string;
  name: string;
  /** 5-field cron expression (minute hour dom month dow). */
  cron: string;
  /** Remembered chat id for the playbook (preferred). */
  playbookId?: number;
  /** Fallback: semantic query to find the playbook via recall. */
  playbookQuery?: string;
  /** Prompt sent to the agent at fire time. */
  prompt: string;
  cwd: string;
  model?: string;
  /** Telegram profile for Cursor credentials + notify. */
  telegramProfile?: string;
  mode: JobMode;
  /** Executor kind registered in ExecutorRegistry (default: cursor). */
  executor: JobExecutorKind;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobCreateInput = {
  name: string;
  cron: string;
  prompt: string;
  cwd: string;
  playbookId?: number;
  playbookQuery?: string;
  model?: string;
  telegramProfile?: string;
  mode?: JobMode;
  executor?: JobExecutorKind;
  enabled?: boolean;
};

export type JobUpdateInput = {
  name?: string;
  cron?: string;
  prompt?: string;
  cwd?: string;
  playbookId?: number | null;
  playbookQuery?: string | null;
  model?: string | null;
  telegramProfile?: string | null;
  mode?: JobMode;
  executor?: JobExecutorKind;
  enabled?: boolean;
};

export type JobRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped_missed';

export type JobRun = {
  id: number;
  jobId: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: JobRunStatus;
  summary: string | null;
  error: string | null;
};

export type JobExecuteResult = {
  ok: boolean;
  summary: string;
  error?: string;
};

export type JobsFile = {
  version: 1;
  jobs: Job[];
};
