import type { Command } from 'commander';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server (stdio) for agents')
    .action(async () => {
      const { startMcpServer } = await import('../../memory/mcp.js');
      await startMcpServer();
      // keep process alive; the MCP transport owns stdio from here
    });
}
