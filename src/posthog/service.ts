import type {
  PostHogClient,
  PostHogFeatureFlag,
  PostHogProject,
  PostHogQueryResult,
} from './client.js';

/**
 * Shared PostHog business logic for MCP and CLI.
 */
export class PostHogService {
  constructor(private readonly client: PostHogClient) {}

  async verify(): Promise<PostHogProject> {
    return this.client.getProject();
  }

  async query(hogql: string, name?: string): Promise<PostHogQueryResult> {
    return this.client.query(hogql, name);
  }

  async topEvents(days = 7, limit = 20): Promise<PostHogQueryResult> {
    const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    const hogql = `
SELECT event, count() AS count
FROM events
WHERE timestamp >= now() - INTERVAL ${safeDays} DAY
GROUP BY event
ORDER BY count DESC
LIMIT ${safeLimit}
`.trim();
    return this.client.query(hogql, `memgrep top_events ${safeDays}d`);
  }

  async listFeatureFlags(): Promise<PostHogFeatureFlag[]> {
    return this.client.listFeatureFlags();
  }

  async getFeatureFlag(idOrKey: string): Promise<PostHogFeatureFlag> {
    return this.client.getFeatureFlag(idOrKey);
  }

  formatQuery(result: PostHogQueryResult): string {
    if (result.results.length === 0) {
      return result.columns.length > 0
        ? `No rows.\nColumns: ${result.columns.join(', ')}`
        : 'No rows.';
    }
    const header = result.columns.join('\t');
    const lines = result.results.map((row) =>
      row.map((cell) => formatCell(cell)).join('\t'),
    );
    return [header, ...lines].join('\n');
  }

  formatFlags(flags: PostHogFeatureFlag[]): string {
    if (flags.length === 0) return 'No feature flags.';
    return flags
      .map(
        (f) =>
          `${f.active ? 'ON ' : 'OFF'} ${f.key} (id=${f.id})${f.name ? ` — ${f.name}` : ''}`,
      )
      .join('\n');
  }

  formatFlag(flag: PostHogFeatureFlag): string {
    const lines = [
      `${flag.active ? 'ON' : 'OFF'} ${flag.key} (id=${flag.id})`,
      flag.name ? `name: ${flag.name}` : null,
      flag.filters !== undefined
        ? `filters: ${JSON.stringify(flag.filters).slice(0, 2000)}`
        : null,
    ].filter(Boolean);
    return lines.join('\n');
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\t|\n/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).replace(/\t|\n/g, ' ');
}
