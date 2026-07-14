import type { ToolResult } from '../memory/tools.js';
import type { NeonService } from './service.js';

/**
 * MCP/CLI-facing Neon tools — mirrors PostHogTools / JiraTools.
 */
export class NeonTools {
  constructor(private readonly service: NeonService) {}

  async listProjects(): Promise<ToolResult> {
    try {
      const projects = await this.service.listProjects();
      return { text: this.service.formatProjects(projects) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async getProject(input: { projectId?: string } = {}): Promise<ToolResult> {
    try {
      const project = await this.service.getProject(input.projectId);
      return { text: this.service.formatProject(project) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async listBranches(input: { projectId?: string } = {}): Promise<ToolResult> {
    try {
      const branches = await this.service.listBranches(input.projectId);
      return { text: this.service.formatBranches(branches) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async connectionUri(input: {
    projectId?: string;
    branchId?: string;
    databaseName?: string;
    roleName?: string;
  } = {}): Promise<ToolResult> {
    try {
      const { uri } = await this.service.connectionUri(input);
      return {
        text:
          `Connection URI (password redacted):\n${this.service.formatConnectionUri(uri)}\n\n` +
          `Full URI (for local use):\n${uri}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
