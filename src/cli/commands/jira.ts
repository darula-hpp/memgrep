import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

export function registerJiraCommand(program: Command): void {
  const jira = program.command('jira').description('Configure Atlassian Cloud Jira for memgrep MCP tools');

  jira
    .command('setup')
    .description('Interactive setup for Jira Cloud credentials (~/.memgrep/jira.json)')
    .action(async () => {
      await loadDotenv();
      try {
        const { runJiraSetup } = await import('../../jira/setup.js');
        await runJiraSetup({
          existingHost: process.env.JIRA_HOST?.trim(),
          existingEmail: process.env.JIRA_EMAIL?.trim(),
          existingApiToken: process.env.JIRA_API_TOKEN?.trim(),
          existingDefaultProject: process.env.JIRA_DEFAULT_PROJECT?.trim(),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  jira
    .command('status')
    .description('Show whether Jira is configured for MCP tools')
    .action(async () => {
      await loadDotenv();
      const { resolveJiraConfig, redactToken, jiraConfigPath } = await import('../../jira/config.js');
      const resolved = resolveJiraConfig();
      if (!resolved) {
        console.log('Jira: not configured');
        console.log(`Expected config: ${jiraConfigPath()}`);
        console.log('Or set JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN');
        console.log('Run: node dist/cli.js jira setup');
        return;
      }
      console.log('Jira: configured');
      console.log(`  host:    ${resolved.host}`);
      console.log(`  email:   ${resolved.email}`);
      console.log(`  token:   ${redactToken(resolved.apiToken)}`);
      console.log(`  project: ${resolved.defaultProject ?? '(none)'}`);
      console.log(`  source:  ${resolved.source}`);
      console.log(`  path:    ${resolved.configPath}`);
    });
}
