# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.5] - 2026-07-23

### Added

- **Docs block / table loops** - `{% for %}` / `{% endfor %}` on paragraphs around a whole table (or table+paragraph block) clones the block per array item; nested row loops (e.g. `case.steps`) resolve in item scope. Extract reports nested `IterableSchema` (`kind: 'block' | 'rows'`); the localhost editor supports Add case / nested Add row.

## [1.6.4] - 2026-07-22

### Changed

- **Docs `| rich` font** - Markdown rich fills always emit Arial 12pt (headings stay bold, no size bump) so minutes don’t fall back to Calibri.

## [1.6.3] - 2026-07-22

### Added

- **Docs `{{ field | rich }}`** - Markdown rich-text variables (bold, italic, headings, lists/indent, blockquotes) expand to OOXML paragraphs; docs editor includes a Markdown toolbar for rich fields.

## [1.6.2] - 2026-07-22

### Added

- **Docs table row loops** - `{% for item in items %}…{% endfor %}` expands Word table rows from context arrays; extract reports iterables; the localhost editor supports add/remove rows for those collections.

## [1.6.1] - 2026-07-22

### Added

- **Docs suite (templated Word)** - project-local Jinja-style `.docx` fill with `jszip` + `nunjucks`. Templates live in `<cwd>/.memgrep/templates/`; filled output + `.context.json` sidecars in `<cwd>/.memgrep/docs/`. CLI: `memgrep docs setup|status|list|fill|edit` (alias `doc`). MCP (always on): `docs_setup`, `docs_list_templates`, `docs_extract`, `docs_fill`, `docs_list`, `docs_serve`. Localhost field editor on `127.0.0.1:8791` re-fills from the original template on save.

## [1.6.0] - 2026-07-21

### Added

- **Edge node + cloud hub** - cloud `serve --http` hosts a WebSocket edge hub (`/edge`); edge hosts (macOS / Linux / Windows) use `memgrep edge pair|install|daemon` for `edge_status` / `edge_ping` / `edge_run` / `edge_loop_run` / `edge_cursor_run`, one-way memory sync-up, `loop run --target edge`, and jobs `--executor edge`. Service install: LaunchAgent, systemd --user, or Windows Startup. Docs: Edge Hub guide.

## [1.5.5] - 2026-07-21

### Added

- **Background ingest daemon** - `memgrep ingest daemon|install|uninstall|service` runs idempotent transcript sync on an interval (default 1h) via LaunchAgent `com.memgrep.ingest`. Config: `~/.memgrep/ingest.json`. Docs: Background Ingest guide.

## [1.5.4] - 2026-07-18

### Added

- **Loop `AGENTS.md`** - seeded into `~/.memgrep/loop.base/` and copied into each project `<cwd>/.memgrep/` on init; planted on resolve if missing. Guide covers adding inputs/exits/actions (CLI + MCP), artifact kinds, and `LOOP_*` trailers. Implement/verify prompts point agents at it.

## [1.5.3] - 2026-07-18

### Added

- **Project-local loop config** - `loop init` writes editable config to `<cwd>/.memgrep/` (`loop.json` + manifests). Home profile is a thin `~/.memgrep/loops/<name>/project.json` pointer. Template stays at `~/.memgrep/loop.base/`. Upserts/status/run resolve through the project store; existing home-only profiles still work, and a home `loop.json` auto-links if the project `.memgrep/` already exists.

## [1.5.2] - 2026-07-18

### Fixed

- **`loop init` / `loop setup` create missing cwd** - `--cwd` / workspace path is created with `mkdir -p` when the directory does not exist yet (was: `cwd does not exist`).

## [1.5.1] - 2026-07-18

### Fixed

- **`memgrep --version` matches the published package** - CLI reads version from `package.json` instead of a hardcoded `1.0.0` string (npm was already `1.5.x`).

### Changed

- **README CLI accuracy** - one-shot stack requires `npm run build` before `node dist/cli.js`; file-search options split (`index` vs `search`); Telegram slash list includes `/cwd` and `/model`; MCP always-on tools include `resolve_open`; suite table documents configure commands; `loop run` (CLI foreground) vs MCP `loop_run` (detached) clarified; `serve` documents `--token` and `--allowed-host`.

## [1.5.0] - 2026-07-18

### Added

- **Docs site** - Next.js docs under `docs/` at [https://memgrep.getuigen.dev](https://memgrep.getuigen.dev) (getting started, concepts, guides, CLI, MCP).
- **Expanded product README** - frames memory, coding loop, Telegram, jobs, and optional MCP suites as the full surface area.
- **Per-project loop profiles** - copy-from-base configs under `~/.memgrep/loops/<name>/` (template `~/.memgrep/loop.base/`). CLI: `loop init <name>`, `loop use <name>`, `--profile` on run/upserts/status. MCP `loop_run` / upserts accept optional `profile`. Active profile in `~/.memgrep/loop.active` (or `MEMGREP_LOOP_PROFILE`). Legacy `~/.memgrep/loop.json` migrates once into `loops/default`.
- **Loop MCP tools** - optional agnostic coding loop (`loop_status`, `loop_run`, `loop_run_status`, plus `loop_upsert_*` / `loop_remove_*` for defaults). Free-text `task` is required; optional `jiraKey` only enriches context. Defaults are generic **inputs**, **exit conditions**, and **exit actions** (path/url/text/builtin) with agent-facing manifests under `~/.memgrep/loops/<profile>/`. After coding PASS, builtins run first (`github_pr`), then a Cursor turn for remaining actions. Configure with `memgrep loop init <name>` / `loop setup`; requires Cursor; Jira optional; omitted when unconfigured.
- **Loop long-running runs** - `loop_run` spawns a detached `loop run` CLI process and returns immediately. Completion is pushed via Telegram; `loop_run_status` / `loop runs` are on-demand inspect only. Per-turn agent timeout defaults to 45 minutes.
- **Loop scoped commit/push (builtin `github_pr`)** - after PASS, when configured as an exit action, opens a worktree from `origin/<baseBranch>`, commits **only** paths from `LOOP_CHANGED_FILES` (fallback: newly dirty since run baseline), pushes, then `gh pr create`. Skips secrets; HTTPS push fallback via `gh` when SSH origin fails.
- **`npm start` / `npm stop`** - `scripts/start-all.sh` builds if needed, ensures `~/.memgrep/mcp-token`, reinstalls Telegram (`--all`) + jobs LaunchAgents (with `MEMGREP_MCP_TOKEN` in the plist), and keeps MCP on loopback only. Public tunnels are **not managed** by memgrep.
- **Agnostic public Host allowlist** - HTTP MCP accepts tunnel hostnames via `MEMGREP_PUBLIC_URL` / `MEMGREP_PUBLIC_HOST` / `MEMGREP_ALLOWED_HOSTS` / `~/.memgrep/mcp-public-url` (any vendor). `MEMGREP_NGROK_DOMAIN` remains as a one-release compat alias. Removed `scripts/start-tunnel.sh` / `stop-tunnel.sh`.
- **Cursor agent MCP tools** - optional suite on the existing memgrep MCP server (`cursor_workspaces`, `cursor_status`, `cursor_run`) that drives a **local** `@cursor/sdk` agent with a workspace allowlist. Configure with `memgrep cursor setup` (`~/.memgrep/cursor.json` or `CURSOR_API_KEY` + Telegram profile workspaces). Shared `runAgentTurn` runner is also used by Telegram and jobs. For remote/cloud Cursor clients: `memgrep serve --http` + `MEMGREP_MCP_TOKEN` + any tunnel to loopback with `MEMGREP_PUBLIC_URL`.
- **Upstash Redis MCP tools** - optional suite (`upstash_ping`, `upstash_get`, `upstash_set`, `upstash_del`, `upstash_dbsize`, `upstash_ttl`, `upstash_type`, `upstash_scan`). Configure with `memgrep upstash setup`; tools omitted when unconfigured.
- **Neon MCP tools** - optional read-only suite (`neon_list_projects`, `neon_get_project`, `neon_list_branches`, `neon_connection_uri`). Configure with `memgrep neon setup`; supports project-scoped API keys.
- **Google Cloud MCP tools** - optional read-only suite (`gcloud_list_projects`, `gcloud_logs_query`, `gcloud_list_instances`, `gcloud_get_instance`). Configure with `memgrep gcloud setup`; ADC or service-account JSON via `google-auth-library` (no `gcloud` CLI binary).
- **PostHog MCP tools** - optional read-only suite (`posthog_query`, `posthog_top_events`, `posthog_feature_flags`, `posthog_get_flag`). Configure with `memgrep posthog setup`; tools omitted when unconfigured.

## [1.4.0] - 2026-07-13

### Added

- **Product Hunt MCP tools** — optional read-only suite on the existing memgrep MCP server (`ph_today`, `ph_search`, `ph_get_post`, `ph_comments`). Configure with `node dist/cli.js producthunt setup` (`~/.memgrep/producthunt.json` or `PRODUCTHUNT_TOKEN` / API key+secret); tools are omitted when unconfigured.
- **Jira MCP tools** — optional Atlassian Cloud suite on the existing memgrep MCP server (`jira_search`, `jira_get_issue`, `jira_create_issue`, `jira_add_comment`, `jira_transition`, `jira_list_projects`). Configure with `node dist/cli.js jira setup` (`~/.memgrep/jira.json` or `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_API_TOKEN`); tools are omitted when unconfigured. Cursor agents (including Telegram free text) get them via the shared HTTP MCP attachment.
- **Hybrid recall** — FTS5/BM25 keyword search fused with HNSW vectors via reciprocal rank fusion (RRF). Exact ids and error strings no longer depend on semantic similarity alone. Strategy backends: `vector`, `keyword`, `hybrid` (default). CLI: `memgrep recall "<query>" --mode keyword`.

### Changed

- Telegram bot replies convert Markdown (`**bold**`, code, links) to Telegram HTML `parse_mode` so formatting renders instead of showing raw `**`.

## [1.3.0] - 2026-07-12

### Added

- **`/open <id>`** — after `/list` or `/recall`, resume a remembered Cursor chat when a live agent id is known; otherwise inject the transcript into the current conversation.
- Persist `cursor_agent_id` on ingested Cursor transcripts (and backfill from `agent-…` transcript paths) so `/open` can resume.

### Changed

- Telegram Cursor run timeout raised from 5 minutes to **10 minutes**.
- On run **timeout** or **empty/opaque model errors**, automatically start a fresh Cursor conversation (avoids resume→fail loops).

### Fixed

- Stronger recovery when Cursor reports `already has active run`: match busy errors by message (not only `AgentBusyError`), retry with `local.force`, and if still busy reset to a new agent and retry once.

## [1.2.0] - 2026-07-12

### Added

- **`/mode`** — switch Cursor conversation mode from Telegram (`agent` or `plan`; `ask` aliases to `plan`). Persisted per bot profile and shown on `/status`.

### Fixed

- Telegram no longer fails with `Agent already has active run` after a timed-out or crashed Cursor turn — retries once with SDK `local.force` to expire the stuck run.

## [1.1.0] - 2026-07-12

### Added

- More resilient Telegram/Cursor session handling across reconnects and long-running chats.

### Changed

- Internal code quality improvements (atomic writes, process guards, session store hardening).

## [1.0.2] - 2026-07-12

### Added

- OpenClaw-style long polling for the Telegram bot (more reliable message delivery under load).

## [1.0.1] - 2026-07-11

### Added

- **Playbooks** — store reusable workflows with `remember`, recall them from any agent (CLI, MCP, or Telegram), and attach them to scheduled jobs.

## [1.0.0] - 2026-07-11

### Added

- **Cursor from your phone** — `memgrep telegram` runs a real local Cursor agent via `@cursor/sdk`, streaming replies back through Telegram.
- **Scheduled jobs** — cron-driven playbooks (`memgrep jobs`) with CLI, MCP tools (`jobs_*`), and a background daemon.
- **macOS LaunchAgents** — `memgrep telegram install` and `memgrep jobs install` for always-on Telegram bots and job scheduling across logout/reboot.
- **Multi-profile Telegram bots** — separate BotFather tokens, workspaces, and models per profile; `memgrep telegram --all` runs every profile in one process.
- **Workspace switching** — `/ws`, `/cwd`, and `/new` commands to move between project folders and start fresh Cursor conversations.
- **Model switching** — `/model` command to list and change the Cursor model without restarting the bot.
- **Telegram memory shortcuts** — `/recall`, `/list`, and `/show` for direct memory access from chat.
- **MCP job tools** — agents can list, add, update, remove, run, and inspect jobs from Cursor, Claude Code, Kiro, or Telegram.
- Legacy `telegram.json` auto-migrates to `telegram/default.json`.

### Changed

- Repositioned memgrep as **local agent memory + Cursor from your phone** (README and package metadata).
- Documented always-on macOS setup, service verification, and restart steps for Telegram and jobs.

### Fixed

- `memgrep telegram install --all` works correctly under Commander.
- Transient Cursor SDK network failures no longer crash the Telegram process.

## [0.1.3] - 2026-07-11

### Added

- Telegram bot integration (initial): allowlisted bot driving a local Cursor agent with embedded loopback MCP.
- CLI commands reorganized into logical subcommands (`memgrep telegram`, `memgrep jobs`, etc.).

### Changed

- memgrep is now Cursor-first via Telegram (agent runtime + memory in one tool).

## [0.1.2] - 2026-07-08

### Changed

- Deferred embedder load and index healing until the first vector operation (`recall`, `ingest`, `serve`) — `list`, `show`, `copy`, `delete`, and `scan` stay fast without downloading the model.
- Reduced internal code duplication.

### Fixed

- Repository URLs in package metadata.

## [0.1.1] - 2026-07-08

### Fixed

- Model storage issues in the embedding pipeline.

### Changed

- Improved package description.
- Added colored CLI output via `picocolors`.
- Added demo GIF and updated demo assets.

## [0.1.0] - 2026-07-08

### Added

- **Semantic search library** — `VectorIndex`, `Embedder`, and `chunkText` for local, offline vector search (Transformers.js + HNSW).
- **Agent memory** — ingest chat history from Cursor, Claude Code, and Kiro into a unified local store (`~/.memgrep`).
- **CLI** — `ingest`, `scan`, `recall`, `list`, `show`, `copy`, `delete`, `remember`, `index`, and `search`.
- **MCP server** — `memgrep serve` exposes `recall`, `get_chat`, `list_chats`, and `remember` to any MCP-capable agent.
- SQLite + HNSW index with self-healing (rebuilds the vector cache from the database after crashes or interrupted ingests).
- Idempotent ingestion by content hash; manual notes via `remember` land in the same searchable memory.

[Unreleased]: https://github.com/darula-hpp/memgrep/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/darula-hpp/memgrep/compare/v1.5.5...v1.6.0
[1.5.5]: https://github.com/darula-hpp/memgrep/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/darula-hpp/memgrep/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/darula-hpp/memgrep/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/darula-hpp/memgrep/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/darula-hpp/memgrep/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/darula-hpp/memgrep/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/darula-hpp/memgrep/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/darula-hpp/memgrep/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/darula-hpp/memgrep/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/darula-hpp/memgrep/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/darula-hpp/memgrep/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/darula-hpp/memgrep/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/darula-hpp/memgrep/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/darula-hpp/memgrep/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/darula-hpp/memgrep/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/darula-hpp/memgrep/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/darula-hpp/memgrep/releases/tag/v0.1.0
