import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerGcloudCommand(program: Command): void {
  const gcloud = program.command('gcloud').description('Configure Google Cloud for memgrep MCP tools');

  gcloud
    .command('setup')
    .description('Setup Google Cloud project/credentials (~/.memgrep/gcloud.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runGcloudSetup } = await import('../../gcloud/setup.js');
        await runGcloudSetup({
          existingProjectId:
            process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim(),
          existingCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  gcloud
    .command('status')
    .description('Show whether Google Cloud is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolveGcloudConfig, redactPath, gcloudConfigPath } = await import(
        '../../gcloud/config.js'
      );
      const resolved = resolveGcloudConfig();
      if (!resolved) {
        console.log('gcloud: not configured');
        console.log(`Expected config: ${gcloudConfigPath()}`);
        console.log('Or set GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT (optional GOOGLE_APPLICATION_CREDENTIALS)');
        console.log('Run: node dist/cli.js gcloud setup');
        return;
      }
      console.log('gcloud: configured');
      console.log(`  projectId: ${resolved.projectId}`);
      console.log(
        `  credentials: ${resolved.credentialsPath ? redactPath(resolved.credentialsPath) : 'ADC'}`,
      );
      console.log(`  defaultZone: ${resolved.defaultZone ?? '(none)'}`);
      console.log(`  source:    ${resolved.source}`);
      console.log(`  path:      ${resolved.configPath}`);
    });
}
