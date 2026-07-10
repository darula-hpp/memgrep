import type { Command } from 'commander';
import { formatRecallFooter, formatRecallHit } from '../lib/format.js';

export function registerRecallCommand(program: Command): void {
  program
    .command('recall')
    .description('Search memory across all projects')
    .argument('<query...>', 'search query')
    .option('-k <n>', 'number of results', '5')
    .action(async (queryParts: string[], opts: { k: string }) => {
      const { MemoryStore } = await import('../../memory/store.js');
      const store = await MemoryStore.open();
      const hits = await store.search(queryParts.join(' '), Number(opts.k) || 5);
      store.setState('last_recall', JSON.stringify(hits.map((h) => h.id)));
      store.close();
      if (hits.length === 0) {
        console.log('No matching chats in memory.');
        return;
      }
      hits.forEach((hit, i) => {
        const { header, snippet } = formatRecallHit(hit, i === 0);
        console.log(`\n${header}`);
        console.log(snippet);
      });
      console.log(formatRecallFooter());
    });
}
