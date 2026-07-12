import { existsSync } from 'node:fs';
import { createCursorProvider } from '../telegram/agent/providers/cursor.js';
import type { JobExecutor, JobExecuteContext } from './executor.js';
import { buildPlaybookPrompt } from './executor.js';
import type { Job, JobExecuteResult } from './types.js';

/**
 * Default executor: one-shot Cursor agent via CodingAgentProvider (same adapter as Telegram).
 */
export class CursorJobExecutor implements JobExecutor {
  readonly kind = 'cursor';

  constructor(private readonly provider = createCursorProvider()) {}

  async execute(job: Job, ctx: JobExecuteContext): Promise<JobExecuteResult> {
    if (!existsSync(job.cwd)) {
      return { ok: false, summary: '', error: `cwd does not exist: ${job.cwd}` };
    }

    const prompt = buildPlaybookPrompt(job, ctx.scheduledAt);
    const session = await this.provider.create({
      apiKey: ctx.cursorApiKey,
      cwd: job.cwd,
      model: ctx.model,
      mcpUrl: ctx.mcpUrl,
      mcpToken: ctx.mcpToken,
      name: `memgrep-job-${job.name}`.slice(0, 64),
    });

    try {
      const run = await session.send(prompt);
      const result = await run.wait();
      if (result.status === 'error') {
        return {
          ok: false,
          summary: '',
          error: `Cursor run failed (${result.id}). Check the Cursor dashboard / local logs.`,
        };
      }
      if (result.status === 'cancelled') {
        return { ok: false, summary: '', error: `Cursor run cancelled (${result.id}).` };
      }
      const text = result.result?.trim() || '(Cursor finished with no text reply.)';
      return { ok: true, summary: text };
    } catch (error) {
      const retryable = this.provider.isRetryableError?.(error) === true;
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        summary: '',
        error: `Cursor error: ${message}${retryable ? ' (retryable)' : ''}`,
      };
    } finally {
      await session.dispose();
    }
  }
}
