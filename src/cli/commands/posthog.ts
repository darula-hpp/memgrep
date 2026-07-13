import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerPostHogCommand(program: Command): void {
  const posthog = program
    .command('posthog')
    .description('Configure PostHog for memgrep MCP tools');

  posthog
    .command('setup')
    .description('Setup PostHog credentials (~/.memgrep/posthog.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runPostHogSetup } = await import('../../posthog/setup.js');
        await runPostHogSetup({
          existingHost: process.env.POSTHOG_HOST?.trim(),
          existingApiKey:
            process.env.POSTHOG_API_KEY?.trim() ||
            process.env.POSTHOG_PERSONAL_API_KEY?.trim(),
          existingProjectId: process.env.POSTHOG_PROJECT_ID?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  posthog
    .command('status')
    .description('Show whether PostHog is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolvePostHogConfig, redactToken, posthogConfigPath } = await import(
        '../../posthog/config.js'
      );
      const resolved = resolvePostHogConfig();
      if (!resolved) {
        console.log('PostHog: not configured');
        console.log(`Expected config: ${posthogConfigPath()}`);
        console.log('Or set POSTHOG_API_KEY + POSTHOG_PROJECT_ID (optional POSTHOG_HOST)');
        console.log('Run: node dist/cli.js posthog setup');
        return;
      }
      console.log('PostHog: configured');
      console.log(`  host:      ${resolved.host}`);
      console.log(`  projectId: ${resolved.projectId}`);
      console.log(`  apiKey:    ${redactToken(resolved.apiKey)}`);
      console.log(`  source:    ${resolved.source}`);
      console.log(`  path:      ${resolved.configPath}`);
    });
}
