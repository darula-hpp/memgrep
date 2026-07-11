# memgrep

Local agent memory — and Cursor from your phone.

memgrep started as searchable memory for coding agents. It still is that: every chat across Cursor, Claude Code, and Kiro, fully local, recallable via CLI or MCP. It also grew into a thin remote coding path: an allowlisted Telegram bot that drives a **real Cursor agent** in a real project folder, with memgrep memory attached mid-task. Cursor is the runtime you already pay for; memgrep is the memory; Telegram is the channel.

- **Memory that outlives sessions.** Ingest transcripts from Cursor, Claude Code, and Kiro into one local store. Any MCP-capable agent can `recall` / `get_chat` / `remember` mid-task.
- **Cursor from your phone.** `memgrep telegram` long-polls Telegram’s cloud, runs `@cursor/sdk` against a cwd on your machine, and streams replies back. Multi-profile bots, workspace switching, macOS LaunchAgent for always-on while the Mac is awake.
- **Fully local memory plane.** Embeddings on-device via [Transformers.js](https://github.com/huggingface/transformers.js). SQLite + [hnswlib](https://github.com/yoshoku/hnswlib-node) HNSW. No cloud for your chat archive — your history contains your code.

## Demo

![memgrep demo](demo/preview.gif)

## Why

Two problems, one tool:

1. **Siloed agent history.** You fixed an auth bug three weeks ago in another editor. Today’s agent has no idea. Transcripts exist on disk but aren’t searchable across tools.
2. **Remote coding without a gateway.** You want to text an agent from your phone and get real work done in a repo — not stand up a second agent platform. memgrep uses Telegram as the remote and Cursor as the brain.

memgrep turns the transcript pile into one queryable memory, and optionally puts that memory (plus a live Cursor agent) behind a Telegram bot you already know how to use.

## Quickstart

**Memory**

```bash
npm install -g memgrep
memgrep ingest                                  # index chat history (incremental after first run)
memgrep recall "how did we fix the auth race?"  # search memory
memgrep copy                                    # top hit -> clipboard
```

**Cursor from your phone**

```bash
memgrep telegram          # first run: BotFather token + Cursor API key + project cwd
# or keep it always-on on macOS:
memgrep telegram install  # LaunchAgent (survives logout/reboot; pauses if Mac sleeps)
```

Requires Node.js 18+. Native addons (hnswlib, better-sqlite3) build on install. The embedding model (~25 MB) downloads once on first run; memory search is offline after that. Telegram + Cursor need network and a [`CURSOR_API_KEY`](https://cursor.com/dashboard/integrations). Full command list below.

## Agent memory

**Two ways to get things in:** `ingest` pulls chats from your tools (Cursor, Claude Code, Kiro). `remember` stores a note you write yourself (a decision, a postmortem, context no transcript captured).

**Search and browse:** `recall` finds chats by meaning. `list` shows what's stored. `show` / `copy` read one chat back out.

```bash
memgrep scan [--source kiro] [--new] [--last <n>]   # list on-disk chats (* = not ingested)
memgrep ingest [--source cursor,claude,kiro]        # ingest from supported tools
memgrep ingest --pick 2,5                           # ingest by number from last scan
memgrep ingest --last [n]                           # most recent n chat(s)
memgrep ingest <file...>                            # one file (format auto-detected)
memgrep remember "we chose X over Y because Z"      # manual note (no transcript needed)
memgrep list [--project <p>]
memgrep recall "<query>" [-k <n>]
memgrep show <id>
memgrep copy [id]
memgrep delete <id>
memgrep delete --all [--yes]
memgrep serve [--http] [--host 127.0.0.1] [--port 3921]
memgrep telegram                 # Cursor agent from your phone (+ memgrep MCP)
```

Memory lives in `~/.memgrep` (`MEMGREP_HOME` to override). Re-running `ingest` is idempotent: unchanged chats are skipped, grown chats are replaced. `scan` then `--pick` lets you see what's available before embedding anything.

Supported history sources:

| Tool | Source | Notes |
| --- | --- | --- |
| Cursor | `~/.cursor/projects/*/agent-transcripts/` | Full user + assistant turns |
| Claude Code | `~/.claude/projects/*/*.jsonl` | Full user + assistant turns |
| Kiro IDE | Kiro `globalStorage` workspace sessions | User turns and titles (assistant output lives in opaque execution records) |
| Antigravity | Not yet | Conversations are encrypted protobuf (`.pb`); agents can still *query* memory via MCP |
| Anything else | `memgrep remember "<text>"` | Manual notes, decisions, postmortems |

New sources are pluggable: implement the two-method `TranscriptSource` interface and pass it to `ingestTranscripts`.

### Give your agents access (MCP)

Memory is exposed through MCP, so it works in any MCP-capable agent: Cursor, Claude Code, Kiro, Antigravity, Windsurf, Codex, and whatever ships next. Ingest with the CLI, recall from anywhere. Register the server once per tool.

**No global install needed** (recommended — always picks up the latest published version):

```json
{
  "mcpServers": {
    "memgrep": {
      "command": "npx",
      "args": ["-y", "memgrep", "serve"]
    }
  }
}
```

**Already installed globally** (`npm install -g memgrep`):

```json
{
  "mcpServers": {
    "memgrep": {
      "command": "memgrep",
      "args": ["serve"]
    }
  }
}
```

Config locations: Cursor `~/.cursor/mcp.json`, Claude Code `claude mcp add memgrep -- npx -y memgrep serve` (or `claude mcp add memgrep -- memgrep serve` if global), Kiro `~/.kiro/settings/mcp.json`, Antigravity via its MCP settings UI.

The agent gets four tools: `recall(query)`, `get_chat(id)`, `list_chats(project?)`, and `remember(text, title?, project?)`. Retrieval finds which chat matters; the agent pulls the full transcript into context or stores a durable note. An agent in Kiro can recall a fix from a Cursor chat last month.

## Cursor from your phone (Telegram)

Chat with a **local Cursor agent** from Telegram. You do **not** need to be on the same Wi‑Fi — Telegram’s cloud reaches a long-polling process on your Mac. Usage is billed against your **Cursor plan** (same token pool as the IDE; tagged SDK in the dashboard). You need a [`CURSOR_API_KEY`](https://cursor.com/dashboard/integrations).

Compared to a full agent gateway (e.g. OpenClaw): memgrep keeps the stack thin — Telegram is the remote channel, Cursor is the runtime, memgrep is the memory. Multi-profile bots and a macOS LaunchAgent cover the day-to-day “text from anywhere” loop without a second control plane.

```bash
memgrep telegram
```

First run walks you through:

1. Linking a [@BotFather](https://t.me/BotFather) token and capturing your user id via `/start`
2. Pasting your Cursor API key and choosing a project directory

Credentials are saved under `~/.memgrep/telegram/<profile>.json` (mode `0600`; legacy `telegram.json` migrates to `telegram/default.json`). The bot starts an embedded loopback HTTP MCP so Cursor can call memgrep (`recall`, `get_chat`, `list_chats`, `remember`) mid-task.

```bash
memgrep telegram setup              # default profile
memgrep telegram setup career       # second BotFather bot + cwd/model
memgrep telegram --profile career
memgrep telegram --all              # run every profile in one process
memgrep telegram list
memgrep telegram status             # all profiles, or: status career
memgrep telegram install            # macOS LaunchAgent (always-on while Mac is awake)
memgrep telegram install --all
memgrep telegram service            # LaunchAgent loaded?
memgrep telegram uninstall
```

**Always-on (macOS):** `memgrep telegram install` writes `~/Library/LaunchAgents/com.memgrep.telegram.plist`, loads it with `launchctl`, and keeps the bot alive across logout/reboot. Logs go to `~/.memgrep/logs/telegram-launchd.log`. Stop any foreground `memgrep telegram` first (only one poller per bot token). The agent still pauses while the Mac is asleep or offline — for true 24/7, run on a desktop/VPS that stays powered.

Leave `memgrep telegram` (or `--all`) running, or use `install` instead. On your phone:

- free text / `/ask …` → Cursor agent (edits/runs in the configured cwd)
- `/ws` → list saved workspaces (`*` = current)
- `/ws 2` or `/ws myapp` → switch workspace (starts a fresh Cursor conversation)
- `/ws add <name> <path>` → save another project folder
- `/ws rm <name>` → remove a saved workspace
- `/cwd [path]` → show list or switch by full filesystem path
- `/new` → fresh Cursor conversation (same workspace)
- `/status` → cwd, model, agent id, workspaces
- `/recall <query>` / `/list` / `/show <id>` → memory shortcuts (without going through Cursor)
- `/help` → commands

Only allowlisted Telegram user ids get answers; everyone else is ignored.

**Optional env overrides:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` (default profile only), `CURSOR_API_KEY`, `MEMGREP_TELEGRAM_CWD`, `MEMGREP_TELEGRAM_MODEL`, `MEMGREP_TELEGRAM_PROFILE`. If Telegram bot credentials are set in env and no profile exists yet, memgrep migrates them into `telegram/default.json` once.

**Two processes instead of one:** run `memgrep serve --http` in one terminal and `memgrep telegram --no-server` in another (bot + Cursor MCP URL default to `http://127.0.0.1:3921/mcp`, override with `MEMGREP_MCP_URL`).

**HTTP MCP for other clients:** `memgrep serve --http` binds `127.0.0.1:3921` by default. Non-loopback hosts require `MEMGREP_MCP_TOKEN` / `--token`.

## File search

Semantic grep over any folder, fully offline:

```bash
npx memgrep index ./docs
npx memgrep search "how do I configure auth?"
```

```text
docs/authentication.md  (score 0.712)
  Configure auth by setting AUTH_SECRET in your environment and...
```

Options: `--out` / `--index` to choose the index directory (default `.memgrep`), `--model` to pick any [Transformers.js-compatible embedding model](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction), `-k` for the number of results.

## Library usage

The same engine is available as an embeddable library. Think SQLite for semantic search: not a database server, not an API, not a subscription.

```typescript
import { VectorIndex } from 'memgrep';

// Downloads the model on first use, cached afterwards.
const index = await VectorIndex.create({ model: 'Xenova/all-MiniLM-L6-v2' });

await index.add([
  { id: 'doc1', text: 'To reset your password, click the forgot password link.' },
  { id: 'doc2', text: 'Our refund policy allows returns within 30 days.', metadata: { url: '/refunds' } },
]);

const hits = await index.search('I forgot my login', { k: 5 });
// [{ id: 'doc1', score: 0.62, chunk: 'To reset your password...', chunkIndex: 0 }]

await index.save('./my-index');           // persist
const loaded = await VectorIndex.load('./my-index'); // reload later
```

Long documents are automatically split into overlapping chunks (configurable via `chunkSize` / `chunkOverlap`); `search` returns the best-matching chunk per document. `remove(id)` deletes a document, and re-`add`ing an existing id replaces it.

| Method | Description |
| --- | --- |
| `VectorIndex.create(options?)` | New empty index. Options: `model`, `chunkSize`, `chunkOverlap`, `initialCapacity`. |
| `VectorIndex.load(dir)` | Load a saved index. |
| `index.add(doc \| docs)` | Add or replace documents (`{ id, text, metadata? }`). |
| `index.search(query, { k? })` | Top-k documents by cosine similarity. |
| `index.remove(id)` | Remove a document. |
| `index.save(dir)` | Persist to a directory. |
| `index.size` | Number of documents. |

The memory layer is exported too: `MemoryStore`, `ingestTranscripts`, and the per-tool parsers.

## Bring your own database

If you already have a vector database (pgvector, Supabase, LanceDB, Qdrant), you can use memgrep purely as a local embedding pipeline and skip the built-in index. `Embedder` and `chunkText` are exported for exactly this: chunk your text, embed it on-device, and store the vectors wherever you like.

```typescript
import { Embedder, chunkText } from 'memgrep';
import pg from 'pg';

const embedder = await Embedder.create('Xenova/all-MiniLM-L6-v2');
const db = new pg.Pool();

// Index: chunk, embed locally, insert into pgvector.
const chunks = chunkText(article.body);
const vectors = await embedder.embed(chunks);
for (let i = 0; i < chunks.length; i++) {
  await db.query(
    'INSERT INTO chunks (article_id, chunk_index, text, embedding) VALUES ($1, $2, $3, $4)',
    [article.id, i, chunks[i], JSON.stringify(vectors[i])],
  );
}

// Search: embed the query the same way, let the database rank.
const queryVector = await embedder.embedOne('how do refunds work?');
const { rows } = await db.query(
  'SELECT text, 1 - (embedding <=> $1) AS score FROM chunks ORDER BY embedding <=> $1 LIMIT 5',
  [JSON.stringify(queryVector)],
);
```

Vectors are L2-normalized, so cosine distance (pgvector's `<=>`) is the right operator. `embedder.dimensions` tells you the column size for your schema (384 for the default model). The one rule: always embed queries with the same model you indexed with.

## How it works

The mental model: **chunks are what's searched, chats are what's returned.**

1. Transcripts are parsed into clean `User:/Assistant:` dialogue. Tool output, diffs, and system context are stripped; only the conversation is kept.
2. That text is chunked at paragraph/sentence boundaries (~1000 chars, 200 overlap), and each chunk is embedded locally into a 384-dim vector (Transformers.js, mean pooling, L2-normalized). Titles, projects, and dates are stored as plain columns, not embedded.
3. Vectors go into an HNSW index (cosine space); chat records and chunk text live in SQLite.
4. A query is embedded the same way, the nearest chunks are retrieved (over-fetched 4x, deduplicated to the best chunk per chat), and results come back with scores and the matching passage.
5. Ingestion is idempotent by content hash; `remember` and `ingest` both land in the same searchable memory.

Reliability: SQLite is the source of truth and the vector index is a rebuildable cache. If a process dies mid-ingest (Ctrl-C, crash, power loss), no chats are lost: the next command that needs vectors (`recall`, `ingest`, `serve`) detects the divergence, re-embeds whatever is missing, and repairs the index, printing progress while it does. Commands that never touch vectors (`list`, `show`, `copy`, `delete`, `scan`) skip the repair and stay fast no matter what state the index is in. Deleting `index.bin` entirely just triggers a full rebuild from the database.

## Limitations, honestly

- **Exact identifiers are semantic search's weak spot.** "merchant 7712" matches by the meaning of surrounding words, not the literal string. Hybrid keyword boosting is on the roadmap.
- **Kiro ingestion is partial** (user turns and titles; assistant output lives in opaque execution records). **Antigravity can't be ingested** (encrypted protobuf), though its agents can still query memory via MCP. Escape hatch for both: export or paste into a file and `memgrep ingest <file>`.
- **`delete` is not permanent against re-ingest.** If the source transcript still exists on disk, the next scan re-adds it. Wipe the transcript too, or don't re-scan that source.
- **One writer at a time.** Concurrent memgrep processes can race on the index file; the self-heal repairs any loss on next open, but there is no cross-process lock yet.
- **Recall quality tracks what was said.** Sessions where the signal lived in tool output (which is stripped) search poorly. A one-line `memgrep remember` in your own words is often the highest-value thing you can store.
- **Telegram still needs a host that stays up.** LaunchAgent survives logout/reboot on macOS, but the bot pauses while the Mac sleeps or is offline. True 24/7 means a desktop/VPS that stays powered. Cursor usage is billed to your Cursor plan.

## Roadmap

- Hybrid search (keyword/BM25 boost for exact ids and error strings)
- Tombstones so `delete` survives re-ingest
- More sources (Antigravity if its format opens up, Codex CLI, Windsurf)
- Watch mode / background daemon for continuous ingest
- Linux systemd unit alongside the macOS LaunchAgent
- Browser support for the library via a WASM HNSW index

## Development

```bash
npm install
npm run build   # compile TypeScript
npm test        # unit + integration tests (first run downloads the model)
```

## License

[MIT](LICENSE)
