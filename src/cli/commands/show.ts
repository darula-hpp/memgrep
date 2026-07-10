import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

export function registerShowCommand(program: Command): void {
  program
    .command('show')
    .description('Print a remembered chat')
    .argument('<id>', 'chat id')
    .action(async (idArg: string) => {
      const id = Number(idArg);
      if (!Number.isInteger(id)) {
        fail(`Invalid chat id "${idArg}".`);
      }
      const { MemoryStore } = await import('../../memory/store.js');
      const store = await MemoryStore.open(undefined, { heal: false });
      const chat = store.getChat(id);
      store.close();
      if (!chat) {
        fail(`No chat with id ${id}.`);
      }
      console.log(`# ${chat.title}\nproject: ${chat.project} | date: ${chat.createdAt.slice(0, 10)}\n`);
      console.log(chat.content);
    });
}
