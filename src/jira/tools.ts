import type { ToolResult } from '../memory/tools.js';
import type { JiraService } from './service.js';

/**
 * MCP/CLI-facing Jira tools — mirrors JobsTools so transports stay thin.
 */
export class JiraTools {
  constructor(private readonly service: JiraService) {}

  async search(input: { jql: string; maxResults?: number }): Promise<ToolResult> {
    try {
      const issues = await this.service.search(input.jql, input.maxResults);
      return { text: this.service.formatSearch(issues) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async getIssue(input: { key: string }): Promise<ToolResult> {
    try {
      const issue = await this.service.getIssue(input.key);
      return { text: this.service.formatIssue(issue) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async createIssue(input: {
    project?: string;
    summary: string;
    description?: string;
    issueType?: string;
  }): Promise<ToolResult> {
    try {
      const issue = await this.service.createIssue(input);
      return { text: `Created ${this.service.formatIssue(issue)}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async addComment(input: { key: string; body: string }): Promise<ToolResult> {
    try {
      const result = await this.service.addComment(input.key, input.body);
      return { text: `Comment added to ${input.key}${result.id ? ` (id=${result.id})` : ''}.` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async transition(input: { key: string; transition: string }): Promise<ToolResult> {
    try {
      const result = await this.service.transition(input.key, input.transition);
      return {
        text: `Transitioned ${input.key} via "${result.name}" → status=${result.to}.`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async listProjects(): Promise<ToolResult> {
    try {
      const projects = await this.service.listProjects();
      return { text: this.service.formatProjects(projects) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
