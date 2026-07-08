#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { VectorIndex } from './vector-index.js';

const DEFAULT_INDEX_DIR = '.memgrep';
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', DEFAULT_INDEX_DIR]);
const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.lua',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env.example',
  '.html', '.css', '.scss', '.sql', '.sh', '.graphql', '.proto',
]);

const USAGE = `memgrep: local semantic search over your files and agent chats

File search:
  memgrep index <path...>  [--out <dir>] [--model <hf-model-id>]
  memgrep search <query>   [--index <dir>] [-k <n>]

Chat memory (global, stored in ~/.memgrep):
  memgrep scan [--source kiro] [--new] [--last <n>]  list available chats without ingesting
  memgrep ingest [--source cursor,claude,kiro]  ingest agent chat history across all projects
  memgrep ingest --pick 2,5    ingest chats by number from the last scan
  memgrep ingest --last [n]    ingest only the n most recent chats (default 1)
  memgrep ingest --pick        choose from an interactive menu of recent chats
  memgrep ingest <file...> [--title <t>] [--project <p>]  ingest specific chat files (auto-detects format)
  memgrep list [--project <p>] list remembered chats
  memgrep recall <query> [-k <n>]  search memory across all projects
  memgrep show <id>            print a remembered chat
  memgrep copy [id]            copy a chat to the clipboard (default: top hit of last recall)
  memgrep delete <id>          forget a chat
  memgrep delete --all [--yes] wipe the entire memory (asks for confirmation)
  memgrep remember <text> [--title <t>] [--project <p>]  store a note
  memgrep serve                start the MCP server (stdio) for agents

Options:
  --out <dir>      Where to store the file index (default: ${DEFAULT_INDEX_DIR})
  --index <dir>    File index to search (default: ${DEFAULT_INDEX_DIR})
  --model <id>     Hugging Face embedding model (default: Xenova/all-MiniLM-L6-v2)
  -k <n>           Number of results (default: 5)

Examples:
  npx memgrep index ./docs
  npx memgrep search "how do I configure auth?"
  npx memgrep ingest && npx memgrep recall "how did we fix the auth race?"
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.replace(/^--?/, '');
      // Only consume a value if the next token isn't itself a flag.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = '';
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const info = await stat(root);
  if (info.isFile()) {
    yield root;
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

async function commandIndex(paths: string[], flags: Record<string, string>): Promise<void> {
  const outDir = flags.out ?? DEFAULT_INDEX_DIR;
  console.log('Loading embedding model (first run downloads it, then it is cached)...');
  const index = await VectorIndex.create({ model: flags.model });

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
    console.error('No indexable text files found.');
    process.exitCode = 1;
    return;
  }
  await index.save(outDir);
  console.log(`Done. ${count} file(s) indexed with ${index.model} -> ${outDir}`);
}

async function commandSearch(query: string, flags: Record<string, string>): Promise<void> {
  const indexDir = flags.index ?? DEFAULT_INDEX_DIR;
  const index = await VectorIndex.load(indexDir).catch(() => null);
  if (!index) {
    console.error(`No index found at "${indexDir}". Run "memgrep index <path>" first.`);
    process.exitCode = 1;
    return;
  }
  const k = flags.k ? Number(flags.k) : 5;
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
}

async function commandScan(flags: Record<string, string>): Promise<void> {
  const known = ['source', 'last', 'new'];
  const unknown = Object.keys(flags).filter((f) => !known.includes(f));
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `-${f.length > 1 ? '-' : ''}${f}`).join(', ')}`);
    console.error('Usage: memgrep scan [--source cursor,claude,kiro] [--last <n>] [--new]');
    process.exitCode = 1;
    return;
  }

  const { MemoryStore } = await import('./memory/store.js');
  const { buildSources, collectChats } = await import('./memory/ingest.js');
  const sources = buildSources(flags.source ? flags.source.split(',') : undefined);
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

  const filtered = 'new' in flags ? withStatus.filter((e) => e.status !== 'ingested') : withStatus;
  const limit = flags.last ? Math.max(1, Number(flags.last) || 20) : 20;
  const shown = filtered.slice(0, limit);
  if (shown.length === 0) {
    store.close();
    console.log('Everything is already ingested.');
    return;
  }

  for (let i = 0; i < shown.length; i++) {
    const { chat, status } = shown[i];
    const when = (chat.modifiedAt ?? chat.createdAt ?? '').slice(0, 16).replace('T', ' ');
    const mark = status === 'ingested' ? ' ' : status === 'changed' ? '~' : '*';
    console.log(
      `${String(i + 1).padStart(2)}. ${mark} ${chat.title.slice(0, 66).padEnd(66)}  (${chat.sourceName}/${chat.project}, ${when})`,
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
}

async function commandIngest(paths: string[], flags: Record<string, string>): Promise<void> {
  const known = ['source', 'last', 'pick', 'title', 'project'];
  const unknown = Object.keys(flags).filter((f) => !known.includes(f));
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `-${f.length > 1 ? '-' : ''}${f}`).join(', ')}`);
    console.error('Did you mean --last <n> or --pick?');
    process.exitCode = 1;
    return;
  }

  const { MemoryStore } = await import('./memory/store.js');

  // --pick 2,5 with numbers: ingest those entries from the last "memgrep scan".
  if (flags.pick) {
    const { buildSources, collectChats, ingestChats } = await import('./memory/ingest.js');
    const stateStore = await MemoryStore.open(undefined, { heal: false });
    const saved = stateStore.getState('last_scan');
    stateStore.close();
    if (!saved) {
      console.error('No previous scan. Run "memgrep scan" first, then "memgrep ingest --pick 2,5".');
      process.exitCode = 1;
      return;
    }
    const scanList = JSON.parse(saved) as { source: string | null; sourceName: string }[];
    const indices = flags.pick
      .split(',')
      .map((s) => Number(s.trim()) - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < scanList.length);
    if (indices.length === 0) {
      console.error(`Invalid pick "${flags.pick}". Use numbers from the last scan (1-${scanList.length}).`);
      process.exitCode = 1;
      return;
    }

    const wantedPaths = new Set(indices.map((i) => scanList[i].source).filter(Boolean) as string[]);
    const wantedSources = [...new Set(indices.map((i) => scanList[i].sourceName))];
    console.log('Re-reading selected chats...');
    const candidates = await collectChats(buildSources(wantedSources));
    const selected = candidates.filter((c) => c.source && wantedPaths.has(c.source));
    if (selected.length === 0) {
      console.error('Selected chats no longer exist on disk. Run "memgrep scan" again.');
      process.exitCode = 1;
      return;
    }
    if (selected.length < wantedPaths.size) {
      console.error(`Note: ${wantedPaths.size - selected.length} selected chat(s) no longer exist on disk.`);
    }

    const store = await MemoryStore.open();
    await ingestChats(store, selected, (msg) => console.log(msg));
    await store.persist();
    store.close();
    return;
  }

  // --last [n] / bare --pick: choose recent chats without knowing file paths.
  if ('last' in flags || 'pick' in flags) {
    const { buildSources, collectChats, ingestChats } = await import('./memory/ingest.js');
    const sources = buildSources(flags.source ? flags.source.split(',') : undefined);
    console.log('Scanning recent chats...');
    const candidates = await collectChats(sources);
    if (candidates.length === 0) {
      console.log('No chats found in any supported tool.');
      return;
    }

    let selected = candidates;
    if ('pick' in flags) {
      const menu = candidates.slice(0, 20);
      for (let i = 0; i < menu.length; i++) {
        const c = menu[i];
        const when = (c.modifiedAt ?? c.createdAt ?? '').slice(0, 16).replace('T', ' ');
        console.log(`${String(i + 1).padStart(2)}. ${c.title.slice(0, 70)}  (${c.sourceName}/${c.project}, ${when})`);
      }
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question('Ingest which? (e.g. 1 or 1,3): ');
      rl.close();
      const indices = answer
        .split(',')
        .map((s) => Number(s.trim()) - 1)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < menu.length);
      if (indices.length === 0) {
        console.log('Nothing selected.');
        return;
      }
      selected = indices.map((i) => menu[i]);
    } else {
      const n = Math.max(1, Number(flags.last) || 1);
      selected = candidates.slice(0, n);
    }

    const store = await MemoryStore.open();
    await ingestChats(store, selected, (msg) => console.log(msg));
    await store.persist();
    store.close();
    return;
  }

  // With file arguments: ingest exactly those chats.
  if (paths.length > 0) {
    const { ingestFile } = await import('./memory/ingest.js');
    const store = await MemoryStore.open();
    for (const file of paths) {
      try {
        const { id, tool } = await ingestFile(store, file, {
          title: flags.title,
          project: flags.project,
        });
        console.log(
          id === null ? `= unchanged [${tool}] ${file}` : `+ added as chat ${id} [${tool}] ${file}`,
        );
      } catch (error) {
        console.error(`! ${file}: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    }
    await store.persist();
    store.close();
    return;
  }

  // Without arguments: scan all supported tools.
  const { buildSources, ingestTranscripts } = await import('./memory/ingest.js');
  const sources = buildSources(flags.source ? flags.source.split(',') : undefined);
  console.log(`Sources: ${sources.map((s) => s.name).join(', ')}`);
  console.log('Opening memory store (first run downloads the embedding model)...');
  const store = await MemoryStore.open();
  const result = await ingestTranscripts(store, sources, (msg) => console.log(msg));
  await store.persist();
  store.close();
  const perSource = Object.entries(result.bySource)
    .map(([name, n]) => `${name}: ${n}`)
    .join(', ');
  console.log(
    `Scanned ${result.scanned} chat(s): ${result.added} added${perSource ? ` (${perSource})` : ''}, ${result.skipped} unchanged/empty.`,
  );
}

async function commandList(flags: Record<string, string>): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open(undefined, { heal: false });
  const chats = store.listChats(flags.project);
  store.close();
  if (chats.length === 0) {
    console.log('Memory is empty. Run "memgrep ingest" or "memgrep remember <text>".');
    return;
  }
  for (const c of chats) {
    console.log(`[${c.id}] ${c.title}  (${c.tool}/${c.project}, ${c.createdAt.slice(0, 10)}, ${c.chars} chars)`);
  }
}

async function commandRecall(query: string, flags: Record<string, string>): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open();
  const hits = await store.search(query, flags.k ? Number(flags.k) : 5);
  store.setState('last_recall', JSON.stringify(hits.map((h) => h.id)));
  store.close();
  if (hits.length === 0) {
    console.log('No matching chats in memory.');
    return;
  }
  for (const hit of hits) {
    console.log(`\n[${hit.id}] ${hit.title}  (${hit.project}, ${hit.createdAt.slice(0, 10)}, score ${hit.score.toFixed(3)})`);
    console.log(`  ${hit.snippet.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  console.log('\nCopy one with: memgrep copy <id>  (or "memgrep copy" for the top hit)');
}

async function commandCopy(idArg: string | undefined): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const { copyToClipboard } = await import('./clipboard.js');
  const store = await MemoryStore.open(undefined, { heal: false });

  let id: number | undefined = idArg !== undefined ? Number(idArg) : undefined;
  if (id === undefined) {
    const last = store.getState('last_recall');
    id = last ? (JSON.parse(last) as number[])[0] : undefined;
    if (id === undefined) {
      store.close();
      console.error('Nothing to copy. Run "memgrep recall <query>" first, or pass an id.');
      process.exitCode = 1;
      return;
    }
  }

  const chat = store.getChat(id);
  store.close();
  if (!chat) {
    console.error(`No chat with id ${id}.`);
    process.exitCode = 1;
    return;
  }

  const text = `# ${chat.title}\nproject: ${chat.project} | tool: ${chat.tool} | date: ${chat.createdAt.slice(0, 10)}\n\n${chat.content}`;
  if (await copyToClipboard(text)) {
    console.log(`Copied chat ${id} to clipboard (${text.length} chars): ${chat.title}`);
  } else {
    console.error('No clipboard tool found (pbcopy/clip/xclip/wl-copy). Printing instead:\n');
    console.log(text);
    process.exitCode = 1;
  }
}

async function commandShow(id: number): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open(undefined, { heal: false });
  const chat = store.getChat(id);
  store.close();
  if (!chat) {
    console.error(`No chat with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${chat.title}\nproject: ${chat.project} | date: ${chat.createdAt.slice(0, 10)}\n`);
  console.log(chat.content);
}

async function commandDelete(id: number): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open(undefined, { heal: false });
  const removed = store.deleteChat(id);
  if (removed) await store.persist();
  store.close();
  console.log(removed ? `Deleted chat ${id}.` : `No chat with id ${id}.`);
  if (!removed) process.exitCode = 1;
}

async function commandDeleteAll(flags: Record<string, string>): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open(undefined, { heal: false });
  const count = store.listChats().length;
  if (count === 0) {
    store.close();
    console.log('Memory is already empty.');
    return;
  }

  if (!('yes' in flags)) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This will delete all ${count} chat(s) from memory. Type "yes" to confirm: `);
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
  console.log(`Deleted ${removed} chat(s). Memory is empty. (Note: "memgrep ingest" will re-add chats whose transcripts still exist on disk.)`);
}

async function commandRemember(text: string, flags: Record<string, string>): Promise<void> {
  const { MemoryStore } = await import('./memory/store.js');
  const store = await MemoryStore.open();
  const id = await store.addChat({
    title: flags.title ?? (text.length > 80 ? `${text.slice(0, 77)}...` : text),
    project: flags.project ?? path.basename(process.cwd()),
    content: text,
    tool: 'note',
  });
  await store.persist();
  store.close();
  console.log(id === null ? 'Already remembered.' : `Remembered as chat ${id}.`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  if (command === 'index' && positional.length > 0) {
    await commandIndex(positional, flags);
  } else if (command === 'search' && positional.length > 0) {
    await commandSearch(positional.join(' '), flags);
  } else if (command === 'scan' && positional.length === 0) {
    await commandScan(flags);
  } else if (command === 'ingest') {
    await commandIngest(positional, flags);
  } else if (command === 'list') {
    await commandList(flags);
  } else if (command === 'recall' && positional.length > 0) {
    await commandRecall(positional.join(' '), flags);
  } else if (command === 'show' && positional.length === 1) {
    await commandShow(Number(positional[0]));
  } else if (command === 'copy' && positional.length <= 1) {
    await commandCopy(positional[0]);
  } else if (command === 'delete' && 'all' in flags && positional.length === 0) {
    await commandDeleteAll(flags);
  } else if (command === 'delete' && positional.length === 1) {
    await commandDelete(Number(positional[0]));
  } else if (command === 'remember' && positional.length > 0) {
    await commandRemember(positional.join(' '), flags);
  } else if (command === 'serve') {
    const { startMcpServer } = await import('./memory/mcp.js');
    await startMcpServer();
    return; // keep process alive; the MCP transport owns stdio from here
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
