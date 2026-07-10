import type { Command } from 'commander';
import {
  formatScanLine,
  formatScanMark,
  formatWhen,
  parseSourceList,
} from '../lib/format.js';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('List available chats without ingesting')
    .option('--source <list>', 'comma-separated sources: cursor,claude,kiro')
    .option('--new', 'show only chats not yet ingested (or changed)')
    .option('--last <n>', 'how many chats to show', '20')
    .action(async (opts: { source?: string; new?: boolean; last: string }) => {
      const { MemoryStore } = await import('../../memory/store.js');
      const { buildSources, collectChats } = await import('../../memory/ingest.js');

      const sources = buildSources(parseSourceList(opts.source));
      console.log(`Scanning ${sources.map((s) => s.name).join(', ')}...`);
      const candidates = await collectChats(sources);
      if (candidates.length === 0) {
        console.log('No chats found.');
        return;
      }

      const store = await MemoryStore.open(undefined, { heal: false });
      const withStatus = candidates.map((c) => ({
        chat: c,
        status: c.source ? store.sourceStatus(c.source, c.content) : ('new' as const),
      }));

      const filtered = opts.new
        ? withStatus.filter((e) => e.status !== 'ingested')
        : withStatus;
      const limit = Math.max(1, Number(opts.last) || 20);
      const shown = filtered.slice(0, limit);
      if (shown.length === 0) {
        store.close();
        console.log('Everything is already ingested.');
        return;
      }

      for (let i = 0; i < shown.length; i++) {
        const { chat, status } = shown[i];
        console.log(
          formatScanLine(
            i + 1,
            formatScanMark(status),
            chat.title,
            chat.sourceName,
            chat.project,
            formatWhen(chat.modifiedAt ?? chat.createdAt),
          ),
        );
      }
      store.setState(
        'last_scan',
        JSON.stringify(shown.map((e) => ({ source: e.chat.source, sourceName: e.chat.sourceName }))),
      );
      store.close();

      const hidden = filtered.length - shown.length;
      if (hidden > 0) console.log(`...and ${hidden} more (use --last ${filtered.length} to see all).`);
      const example = shown.length === 1 ? '1' : `1,${shown.length}`;
      console.log(`\n* = new, ~ = changed since ingest. Ingest with: memgrep ingest --pick ${example}`);
    });
}
