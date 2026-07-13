import type { ProductHuntClient, ProductHuntComment, ProductHuntPost } from './client.js';

/**
 * Shared Product Hunt business logic for MCP and CLI.
 */
export class ProductHuntService {
  constructor(private readonly client: ProductHuntClient) {}

  async verify(): Promise<{ samplePost?: string }> {
    return this.client.verify();
  }

  async today(limit?: number): Promise<ProductHuntPost[]> {
    return this.client.today(limit ?? 20);
  }

  async search(query: string, limit = 10): Promise<ProductHuntPost[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      throw new Error('Search query is required.');
    }
    // Official GraphQL has no full-text search; filter recent posts by name/tagline.
    const recent = await this.client.recent(Math.min(Math.max(limit * 4, 40), 50));
    return recent
      .filter((p) => {
        const hay = `${p.name} ${p.tagline} ${p.slug}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, limit);
  }

  async getPost(idOrSlug: string): Promise<ProductHuntPost> {
    return this.client.getPost(idOrSlug);
  }

  async comments(idOrSlug: string, limit?: number): Promise<{
    post: ProductHuntPost;
    comments: ProductHuntComment[];
  }> {
    return this.client.comments(idOrSlug, limit ?? 20);
  }

  formatPost(post: ProductHuntPost, verbose = false): string {
    const lines = [
      `${post.name} (${post.votesCount}▲ ${post.commentsCount}💬)`,
      `  ${post.tagline}`,
      `  slug=${post.slug} id=${post.id}`,
      `  ${post.url}`,
    ];
    if (post.website) lines.push(`  website=${post.website}`);
    if (verbose && post.description) {
      lines.push('', post.description.slice(0, 2000));
    }
    return lines.join('\n');
  }

  formatPosts(posts: ProductHuntPost[]): string {
    if (posts.length === 0) return 'No Product Hunt posts matched.';
    return posts.map((p) => this.formatPost(p)).join('\n\n');
  }

  formatComments(post: ProductHuntPost, comments: ProductHuntComment[]): string {
    const header = this.formatPost(post);
    if (comments.length === 0) {
      return `${header}\n\nNo comments.`;
    }
    const body = comments
      .map((c) => {
        const who = c.userUsername ? `@${c.userUsername}` : c.userName || 'user';
        return `${who} (${c.votesCount}▲):\n  ${c.body.replace(/\s+/g, ' ').slice(0, 500)}`;
      })
      .join('\n\n');
    return `${header}\n\nComments:\n\n${body}`;
  }
}
