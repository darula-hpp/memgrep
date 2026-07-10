import type { Command } from 'commander';
import { formatListLine } from '../lib/format.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List remembered chats')
    .option('--project <name>', 'filter by project')
    .action(async (opts: { project?: string }) => {
      const { MemoryStore } = await import('../../memory/store.js');
      const store = await MemoryStore.open(undefined, { heal: false });
      const chats = store.listChats(opts.project);
      store.close();
      if (chats.length === 0) {
        console.log('Memory is empty. Run "memgrep ingest" or "memgrep remember <text>".');
        return;
      }
      for (const c of chats) {
        console.log(formatListLine(c));
      }
    });
}
