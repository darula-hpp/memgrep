import type { Command } from 'commander';
import type { SearchMode } from '../../memory/search/index.js';
import { formatRecallFooter, formatRecallHit } from '../lib/format.js';

const SEARCH_MODES = new Set<SearchMode>(['hybrid', 'vector', 'keyword']);

export function registerRecallCommand(program: Command): void {
  program
    .command('recall')
    .description('Search memory across all projects (hybrid by default)')
    .argument('<query...>', 'search query')
    .option('-k <n>', 'number of results', '5')
    .option(
      '--mode <mode>',
      'search backend: hybrid (default), vector, or keyword',
      'hybrid',
    )
    .action(async (queryParts: string[], opts: { k: string; mode: string }) => {
      const mode = opts.mode as SearchMode;
      if (!SEARCH_MODES.has(mode)) {
        console.error(`Invalid --mode "${opts.mode}". Use hybrid, vector, or keyword.`);
        process.exitCode = 1;
        return;
      }

      const { MemoryStore } = await import('../../memory/store.js');
      const store = await MemoryStore.open();
      const hits = await store.search(queryParts.join(' '), Number(opts.k) || 5, { mode });
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
