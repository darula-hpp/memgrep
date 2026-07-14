import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerNeonCommand(program: Command): void {
  const neon = program.command('neon').description('Configure Neon for memgrep MCP tools');

  neon
    .command('setup')
    .description('Setup Neon API key (~/.memgrep/neon.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runNeonSetup } = await import('../../neon/setup.js');
        await runNeonSetup({
          existingApiKey: process.env.NEON_API_KEY?.trim(),
          existingDefaultProjectId:
            process.env.NEON_PROJECT_ID?.trim() || process.env.NEON_DEFAULT_PROJECT_ID?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  neon
    .command('status')
    .description('Show whether Neon is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolveNeonConfig, redactToken, neonConfigPath } = await import(
        '../../neon/config.js'
      );
      const resolved = resolveNeonConfig();
      if (!resolved) {
        console.log('Neon: not configured');
        console.log(`Expected config: ${neonConfigPath()}`);
        console.log('Or set NEON_API_KEY (optional NEON_PROJECT_ID)');
        console.log('Run: node dist/cli.js neon setup');
        return;
      }
      console.log('Neon: configured');
      console.log(`  apiKey:    ${redactToken(resolved.apiKey)}`);
      console.log(`  projectId: ${resolved.defaultProjectId ?? '(none)'}`);
      console.log(`  source:    ${resolved.source}`);
      console.log(`  path:      ${resolved.configPath}`);
    });
}
