import type { Command } from 'commander';
import { fail } from '../lib/errors.js';
import { DEFAULT_INDEX_DIR } from '../lib/files.js';
import { VectorIndex } from '../../vector-index.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search the local file index')
    .argument('<query...>', 'search query')
    .option('--index <dir>', 'file index directory', DEFAULT_INDEX_DIR)
    .option('-k <n>', 'number of results', '5')
    .action(async (queryParts: string[], opts: { index: string; k: string }) => {
      const query = queryParts.join(' ');
      const index = await VectorIndex.load(opts.index).catch(() => null);
      if (!index) {
        fail(`No index found at "${opts.index}". Run "memgrep index <path>" first.`);
      }
      const k = Number(opts.k) || 5;
      const hits = await index.search(query, { k });
      if (hits.length === 0) {
        console.log('No results.');
        return;
      }
      for (const hit of hits) {
        const preview = hit.chunk.replace(/\s+/g, ' ').slice(0, 200);
        console.log(`\n${hit.id}  (score ${hit.score.toFixed(3)})`);
        console.log(`  ${preview}${hit.chunk.length > 200 ? '…' : ''}`);
      }
    });
}
