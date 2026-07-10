import type { Command } from 'commander';
import path from 'node:path';

export function registerRememberCommand(program: Command): void {
  program
    .command('remember')
    .description('Store a manual note in memory')
    .argument('<text...>', 'note text')
    .option('--title <title>', 'note title')
    .option('--project <name>', 'project name')
    .action(async (textParts: string[], opts: { title?: string; project?: string }) => {
      const text = textParts.join(' ');
      const { MemoryStore } = await import('../../memory/store.js');
      const store = await MemoryStore.open();
      const id = await store.addChat({
        title: opts.title ?? (text.length > 80 ? `${text.slice(0, 77)}...` : text),
        project: opts.project ?? path.basename(process.cwd()),
        content: text,
        tool: 'note',
      });
      await store.persist();
      store.close();
      console.log(id === null ? 'Already remembered.' : `Remembered as chat ${id}.`);
    });
}
