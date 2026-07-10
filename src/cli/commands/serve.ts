import type { Command } from 'commander';
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT } from '../../memory/mcp.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server (stdio by default, or HTTP for Telegram / remote clients)')
    .option('--http', 'serve over Streamable HTTP instead of stdio')
    .option('--host <host>', 'HTTP bind host (default 127.0.0.1)', DEFAULT_HTTP_HOST)
    .option('--port <n>', 'HTTP port', String(DEFAULT_HTTP_PORT))
    .option('--token <token>', 'Bearer token (required for non-loopback hosts; or set MEMGREP_MCP_TOKEN)')
    .action(async (opts: { http?: boolean; host: string; port: string; token?: string }) => {
      const { startMcpServer } = await import('../../memory/mcp.js');
      if (opts.http) {
        await startMcpServer({
          transport: 'http',
          host: opts.host,
          port: Number(opts.port) || DEFAULT_HTTP_PORT,
          authToken: opts.token,
        });
        // keep process alive
        await new Promise(() => {});
        return;
      }
      await startMcpServer({ transport: 'stdio' });
    });
}
