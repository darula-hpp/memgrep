import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerCopyCommand } from './commands/copy.js';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../../package.json') as { version: string };
import { registerDeleteCommand } from './commands/delete.js';
import { registerIndexCommand } from './commands/index.js';
import { registerIngestCommand } from './commands/ingest.js';
import { registerListCommand } from './commands/list.js';
import { registerRecallCommand } from './commands/recall.js';
import { registerRememberCommand } from './commands/remember.js';
import { registerScanCommand } from './commands/scan.js';
import { registerSearchCommand } from './commands/search.js';
import { registerServeCommand } from './commands/serve.js';
import { registerShowCommand } from './commands/show.js';
import { registerTelegramCommand } from './commands/telegram.js';
import { registerJobsCommand } from './commands/jobs.js';
import { registerJiraCommand } from './commands/jira.js';
import { registerProductHuntCommand } from './commands/producthunt.js';
import { registerPostHogCommand } from './commands/posthog.js';
import { registerNeonCommand } from './commands/neon.js';
import { registerUpstashCommand } from './commands/upstash.js';
import { registerGcloudCommand } from './commands/gcloud.js';
import { registerCursorCommand } from './commands/cursor.js';
import { registerLoopCommand } from './commands/loop.js';
import { registerEdgeCommand } from './commands/edge.js';
import { registerDocsCommand } from './commands/docs.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('memgrep')
    .description(
      'Local agent memory + Cursor from your phone (Telegram), scheduled jobs, MCP, and semantic file search',
    )
    .version(PACKAGE_VERSION)
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: true })
    .action(() => {
      program.outputHelp();
    });

  registerIndexCommand(program);
  registerSearchCommand(program);
  registerScanCommand(program);
  registerIngestCommand(program);
  registerListCommand(program);
  registerRecallCommand(program);
  registerShowCommand(program);
  registerCopyCommand(program);
  registerDeleteCommand(program);
  registerRememberCommand(program);
  registerServeCommand(program);
  registerTelegramCommand(program);
  registerJobsCommand(program);
  registerJiraCommand(program);
  registerProductHuntCommand(program);
  registerPostHogCommand(program);
  registerNeonCommand(program);
  registerUpstashCommand(program);
  registerGcloudCommand(program);
  registerCursorCommand(program);
  registerLoopCommand(program);
  registerEdgeCommand(program);
  registerDocsCommand(program);

  return program;
}
