import { Agent, CursorAgentError } from '@cursor/sdk';
import { existsSync } from 'node:fs';
import type { JobExecutor, JobExecuteContext } from './executor.js';
import { buildPlaybookPrompt } from './executor.js';
import type { Job, JobExecuteResult } from './types.js';

/**
 * Default executor: one-shot Cursor agent with memgrep MCP attached.
 */
export class CursorJobExecutor implements JobExecutor {
  readonly kind = 'cursor';

  async execute(job: Job, ctx: JobExecuteContext): Promise<JobExecuteResult> {
    if (!existsSync(job.cwd)) {
      return { ok: false, summary: '', error: `cwd does not exist: ${job.cwd}` };
    }

    const prompt = buildPlaybookPrompt(job, ctx.scheduledAt);
    const headers = ctx.mcpToken
      ? { Authorization: `Bearer ${ctx.mcpToken}` }
      : undefined;

    let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
    try {
      agent = await Agent.create({
        apiKey: ctx.cursorApiKey,
        model: { id: ctx.model },
        name: `memgrep-job-${job.name}`.slice(0, 64),
        local: { cwd: job.cwd },
        mcpServers: {
          memgrep: {
            type: 'http',
            url: ctx.mcpUrl,
            ...(headers ? { headers } : {}),
          },
        },
      });

      const run = await agent.send(prompt);
      const result = await run.wait();
      if (result.status === 'error') {
        return {
          ok: false,
          summary: '',
          error: `Cursor run failed (${result.id}). Check the Cursor dashboard / local logs.`,
        };
      }
      const text = result.result?.trim() || '(Cursor finished with no text reply.)';
      return { ok: true, summary: text };
    } catch (error) {
      if (error instanceof CursorAgentError) {
        return {
          ok: false,
          summary: '',
          error: `Cursor error: ${error.message}${error.isRetryable ? ' (retryable)' : ''}`,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, summary: '', error: `Cursor error: ${message}` };
    } finally {
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
    }
  }
}
