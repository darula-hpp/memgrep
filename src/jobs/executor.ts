import type { Job, JobExecuteResult } from './types.js';

export type JobExecuteContext = {
  /** ISO timestamp of the scheduled slot (or now for manual runs). */
  scheduledAt: string;
  /** True when fired by `jobs run` / MCP jobs_run rather than the daemon tick. */
  manual?: boolean;
  mcpUrl: string;
  mcpToken?: string;
  cursorApiKey: string;
  model: string;
};

/**
 * Pluggable job runners. Register new kinds (shell, webhook, …) on ExecutorRegistry.
 */
export interface JobExecutor {
  readonly kind: string;
  execute(job: Job, ctx: JobExecuteContext): Promise<JobExecuteResult>;
}

export class ExecutorRegistry {
  private readonly map = new Map<string, JobExecutor>();

  register(executor: JobExecutor): void {
    this.map.set(executor.kind, executor);
  }

  get(kind: string): JobExecutor {
    const executor = this.map.get(kind);
    if (!executor) {
      throw new Error(
        `No job executor for kind "${kind}". Registered: ${[...this.map.keys()].join(', ') || '(none)'}`,
      );
    }
    return executor;
  }

  has(kind: string): boolean {
    return this.map.has(kind);
  }
}

export function buildPlaybookPrompt(job: Job, scheduledAt: string): string {
  const lines = [
    'You are running a scheduled memgrep job. Follow the playbook, then do the task.',
    '',
    `Job: ${job.name} (${job.id})`,
    `Scheduled at: ${scheduledAt}`,
    `Mode: ${job.mode} (${job.mode === 'notify' ? 'prefer preview / do not send or mutate externally unless the user already approved; summarize what you would do' : 'you may execute side effects described in the playbook'})`,
    '',
  ];

  if (job.playbookId != null) {
    lines.push(
      `1. Call memgrep MCP tool get_chat with chatId=${job.playbookId} to load the playbook.`,
    );
  } else if (job.playbookQuery) {
    lines.push(
      `1. Call memgrep MCP tool recall with query=${JSON.stringify(job.playbookQuery)}, then get_chat on the best match.`,
    );
  }

  lines.push('2. Execute this task using the playbook:', '', job.prompt, '');
  lines.push(
    '3. Reply with a concise summary of what you did (or would do), including any previews, errors, or next steps.',
  );
  return lines.join('\n');
}
