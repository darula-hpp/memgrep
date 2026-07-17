import type { ToolResult } from '../memory/tools.js';
import type { GcloudService } from './service.js';

/**
 * MCP/CLI-facing Google Cloud tools — mirrors NeonTools / UpstashTools.
 */
export class GcloudTools {
  constructor(private readonly service: GcloudService) {}

  async listProjects(): Promise<ToolResult> {
    try {
      const projects = await this.service.listProjects();
      return { text: this.service.formatProjects(projects) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async logsQuery(
    input: {
      filter?: string;
      pageSize?: number;
      projectId?: string;
    } = {},
  ): Promise<ToolResult> {
    try {
      const entries = await this.service.queryLogs(input);
      return { text: this.service.formatLogEntries(entries) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async listInstances(
    input: {
      zone?: string;
      projectId?: string;
    } = {},
  ): Promise<ToolResult> {
    try {
      const instances = await this.service.listInstances(input);
      return { text: this.service.formatInstances(instances) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async getInstance(input: {
    name: string;
    zone: string;
    projectId?: string;
  }): Promise<ToolResult> {
    try {
      const instance = await this.service.getInstance(input);
      return { text: this.service.formatInstance(instance) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
