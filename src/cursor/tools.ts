import type { ToolResult } from '../memory/tools.js';
import type { CursorAgentService } from './service.js';

/**
 * MCP-facing Cursor agent tools — same ToolResult shape as Neon/Jira.
 */
export class CursorTools {
  constructor(private readonly service: CursorAgentService) {}

  async workspaces(): Promise<ToolResult> {
    try {
      return { text: this.service.formatWorkspaces() };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async run(input: {
    prompt: string;
    cwd?: string;
    model?: string;
    mode?: string;
    agentId?: string;
  }): Promise<ToolResult> {
    try {
      const result = await this.service.run(input);
      return { text: result.text, isError: result.ok ? undefined : true };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async status(): Promise<ToolResult> {
    try {
      const cwd = this.service.defaultCwd();
      const workspaces = this.service.listWorkspaces();
      return {
        text: [
          'Cursor MCP agent host ready.',
          `defaultCwd: ${cwd}`,
          `workspaces: ${workspaces.length}`,
          'Tools: cursor_workspaces, cursor_run (pass agentId to resume).',
          'Expose via: memgrep serve --http + any tunnel to the port (set MEMGREP_MCP_TOKEN + MEMGREP_PUBLIC_URL).',
        ].join('\n'),
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
