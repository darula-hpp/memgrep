import type { ToolResult } from '../memory/tools.js';
import type { PostHogService } from './service.js';

/**
 * MCP/CLI-facing PostHog tools — mirrors JiraTools / ProductHuntTools.
 */
export class PostHogTools {
  constructor(private readonly service: PostHogService) {}

  async query(input: { hogql: string; name?: string }): Promise<ToolResult> {
    try {
      const result = await this.service.query(input.hogql, input.name);
      return { text: this.service.formatQuery(result) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async topEvents(input: { days?: number; limit?: number } = {}): Promise<ToolResult> {
    try {
      const result = await this.service.topEvents(input.days ?? 7, input.limit ?? 20);
      return { text: this.service.formatQuery(result) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async featureFlags(): Promise<ToolResult> {
    try {
      const flags = await this.service.listFeatureFlags();
      return { text: this.service.formatFlags(flags) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async getFlag(input: { idOrKey: string }): Promise<ToolResult> {
    try {
      const flag = await this.service.getFeatureFlag(input.idOrKey);
      return { text: this.service.formatFlag(flag) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
