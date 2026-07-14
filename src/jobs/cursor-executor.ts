import { existsSync } from 'node:fs';
import { createCursorProvider } from '../cursor/providers/cursor.js';
import { runAgentTurn } from '../cursor/runner.js';
import type { JobExecutor, JobExecuteContext } from './executor.js';
import { buildPlaybookPrompt } from './executor.js';
import type { Job, JobExecuteResult } from './types.js';

/**
 * Default executor: one-shot Cursor agent via CodingAgentProvider (same adapter as Telegram/MCP).
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
      const turn = await runAgentTurn(session, prompt, {
        providerId: this.provider.id,
        isRetryableError: (e) => this.provider.isRetryableError?.(e) === true,
        logPrefix: 'memgrep jobs',
      });
      if (!turn.ok) {
        return { ok: false, summary: '', error: turn.text };
      }
      return { ok: true, summary: turn.text };
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
