import { invokeEdgeTool } from '../edge/hub.js';
import type { JobExecutor, JobExecuteContext } from './executor.js';
import { buildPlaybookPrompt } from './executor.js';
import type { Job, JobExecuteResult } from './types.js';

/**
 * Run a one-shot Cursor playbook turn on the connected edge node.
 * Requires edge online with edge_cursor_run enabled.
 */
export class EdgeJobExecutor implements JobExecutor {
  readonly kind = 'edge';

  async execute(job: Job, ctx: JobExecuteContext): Promise<JobExecuteResult> {
    const prompt = buildPlaybookPrompt(job, ctx.scheduledAt);
    const result = await invokeEdgeTool(
      'edge_cursor_run',
      {
        prompt,
        cwd: job.cwd,
        model: job.model ?? ctx.model,
        mcpUrl: ctx.mcpUrl,
        mcpToken: ctx.mcpToken,
      },
      {
        hubUrl: ctx.mcpUrl,
        token: ctx.mcpToken,
        timeoutMs: 600_000,
      },
    );
    if (!result.ok || result.isError) {
      return { ok: false, summary: '', error: result.text || 'edge cursor run failed' };
    }
    return { ok: true, summary: result.text };
  }
}
