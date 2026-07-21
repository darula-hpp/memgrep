import type { ToolResult } from '../memory/tools.js';
import { getEdgeHub, invokeEdgeTool, type EdgeHub } from './hub.js';

/**
 * Cloud MCP tools that proxy to the connected edge node (or report presence).
 */
export class EdgeTools {
  constructor(private readonly hub: EdgeHub | null = getEdgeHub()) {}

  status(): ToolResult {
    const hub = this.hub ?? getEdgeHub();
    if (!hub) {
      return {
        text: JSON.stringify({
          online: false,
          note: 'Edge hub not attached (start memgrep serve --http on the cloud host).',
        }),
      };
    }
    return { text: JSON.stringify(hub.getPresence(), null, 2) };
  }

  async ping(): Promise<ToolResult> {
    return this.invoke('edge_ping', {});
  }

  async run(input: {
    argv: string[];
    cwd?: string;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    return this.invoke('edge_run', {
      argv: input.argv,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    });
  }

  async loopRun(input: {
    task: string;
    jiraKey?: string;
    profile?: string;
    inputs?: unknown[];
    exits?: unknown[];
    actions?: unknown[];
    cwd?: string;
    agentId?: string;
    maxIterations?: number;
    query?: string;
    telegramProfile?: string;
    notify?: boolean;
  }): Promise<ToolResult> {
    return this.invoke('edge_loop_run', { ...input }, 60_000);
  }

  async cursorRun(input: {
    prompt: string;
    cwd: string;
    model?: string;
    mcpUrl?: string;
    mcpToken?: string;
  }): Promise<ToolResult> {
    return this.invoke('edge_cursor_run', { ...input }, 600_000);
  }

  private async invoke(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<ToolResult> {
    const result = await invokeEdgeTool(name, args, {
      hub: this.hub ?? getEdgeHub(),
      timeoutMs,
    });
    return { text: result.text, isError: result.isError || !result.ok };
  }
}
