import type { ToolResult } from '../memory/tools.js';
import type { JobsService } from './service.js';
import type { JobCreateInput, JobMode, JobUpdateInput } from './types.js';

/**
 * MCP/CLI-facing job tools — mirrors MemoryTools so transports stay thin.
 */
export class JobsTools {
  constructor(private readonly service: JobsService) {}

  list(): ToolResult {
    return this.service.formatList();
  }

  show(idOrName: string): ToolResult {
    return this.service.formatShow(idOrName);
  }

  add(input: {
    name: string;
    cron: string;
    prompt: string;
    cwd: string;
    playbookId?: number;
    playbookQuery?: string;
    model?: string;
    telegramProfile?: string;
    mode?: JobMode;
    enabled?: boolean;
  }): ToolResult {
    try {
      const job = this.service.add(input as JobCreateInput);
      return {
        text: `Created job ${job.name} (${job.id}). next=${job.nextRunAt}. mode=${job.mode}.`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  update(idOrName: string, patch: JobUpdateInput): ToolResult {
    try {
      const job = this.service.update(idOrName, patch);
      return { text: `Updated job ${job.name} (${job.id}).` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  remove(idOrName: string): ToolResult {
    try {
      const job = this.service.remove(idOrName);
      return { text: `Removed job ${job.name} (${job.id}).` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  enable(idOrName: string, enabled: boolean): ToolResult {
    try {
      const job = this.service.enable(idOrName, enabled);
      return { text: `${enabled ? 'Enabled' : 'Disabled'} job ${job.name}.` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async run(idOrName: string): Promise<ToolResult> {
    // Self-contained run: embed MCP + Cursor executor (works from CLI, stdio MCP, Telegram).
    const { createRunnableJobsService } = await import('./daemon.js');
    const { service, close } = await createRunnableJobsService();
    try {
      const { job, result } = await service.runNow(idOrName);
      if (!result.ok) {
        return {
          text: `Job ${job.name} failed: ${result.error ?? 'unknown'}\n${result.summary}`.trim(),
          isError: true,
        };
      }
      return { text: `Job ${job.name} finished.\n${result.summary}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    } finally {
      await close();
    }
  }

  logs(idOrName: string, limit?: number): ToolResult {
    return this.service.formatLogs(idOrName, limit ?? 10);
  }
}
