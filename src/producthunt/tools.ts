import type { ToolResult } from '../memory/tools.js';
import type { ProductHuntService } from './service.js';

/**
 * MCP/CLI-facing Product Hunt tools — mirrors JobsTools / JiraTools.
 */
export class ProductHuntTools {
  constructor(private readonly service: ProductHuntService) {}

  async today(input: { limit?: number } = {}): Promise<ToolResult> {
    try {
      const posts = await this.service.today(input.limit);
      return { text: this.service.formatPosts(posts) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async search(input: { query: string; limit?: number }): Promise<ToolResult> {
    try {
      const posts = await this.service.search(input.query, input.limit);
      return { text: this.service.formatPosts(posts) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async getPost(input: { idOrSlug: string }): Promise<ToolResult> {
    try {
      const post = await this.service.getPost(input.idOrSlug);
      return { text: this.service.formatPost(post, true) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async comments(input: { idOrSlug: string; limit?: number }): Promise<ToolResult> {
    try {
      const { post, comments } = await this.service.comments(input.idOrSlug, input.limit);
      return { text: this.service.formatComments(post, comments) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
