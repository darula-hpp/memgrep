import { Command } from 'commander';
import { registerCopyCommand } from './commands/copy.js';
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

export function createProgram(): Command {
  const program = new Command();

  program
    .name('memgrep')
    .description('Local semantic search over your files and agent chats')
    .version('0.1.3')
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

  return program;
}
