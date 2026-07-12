# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/darula-hpp/memgrep/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/darula-hpp/memgrep/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/darula-hpp/memgrep/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/darula-hpp/memgrep/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/darula-hpp/memgrep/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/darula-hpp/memgrep/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/darula-hpp/memgrep/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/darula-hpp/memgrep/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/darula-hpp/memgrep/releases/tag/v0.1.0
