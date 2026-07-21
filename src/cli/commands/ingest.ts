import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { fail } from '../lib/errors.js';
import { parsePickIndices, parseSourceList } from '../lib/format.js';
import { resolveIngestMode, type IngestMode } from './ingest-mode.js';

async function ingestPickFromScan(picks: number[]): Promise<void> {
  const { MemoryStore } = await import('../../memory/store.js');
  const { buildSources, collectChats, ingestChats } = await import('../../memory/ingest.js');

  const stateStore = await MemoryStore.open(undefined, { heal: false });
  const saved = stateStore.getState('last_scan');
  stateStore.close();
  if (!saved) {
    fail('No previous scan. Run "memgrep scan" first, then "memgrep ingest --pick 2,5".');
  }

  const scanList = JSON.parse(saved) as { source: string | null; sourceName: string }[];
  const indices = picks
    .map((n) => n - 1)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < scanList.length);
  if (indices.length === 0) {
    fail(`Invalid pick. Use numbers from the last scan (1-${scanList.length}).`);
  }

  const wantedPaths = new Set(indices.map((i) => scanList[i].source).filter(Boolean) as string[]);
  const wantedSources = [...new Set(indices.map((i) => scanList[i].sourceName))];
  console.log('Re-reading selected chats...');
  const candidates = await collectChats(buildSources(wantedSources));
  const selected = candidates.filter((c) => c.source && wantedPaths.has(c.source));
  if (selected.length === 0) {
    fail('Selected chats no longer exist on disk. Run "memgrep scan" again.');
  }
  if (selected.length < wantedPaths.size) {
    console.error(`Note: ${wantedPaths.size - selected.length} selected chat(s) no longer exist on disk.`);
  }

  const store = await MemoryStore.open();
  await ingestChats(store, selected, (msg) => console.log(msg));
  await store.persist();
  store.close();
}

async function ingestInteractivePick(sources?: string[]): Promise<void> {
  const { MemoryStore } = await import('../../memory/store.js');
  const { buildSources, collectChats, ingestChats } = await import('../../memory/ingest.js');

  console.log('Scanning recent chats...');
  const candidates = await collectChats(buildSources(sources));
  if (candidates.length === 0) {
    console.log('No chats found in any supported tool.');
    return;
  }

  const menu = candidates.slice(0, 20);
  for (let i = 0; i < menu.length; i++) {
    const c = menu[i];
    const when = (c.modifiedAt ?? c.createdAt ?? '').slice(0, 16).replace('T', ' ');
    console.log(`${String(i + 1).padStart(2)}. ${c.title.slice(0, 70)}  (${c.sourceName}/${c.project}, ${when})`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Ingest which? (e.g. 1 or 1,3): ');
  rl.close();
  const indices = parsePickIndices(answer, menu.length);
  if (indices.length === 0) {
    console.log('Nothing selected.');
    return;
  }

  const store = await MemoryStore.open();
  await ingestChats(
    store,
    indices.map((i) => menu[i]),
    (msg) => console.log(msg),
  );
  await store.persist();
  store.close();
}

async function ingestLast(n: number, sources?: string[]): Promise<void> {
  const { MemoryStore } = await import('../../memory/store.js');
  const { buildSources, collectChats, ingestChats } = await import('../../memory/ingest.js');

  console.log('Scanning recent chats...');
  const candidates = await collectChats(buildSources(sources));
  if (candidates.length === 0) {
    console.log('No chats found in any supported tool.');
    return;
  }

  const store = await MemoryStore.open();
  await ingestChats(store, candidates.slice(0, n), (msg) => console.log(msg));
  await store.persist();
  store.close();
}

async function ingestFiles(
  paths: string[],
  opts: { title?: string; project?: string },
): Promise<void> {
  const { MemoryStore } = await import('../../memory/store.js');
  const { ingestFile } = await import('../../memory/ingest.js');

  const store = await MemoryStore.open();
  for (const file of paths) {
    try {
      const { id, tool } = await ingestFile(store, file, {
        title: opts.title,
        project: opts.project,
      });
      console.log(id === null ? `= unchanged [${tool}] ${file}` : `+ added as chat ${id} [${tool}] ${file}`);
    } catch (error) {
      console.error(`! ${file}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
  await store.persist();
  store.close();
}

async function ingestAll(sources?: string[]): Promise<void> {
  const { MemoryStore } = await import('../../memory/store.js');
  const { buildSources, ingestTranscripts } = await import('../../memory/ingest.js');

  const sourceList = buildSources(sources);
  console.log(`Sources: ${sourceList.map((s) => s.name).join(', ')}`);
  console.log('Opening memory store (first run downloads the embedding model)...');
  const store = await MemoryStore.open();
  const result = await ingestTranscripts(store, sourceList, (msg) => console.log(msg));
  await store.persist();
  store.close();
  const perSource = Object.entries(result.bySource)
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ');
  console.log(
    `Scanned ${result.scanned} chat(s): ${result.added} added${perSource ? ` (${perSource})` : ''}, ${result.skipped} unchanged/empty.`,
  );
}

async function runIngestMode(mode: IngestMode): Promise<void> {
  switch (mode.kind) {
    case 'pick-from-scan':
      return ingestPickFromScan(mode.picks);
    case 'interactive-pick':
      return ingestInteractivePick(mode.sources);
    case 'last':
      return ingestLast(mode.n, mode.sources);
    case 'files':
      return ingestFiles(mode.paths, { title: mode.title, project: mode.project });
    case 'all':
      return ingestAll(mode.sources);
  }
}

function optionalFlagValue(value: unknown): string | undefined {
  if (value === undefined || value === true) return undefined;
  if (typeof value === 'string') return value;
  return String(value);
}

export function registerIngestCommand(program: Command): void {
  const ingest = program
    .command('ingest')
    .description('Ingest agent chat history into memory (one-shot or background daemon)');

  ingest
    .command('daemon')
    .description('Run background ingest on an interval (reads ~/.memgrep/ingest.json)')
    .option('--interval <duration>', 'override interval (e.g. 15m, 1h, 3600)')
    .option('--source <list>', 'comma-separated sources: cursor,claude,kiro')
    .action(async (opts: { interval?: string; source?: string }) => {
      try {
        const { runIngestDaemon } = await import('../../ingest/daemon.js');
        await runIngestDaemon({
          interval: opts.interval,
          sources: parseSourceList(opts.source),
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  ingest
    .command('install')
    .description('Install a macOS LaunchAgent for the ingest daemon')
    .option('--interval <duration>', 'interval to persist (default: 1h, or keep existing config)')
    .option('--source <list>', 'comma-separated sources: cursor,claude,kiro')
    .action(async (opts: { interval?: string; source?: string }) => {
      if (process.platform !== 'darwin') fail('LaunchAgent install is only supported on macOS.');
      try {
        const { installIngestLaunchdService, formatIngestServiceStatus } = await import(
          '../../ingest/launchd.js'
        );
        const status = installIngestLaunchdService({
          interval: opts.interval,
          sources: parseSourceList(opts.source),
        });
        console.log(`Installed LaunchAgent: ${status.label}`);
        for (const line of formatIngestServiceStatus(status)) {
          console.log(line);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  ingest
    .command('uninstall')
    .description('Remove the ingest LaunchAgent')
    .action(async () => {
      if (process.platform !== 'darwin') fail('LaunchAgent uninstall is only supported on macOS.');
      const { uninstallIngestLaunchdService } = await import('../../ingest/launchd.js');
      const status = uninstallIngestLaunchdService();
      console.log(
        status.installed ? `Still present: ${status.plistPath}` : 'Removed ingest LaunchAgent.',
      );
    });

  ingest
    .command('service')
    .description('Show ingest LaunchAgent status')
    .action(async () => {
      const { getIngestLaunchdStatus, formatIngestServiceStatus } = await import(
        '../../ingest/launchd.js'
      );
      const status = getIngestLaunchdStatus();
      for (const line of formatIngestServiceStatus(status)) {
        console.log(line);
      }
    });

  ingest
    .argument('[files...]', 'specific chat files to ingest (format auto-detected)')
    .option('--source <list>', 'comma-separated sources: cursor,claude,kiro')
    .option('--pick [indices]', 'ingest by number from last scan, or interactive menu if no value')
    .option('--last [n]', 'ingest only the n most recent chats (default: 1)')
    .option('--title <title>', 'title when ingesting specific files')
    .option('--project <name>', 'project when ingesting specific files')
    .action(async (files: string[], opts: {
      source?: string;
      pick?: string | true;
      last?: string | true;
      title?: string;
      project?: string;
    }) => {
      const mode = resolveIngestMode({
        pick: optionalFlagValue(opts.pick),
        pickProvided: opts.pick !== undefined,
        last: optionalFlagValue(opts.last),
        lastProvided: opts.last !== undefined,
        paths: files ?? [],
        sources: parseSourceList(opts.source),
        title: opts.title,
        project: opts.project,
      });
      await runIngestMode(mode);
    });
}
