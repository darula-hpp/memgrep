import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerUpstashCommand(program: Command): void {
  const upstash = program
    .command('upstash')
    .description('Configure Upstash Redis for memgrep MCP tools');

  upstash
    .command('setup')
    .description('Setup Upstash Redis REST credentials (~/.memgrep/upstash.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runUpstashSetup } = await import('../../upstash/setup.js');
        await runUpstashSetup({
          existingRestUrl: process.env.UPSTASH_REDIS_REST_URL?.trim(),
          existingToken: process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  upstash
    .command('status')
    .description('Show whether Upstash is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolveUpstashConfig, redactToken, upstashConfigPath } = await import(
        '../../upstash/config.js'
      );
      const resolved = resolveUpstashConfig();
      if (!resolved) {
        console.log('Upstash: not configured');
        console.log(`Expected config: ${upstashConfigPath()}`);
        console.log('Or set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
        console.log('Run: node dist/cli.js upstash setup');
        return;
      }
      console.log('Upstash: configured');
      console.log(`  restUrl: ${resolved.restUrl}`);
      console.log(`  token:   ${redactToken(resolved.token)}`);
      console.log(`  source:  ${resolved.source}`);
      console.log(`  path:    ${resolved.configPath}`);
    });
}
