---
title: Background Ingest
description: Keep local memory fresh with an hourly ingest LaunchAgent.
---

# Background Ingest

`memgrep ingest` is incremental and safe to re-run. The background daemon runs that sync on an interval so new Cursor / Claude Code / Kiro chats land in memory without a manual step.

This is **not** the same as [scheduled jobs](/docs/guides/scheduled-jobs). Jobs fire Cursor playbooks on a cron. The ingest daemon only scans local transcripts into `~/.memgrep`.

## Install (macOS)

Run this on the machine that has the chat transcripts (usually your Mac), not only on a remote MCP host.

```bash
memgrep ingest install
# optional:
memgrep ingest install --interval 15m --source cursor,claude
memgrep ingest service
```

Default interval is **1 hour**. Config is stored at `~/.memgrep/ingest.json`. The LaunchAgent label is `com.memgrep.ingest`.

## Commands

```bash
memgrep ingest daemon [--interval 1h] [--source cursor,claude,kiro]
memgrep ingest install [--interval 1h] [--source ...]
memgrep ingest uninstall
memgrep ingest service
```

`daemon` is what the LaunchAgent runs. Use it in the foreground to test.

## Logs

```text
~/.memgrep/logs/ingest-launchd.log
```

## Notes

- LaunchAgents pause while the Mac sleeps (same as Telegram and jobs).
- Unchanged chats are skipped by content hash, so quiet hours are cheap.
- The first tick may download the embedding model if the store is cold.
- True file-watch (`--watch`) is not in this release; interval sync covers the common case.
