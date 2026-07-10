import type { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../lib/errors.js';
import { DEFAULT_INDEX_DIR, MAX_FILE_BYTES, walkFiles } from '../lib/files.js';
import { VectorIndex } from '../../vector-index.js';

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index text files for local semantic search')
    .argument('<paths...>', 'files or directories to index')
    .option('--out <dir>', 'where to store the file index', DEFAULT_INDEX_DIR)
    .option('--model <id>', 'Hugging Face embedding model id')
    .action(async (paths: string[], opts: { out: string; model?: string }) => {
      console.log('Loading embedding model (first run downloads it, then it is cached)...');
      const index = await VectorIndex.create({ model: opts.model });

      let count = 0;
      for (const root of paths) {
        for await (const file of walkFiles(root)) {
          const info = await stat(file);
          if (info.size > MAX_FILE_BYTES) continue;
          const text = await readFile(file, 'utf8').catch(() => null);
          if (!text || text.trim().length === 0) continue;
          const id = path.relative(process.cwd(), file) || file;
          await index.add({ id, text, metadata: { path: id } });
          count++;
          process.stdout.write(`\rIndexed ${count} file(s): ${id.slice(0, 60).padEnd(60)}`);
        }
      }
      process.stdout.write('\n');
      if (count === 0) {
        fail('No indexable text files found.');
      }
      await index.save(opts.out);
      console.log(`Done. ${count} file(s) indexed with ${index.model} -> ${opts.out}`);
    });
}
