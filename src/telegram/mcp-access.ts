import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolResult } from '../memory/tools.js';
import type { MemoryAccess } from './types.js';

function textFromToolResult(result: unknown): ToolResult {
  const r = result as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('\n');
  return { text: text || '(empty response)', isError: r.isError };
}

/**
 * MemoryAccess over Streamable HTTP MCP — used when Telegram talks to a
 * separately running `memgrep serve --http`.
 */
export class McpMemoryAccess implements MemoryAccess {
  private constructor(
    private readonly client: Client,
    private readonly transport: StreamableHTTPClientTransport,
  ) {}

  static async connect(url: string, authToken?: string): Promise<McpMemoryAccess> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: authToken
        ? { headers: { Authorization: `Bearer ${authToken}` } }
        : undefined,
    });
    const client = new Client({ name: 'memgrep-telegram', version: '0.1.0' });
    await client.connect(transport);
    return new McpMemoryAccess(client, transport);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    return textFromToolResult(result);
  }

  recall(query: string, k?: number): Promise<ToolResult> {
    return this.call('recall', { query, ...(k !== undefined ? { k } : {}) });
  }

  getChat(chatId: number): Promise<ToolResult> {
    return this.call('get_chat', { chatId });
  }

  listChats(project?: string): Promise<ToolResult> {
    return this.call('list_chats', { ...(project ? { project } : {}) });
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }
}
