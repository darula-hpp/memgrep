import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

export function registerCopyCommand(program: Command): void {
  program
    .command('copy')
    .description('Copy a chat to the clipboard (default: top hit of last recall)')
    .argument('[id]', 'chat id (optional)')
    .action(async (idArg: string | undefined) => {
      const { MemoryStore } = await import('../../memory/store.js');
      const { copyToClipboard } = await import('../../clipboard.js');
      const store = await MemoryStore.open(undefined, { heal: false });

      let id: number | undefined = idArg !== undefined ? Number(idArg) : undefined;
      if (idArg !== undefined && !Number.isInteger(id)) {
        store.close();
        fail(`Invalid chat id "${idArg}".`);
      }

      if (id === undefined) {
        const last = store.getState('last_recall');
        id = last ? (JSON.parse(last) as number[])[0] : undefined;
        if (id === undefined) {
          store.close();
          fail('Nothing to copy. Run "memgrep recall <query>" first, or pass an id.');
        }
      }

      const chat = store.getChat(id);
      store.close();
      if (!chat) {
        fail(`No chat with id ${id}.`);
      }

      const text = `# ${chat.title}\nproject: ${chat.project} | tool: ${chat.tool} | date: ${chat.createdAt.slice(0, 10)}\n\n${chat.content}`;
      if (await copyToClipboard(text)) {
        console.log(`Copied chat ${id} to clipboard (${text.length} chars): ${chat.title}`);
      } else {
        console.error('No clipboard tool found (pbcopy/clip/xclip/wl-copy). Printing instead:\n');
        console.log(text);
        process.exitCode = 1;
      }
    });
}
