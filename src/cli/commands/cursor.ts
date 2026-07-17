import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerCursorCommand(program: Command): void {
  const cursor = program
    .command('cursor')
    .description('Configure local Cursor agent for memgrep MCP tools (tunnel via serve --http)');

  cursor
    .command('setup')
    .description('Setup CURSOR_API_KEY + workspace allowlist (~/.memgrep/cursor.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runCursorSetup } = await import('../../cursor/setup.js');
        await runCursorSetup({
          existingApiKey: process.env.CURSOR_API_KEY?.trim(),
          existingCwd:
            process.env.MEMGREP_CURSOR_CWD?.trim() || process.env.MEMGREP_TELEGRAM_CWD?.trim(),
          existingTelegramProfile:
            process.env.MEMGREP_CURSOR_PROFILE?.trim() ||
            process.env.MEMGREP_TELEGRAM_PROFILE?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  cursor
    .command('status')
    .description('Show whether Cursor MCP agent tools are configured')
    .action(async () => {
      await loadDotenv();
      const { resolveCursorConfig, redactToken, cursorConfigPath } = await import(
        '../../cursor/config.js'
      );
      const resolved = resolveCursorConfig();
      if (!resolved) {
        console.log('Cursor MCP: not configured');
        console.log(`Expected config: ${cursorConfigPath()}`);
        console.log('Or set CURSOR_API_KEY (workspaces from telegram profile / cursor setup)');
        console.log('Run: node dist/cli.js cursor setup');
        return;
      }
      console.log('Cursor MCP: configured');
      console.log(`  apiKey:     ${redactToken(resolved.apiKey)}`);
      console.log(`  cwd:        ${resolved.cwd}`);
      console.log(`  workspaces: ${resolved.workspaces.length}`);
      console.log(`  model:      ${resolved.model}`);
      console.log(`  mode:       ${resolved.agentMode}`);
      console.log(`  mcpUrl:     ${resolved.mcpUrl}`);
      console.log(`  source:     ${resolved.source}`);
      console.log(`  path:       ${resolved.configPath}`);
      console.log('\nTunnel tip:');
      console.log('  MEMGREP_MCP_TOKEN=… node dist/cli.js serve --http');
      console.log('  (public tunnels are optional/external; npm start keeps MCP on loopback only)');
    });
}
