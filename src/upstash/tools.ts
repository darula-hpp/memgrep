import type { ToolResult } from '../memory/tools.js';
import type { UpstashService } from './service.js';

/**
 * MCP/CLI-facing Upstash Redis tools — mirrors NeonTools / PostHogTools.
 */
export class UpstashTools {
  constructor(private readonly service: UpstashService) {}

  async ping(): Promise<ToolResult> {
    try {
      const me = await this.service.verify();
      return {
        text: `PONG from ${me.restUrl}\ndbsize=${me.dbsize}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async get(input: { key: string }): Promise<ToolResult> {
    try {
      const value = await this.service.get(input.key);
      return { text: this.service.formatGet(input.key.trim(), value) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async set(input: { key: string; value: string; exSeconds?: number }): Promise<ToolResult> {
    try {
      const result = await this.service.set(input.key, input.value, input.exSeconds);
      return {
        text:
          `SET ${input.key.trim()} → ${result}` +
          (input.exSeconds ? ` EX ${input.exSeconds}` : ''),
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async del(input: { keys: string[] }): Promise<ToolResult> {
    try {
      const n = await this.service.del(input.keys);
      return { text: `DEL removed ${n} key(s)` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async dbsize(): Promise<ToolResult> {
    try {
      const n = await this.service.dbsize();
      return { text: `dbsize=${n}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async ttl(input: { key: string }): Promise<ToolResult> {
    try {
      const ttl = await this.service.ttl(input.key);
      return { text: this.service.formatTtl(input.key.trim(), ttl) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async type(input: { key: string }): Promise<ToolResult> {
    try {
      const t = await this.service.type(input.key);
      return { text: `key=${input.key.trim()} type=${t}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async scan(input: {
    cursor?: string;
    match?: string;
    count?: number;
  } = {}): Promise<ToolResult> {
    try {
      const result = await this.service.scan(input);
      return { text: this.service.formatScan(result) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
