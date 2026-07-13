import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerProductHuntCommand(program: Command): void {
  const ph = program
    .command('producthunt')
    .alias('ph')
    .description('Configure Product Hunt for memgrep MCP tools');

  ph.command('setup')
    .description('Setup Product Hunt credentials (~/.memgrep/producthunt.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runProductHuntSetup } = await import('../../producthunt/setup.js');
        await runProductHuntSetup({
          existingToken:
            process.env.PRODUCTHUNT_TOKEN?.trim() ||
            process.env.PRODUCT_HUNT_TOKEN?.trim() ||
            process.env.PH_DEVELOPER_TOKEN?.trim(),
          existingApiKey:
            process.env.PRODUCTHUNT_API_KEY?.trim() || process.env.PH_API_KEY?.trim(),
          existingApiSecret:
            process.env.PRODUCTHUNT_API_SECRET?.trim() || process.env.PH_API_SECRET?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  ph.command('status')
    .description('Show whether Product Hunt is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolveProductHuntConfig, redactToken, productHuntConfigPath } = await import(
        '../../producthunt/config.js'
      );
      const resolved = resolveProductHuntConfig();
      if (!resolved) {
        console.log('Product Hunt: not configured');
        console.log(`Expected config: ${productHuntConfigPath()}`);
        console.log('Or set PRODUCTHUNT_TOKEN (Developer Token)');
        console.log('Or PRODUCTHUNT_API_KEY + PRODUCTHUNT_API_SECRET');
        console.log('Run: node dist/cli.js producthunt setup');
        return;
      }
      console.log('Product Hunt: configured');
      console.log(
        `  token:    ${resolved.token ? redactToken(resolved.token) : '(will fetch via API key/secret)'}`,
      );
      console.log(`  apiKey:   ${resolved.apiKey ? redactToken(resolved.apiKey) : '(none)'}`);
      console.log(`  apiSecret:${resolved.apiSecret ? ' set' : ' (none)'}`);
      console.log(`  source:   ${resolved.source}`);
      console.log(`  path:     ${resolved.configPath}`);
    });
}
