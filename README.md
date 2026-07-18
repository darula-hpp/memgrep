# memgrep

Local agent memory, a coding loop, Cursor from your phone, and playbooks you can schedule.

**Docs:** [https://memgrep.getuigen.dev](https://memgrep.getuigen.dev)

memgrep is a local control plane for Cursor. It started as searchable agent memory. The scope is larger now:

| Pillar | What it does |
| --- | --- |
| **Memory** | Ingest Cursor / Claude Code / Kiro chats. Hybrid recall (vector + keyword). `remember` playbooks and decisions. Fully local (SQLite + HNSW + on-device embeddings). |
| **Loop** | Per-project coding loops: task in, exit conditions, exit actions (including `github_pr`). Runs until PASS, then optional PR / follow-ups. Editable config in `<cwd>/.memgrep/`; named pointer under `~/.memgrep/loops/<name>/`. |
| **Telegram** | Allowlisted bot drives a **real** local Cursor agent (`@cursor/sdk`) in a real cwd, with memgrep MCP attached mid-task. |
| **Jobs** | Cron + remembered playbook + Cursor. Schedule the workflows you already trust. |
| **MCP** | One server for agents: memory + jobs + loop + optional suites (Cursor, Jira, Neon, gcloud, PostHog, Upstash, Product Hunt, …). |

**The point:** lock workflows you already figured out. Store once (`remember` / ingest). Recall mid-task instead of reinventing steps every chat. Loop until done. Schedule what should run on a clock. Drive it from the IDE or from your phone.

## Demo

![memgrep demo](demo/preview.gif)

## Why

Agent gateways can vibe a workflow every session. That burns tokens on steps you already solved.

memgrep is for the opposite:

1. **Durable playbooks** - store the procedure, attach it via MCP, cron it if needed.
2. **Memory across tools** - a fix from last month's Cursor chat is recallable in today's agent.
3. **Remote coding without a second platform** - Telegram is the channel; Cursor is the runtime; memgrep is memory, loop, and scheduler.
4. **Loops that finish work** - not a one-shot prompt: implement, verify exits, run exit actions.

## Quickstart

Requires Node.js 18+. Native addons build on install. The embedding model (~25 MB) downloads once; memory search is offline after that. Cursor / Telegram / jobs / loop need network and a [`CURSOR_API_KEY`](https://cursor.com/dashboard/integrations).

**1. Memory**

```bash
npm install -g memgrep
memgrep ingest
memgrep recall "how did we fix the auth race?"
memgrep copy
```

**2. Coding loop**

```bash
memgrep loop init my-app --cwd ~/dev/my-app
memgrep loop use my-app
memgrep loop run --task "Add health check endpoint and tests"
memgrep loop status
memgrep loop runs
```

**3. Cursor from your phone**

```bash
memgrep telegram           # BotFather token + Cursor API key + project cwd
memgrep telegram install   # or: memgrep telegram install --all
memgrep telegram service   # Loaded: yes?
```

**4. Scheduled playbooks** (`notify` mode needs Telegram)

```bash
memgrep remember "Smoke: reply with one line ok + time. Do not edit files." --title smoke-playbook
memgrep jobs add --name smoke-5m --cron "*/5 * * * *" \
  --playbook-query "smoke playbook" --cwd ~/dev/project \
  --prompt "Reply with one line: smoke ok and the current time. Do not edit files." \
  --mode notify --profile default
memgrep jobs install
memgrep jobs run smoke-5m
memgrep jobs service
```

**One-shot local stack** (Telegram `--all`, jobs LaunchAgent, loopback MCP):

```bash
npm run build
node dist/cli.js cursor setup   # once
node dist/cli.js loop init default --cwd ~/dev/project   # or loop setup
npm start
npm stop
```

MCP stays on `http://127.0.0.1:3921/mcp`. Public tunnels are opt-in (any vendor); see [Optional public MCP](#optional-public-mcp-agnostic-tunnel).

### Always-on on macOS

| Service | Install | Status | Logs |
| --- | --- | --- | --- |
| Telegram bots + MCP | `memgrep telegram install` / `--all` | `memgrep telegram service` | `~/.memgrep/logs/telegram-launchd.log` |
| Jobs scheduler | `memgrep jobs install` | `memgrep jobs service` | `~/.memgrep/logs/jobs-launchd.log` |

After upgrade: stop foreground pollers, re-run `telegram install` / `jobs install`, confirm **Loaded: yes**. Restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.memgrep.telegram
launchctl kickstart -k gui/$(id -u)/com.memgrep.jobs
```

Both pause while the Mac sleeps; missed job ticks beyond a 6h grace window are skipped.

## Command map

```bash
# Memory
memgrep scan | ingest | remember | list | recall | show | copy | delete

# Loop (per-project profiles)
memgrep loop init <name> [--cwd <path>]
memgrep loop use <name>
memgrep loop setup|status [--profile <name>]
memgrep loop run --task "..." [--profile <name>]
memgrep loop runs [runId]
memgrep loop input|exit|action set|rm ...

# Cursor agent (MCP suite)
memgrep cursor setup|status

# Telegram
memgrep telegram | telegram setup|list|status|install|service|uninstall

# Jobs
memgrep jobs add|list|show|run|logs|daemon|install|service|...

# MCP server
memgrep serve [--http] [--host 127.0.0.1] [--port 3921] [--token <token>] [--allowed-host <host>]

# Optional suites (tools omitted until configured)
memgrep jira|neon|gcloud|posthog|upstash|producthunt setup|status
# Loop: use `loop init` / `loop setup` (not `<suite> setup`)

# File search (offline semantic grep)
memgrep index <dir>
memgrep search "query"
```

Full walkthroughs: [docs](https://memgrep.getuigen.dev).

## Agent memory

**In:** `ingest` (Cursor, Claude Code, Kiro) or `remember` (your own note / playbook).  
**Out:** `recall` (hybrid by default: vector + FTS5/BM25 via RRF), `list`, `show`, `copy`.

```bash
memgrep scan [--source kiro] [--new] [--last <n>]
memgrep ingest [--source cursor,claude,kiro]
memgrep ingest --pick 2,5
memgrep ingest --last [n]
memgrep ingest <file...>
memgrep remember "we chose X over Y because Z" --title decision
memgrep recall "<query>" [-k <n>] [--mode hybrid|vector|keyword]
```

Memory lives in `~/.memgrep` (`MEMGREP_HOME` to override). Re-ingest is idempotent by content hash.

| Tool | Source | Notes |
| --- | --- | --- |
| Cursor | `~/.cursor/projects/*/agent-transcripts/` | Full user + assistant turns |
| Claude Code | `~/.claude/projects/*/*.jsonl` | Full user + assistant turns |
| Kiro IDE | Kiro `globalStorage` workspace sessions | User turns and titles (assistant output is opaque) |
| Antigravity | Not yet | Encrypted protobuf; agents can still *query* via MCP |
| Anything else | `memgrep remember "<text>"` | Manual notes, decisions, postmortems |

New sources: implement `TranscriptSource` and pass it to `ingestTranscripts`.

### Give agents access (MCP)

One MCP server. Register once per client.

**No global install** (recommended):

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

**Global install:**

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

Config: Cursor `~/.cursor/mcp.json`, Claude Code `claude mcp add memgrep -- npx -y memgrep serve`, Kiro `~/.kiro/settings/mcp.json`.

**Always on the wire:** `recall`, `get_chat`, `list_chats`, `remember`, `resolve_open`, `jobs_*`.  
**When configured:** `loop_*`, `cursor_*`, plus optional suites below.

### Optional MCP suites

Unconfigured suites are omitted from the tool list.

| Suite | Configure | Purpose |
| --- | --- | --- |
| `cursor` | `memgrep cursor setup` | Local `@cursor/sdk` agent (`cursor_workspaces`, `cursor_status`, `cursor_run`) |
| `loop` | `memgrep loop init` / `loop setup` | Coding loop (`loop_run`, `loop_status`, upsert defaults) |
| `jira` | `memgrep jira setup` | Issues, comments, transitions |
| `neon` | `memgrep neon setup` | Read-only Neon project / branch metadata |
| `gcloud` | `memgrep gcloud setup` | Logs + GCE inspect (ADC / service account) |
| `posthog` | `memgrep posthog setup` | Analytics queries / flags |
| `upstash` | `memgrep upstash setup` | Redis REST helpers |
| `producthunt` | `memgrep producthunt setup` | PH read APIs |

### Optional public MCP (agnostic tunnel)

1. `npm start` or `memgrep serve --http` on `127.0.0.1:3921`
2. Point any tunnel at that port
3. Allow the public Host and require a bearer token:

```bash
export MEMGREP_MCP_TOKEN="$(cat ~/.memgrep/mcp-token)"
export MEMGREP_PUBLIC_URL=https://your-tunnel.example/mcp
# or MEMGREP_PUBLIC_HOST / MEMGREP_ALLOWED_HOSTS / ~/.memgrep/mcp-public-url
```

## Coding loop

Agnostic loop: free-text **task**, optional **inputs**, **exit conditions**, **exit actions**. The loop implements, verifies exits, then runs builtins (e.g. `github_pr`) and any remaining agent actions. Completion can notify via Telegram.

```bash
memgrep loop init prepaid --cwd ~/dev/prepaid
memgrep loop use prepaid
memgrep loop setup                    # edit cwd / git defaults
memgrep loop status --profile prepaid
memgrep loop run --task "Ship refunds health check" --profile prepaid   # foreground (CLI)
memgrep loop runs
```

Config lives in the project at `<cwd>/.memgrep/` (edit in your IDE; safe to commit), including `AGENTS.md` (how to add inputs/exits/actions for agents). Home keeps a thin pointer at `~/.memgrep/loops/<name>/project.json` and the template at `~/.memgrep/loop.base/`. Active: `~/.memgrep/loop.active` or `MEMGREP_LOOP_PROFILE`. Legacy home-only `loops/<name>/loop.json` still works until you re-init.

MCP: `loop_run` starts detached in the background; also `loop_run_status`, `loop_status`, `loop_upsert_*` / `loop_remove_*`. Requires Cursor; Jira optional for `jiraKey` context only.

## Scheduled playbooks (jobs)

A **job** is cron + pointer to a remembered playbook. The daemon fires Cursor in the job cwd with memgrep MCP; the agent `get_chat`s the playbook and runs your prompt.

```bash
memgrep jobs add \
  --name email-scan-am \
  --cron "30 8 * * 1-5" \
  --playbook-query "email scan" \
  --cwd ~/dev/career-ops \
  --prompt "Scan unread mail and summarize; do not send replies" \
  --mode auto

memgrep jobs list
memgrep jobs run email-scan-am
memgrep jobs logs email-scan-am
memgrep jobs install              # LaunchAgent com.memgrep.jobs
```

Stored under `~/.memgrep/jobs/`. Default mode is `notify` (Telegram summary). Use `--mode auto` carefully for read-only jobs. Same jobs are manageable from Cursor or Telegram via MCP.

## Cursor from your phone (Telegram)

Chat with a **local** Cursor agent from Telegram. You do not need the same Wi-Fi. Usage bills against your Cursor plan. Needs a [`CURSOR_API_KEY`](https://cursor.com/dashboard/integrations).

```bash
memgrep telegram
memgrep telegram setup career
memgrep telegram --profile career
memgrep telegram --all
memgrep telegram install --all
memgrep telegram service
```

Profiles: `~/.memgrep/telegram/<profile>.json`. The bot embeds loopback MCP so Cursor can call memory, jobs, loop, and configured suites mid-task.

On your phone: free text / `/ask`, `/ws` workspaces, `/cwd`, `/new`, `/model`, `/mode`, `/status`, `/recall`, `/list`, `/show`, `/open`, `/help`. Only allowlisted Telegram user ids get answers.

**Env overrides:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `CURSOR_API_KEY`, `MEMGREP_TELEGRAM_CWD`, `MEMGREP_TELEGRAM_MODEL`, `MEMGREP_TELEGRAM_PROFILE`.

**Split processes:** `memgrep serve --http` + `memgrep telegram --no-server` (`MEMGREP_MCP_URL` to override).

## File search

Semantic grep over any folder, fully offline:

```bash
npx memgrep index ./docs
npx memgrep search "how do I configure auth?"
```

`index` options: `--out` (default `.memgrep`), `--model` (any [Transformers.js-compatible](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction) embedding model).  
`search` options: `--index` (default `.memgrep`), `-k` for the number of results.

## Library usage

Same engine as an embeddable library (SQLite for semantic search, not a hosted DB):

```typescript
import { VectorIndex } from 'memgrep';

const index = await VectorIndex.create({ model: 'Xenova/all-MiniLM-L6-v2' });

await index.add([
  { id: 'doc1', text: 'To reset your password, click the forgot password link.' },
  { id: 'doc2', text: 'Our refund policy allows returns within 30 days.', metadata: { url: '/refunds' } },
]);

const hits = await index.search('I forgot my login', { k: 5 });
await index.save('./my-index');
const loaded = await VectorIndex.load('./my-index');
```

Also exported: `Embedder`, `chunkText`, `MemoryStore`, `ingestTranscripts`, and the per-tool parsers. Use `Embedder` + `chunkText` if you already have pgvector / LanceDB / Qdrant and only want local embeddings.

## How it works

**Chunks are searched; chats are returned.**

1. Transcripts parse to clean `User:` / `Assistant:` dialogue (tool noise stripped).
2. Text is chunked (~1000 chars, 200 overlap) and embedded locally (384-dim, Transformers.js).
3. Vectors go to HNSW; chats + chunk text to SQLite; FTS5/BM25 kept in sync via triggers.
4. Queries run vector + keyword in parallel; **RRF** merges. Exact ids ride keyword; meaning rides vectors.
5. Ingest is idempotent by content hash. Vector index is a rebuildable cache; SQLite is source of truth. Next `recall` / `ingest` / `serve` self-heals a divergent index.

## Limitations, honestly

- Hybrid search helps exact ids; very short or heavily punctuated strings can still miss.
- Kiro ingestion is partial. Antigravity cannot be ingested today.
- `delete` is not permanent against re-ingest if the source transcript still exists.
- One writer at a time; no cross-process lock yet (self-heal repairs loss on next open).
- Recall quality tracks what was said in dialogue; signal that lived only in tool output searches poorly. A one-line `remember` often wins.
- Telegram and jobs need a host that stays awake. LaunchAgents pause while the Mac sleeps.
- Loop and Cursor suites need a valid Cursor API key and allowlisted cwd.

## Roadmap

- Tombstones so `delete` survives re-ingest
- More transcript sources (Antigravity if the format opens, Codex CLI, Windsurf)
- Watch mode / continuous ingest
- Linux systemd units alongside macOS LaunchAgents
- Telegram `/jobs` slash shortcuts (MCP already covers manage-from-chat)
- Browser / WASM HNSW for the library

## Development

```bash
npm install
npm run build
npm test
```

Docs site: `cd docs && npm install && npm run dev` (port 4401). Live: [memgrep.getuigen.dev](https://memgrep.getuigen.dev).

## License

[MIT](LICENSE)
