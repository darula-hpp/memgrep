# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`npm start` / `npm stop`** — `scripts/start-all.sh` builds if needed, ensures `~/.memgrep/mcp-token`, reinstalls Telegram (`--all`) + jobs LaunchAgents (with `MEMGREP_MCP_TOKEN` in the plist), and keeps MCP on loopback only. Public tunnels are **not managed** by memgrep.
- **Agnostic public Host allowlist** — HTTP MCP accepts tunnel hostnames via `MEMGREP_PUBLIC_URL` / `MEMGREP_PUBLIC_HOST` / `MEMGREP_ALLOWED_HOSTS` / `~/.memgrep/mcp-public-url` (any vendor). `MEMGREP_NGROK_DOMAIN` remains as a one-release compat alias. Removed `scripts/start-tunnel.sh` / `stop-tunnel.sh`.
- **Cursor agent MCP tools** — optional suite on the existing memgrep MCP server (`cursor_workspaces`, `cursor_status`, `cursor_run`) that drives a **local** `@cursor/sdk` agent with a workspace allowlist. Configure with `node dist/cli.js cursor setup` (`~/.memgrep/cursor.json` or `CURSOR_API_KEY` + Telegram profile workspaces). Shared `runAgentTurn` runner is also used by Telegram and jobs. For remote/cloud Cursor clients: `memgrep serve --http` + `MEMGREP_MCP_TOKEN` + any tunnel to loopback with `MEMGREP_PUBLIC_URL`.
- **Upstash Redis MCP tools** — optional suite on the existing memgrep MCP server (`upstash_ping`, `upstash_get`, `upstash_set`, `upstash_del`, `upstash_dbsize`, `upstash_ttl`, `upstash_type`, `upstash_scan`). Configure with `node dist/cli.js upstash setup` (`~/.memgrep/upstash.json` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`); tools are omitted when unconfigured.
- **Neon MCP tools** — optional read-only suite on the existing memgrep MCP server (`neon_list_projects`, `neon_get_project`, `neon_list_branches`, `neon_connection_uri`). Configure with `node dist/cli.js neon setup` (`~/.memgrep/neon.json` or `NEON_API_KEY` / optional `NEON_PROJECT_ID`); tools are omitted when unconfigured. Supports project-scoped API keys (verify/list fall back to `GET /projects/{id}` / `subject_project_id` instead of listing all projects).
- **Google Cloud MCP tools** — optional read-only suite on the existing memgrep MCP server (`gcloud_list_projects`, `gcloud_logs_query`, `gcloud_list_instances`, `gcloud_get_instance`). Configure with `node dist/cli.js gcloud setup` (`~/.memgrep/gcloud.json` or `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` / optional `GOOGLE_APPLICATION_CREDENTIALS`); uses Application Default Credentials or a service-account JSON via `google-auth-library` (no `gcloud` CLI binary). Tools are omitted when unconfigured.
- **PostHog MCP tools** — optional read-only suite on the existing memgrep MCP server (`posthog_query`, `posthog_top_events`, `posthog_feature_flags`, `posthog_get_flag`). Configure with `node dist/cli.js posthog setup` (`~/.memgrep/posthog.json` or `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / optional `POSTHOG_HOST`); tools are omitted when unconfigured.

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

[Unreleased]: https://github.com/darula-hpp/memgrep/compare/v1.4.0...HEAD
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
