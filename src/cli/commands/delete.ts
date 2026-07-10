import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { fail } from '../lib/errors.js';

export function registerDeleteCommand(program: Command): void {
  program
    .command('delete')
    .description('Forget a chat, or wipe all memory with --all')
    .argument('[id]', 'chat id to delete')
    .option('--all', 'delete every chat in memory')
    .option('--yes', 'skip confirmation when using --all')
    .action(async (idArg: string | undefined, opts: { all?: boolean; yes?: boolean }) => {
      const { MemoryStore } = await import('../../memory/store.js');

      if (opts.all) {
        if (idArg !== undefined) {
          fail('Pass either a chat id or --all, not both.');
        }
        const store = await MemoryStore.open(undefined, { heal: false });
        const count = store.listChats().length;
        if (count === 0) {
          store.close();
          console.log('Memory is already empty.');
          return;
        }

        if (!opts.yes) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await rl.question(
            `This will delete all ${count} chat(s) from memory. Type "yes" to confirm: `,
          );
          rl.close();
          if (answer.trim().toLowerCase() !== 'yes') {
            store.close();
            console.log('Aborted.');
            return;
          }
        }

        const removed = store.deleteAll();
        await store.persist();
        store.close();
        console.log(
          `Deleted ${removed} chat(s). Memory is empty. (Note: "memgrep ingest" will re-add chats whose transcripts still exist on disk.)`,
        );
        return;
      }

      if (idArg === undefined) {
        fail('Pass a chat id, or use --all to wipe memory.');
      }
      const id = Number(idArg);
      if (!Number.isInteger(id)) {
        fail(`Invalid chat id "${idArg}".`);
      }

      const store = await MemoryStore.open(undefined, { heal: false });
      const removed = store.deleteChat(id);
      if (removed) await store.persist();
      store.close();
      if (!removed) {
        fail(`No chat with id ${id}.`);
      }
      console.log(`Deleted chat ${id}.`);
    });
}
