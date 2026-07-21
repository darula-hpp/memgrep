---
title: How It Works
description: Architecture of memory, MCP, Telegram, and jobs.
---

# How It Works

## Memory plane

Transcripts from Cursor, Claude Code, and Kiro are ingested into a local SQLite database. Chunks are embedded with Transformers.js and indexed with HNSW for vector search. Hybrid recall can fuse keyword (FTS5) and vector scores. On macOS, `memgrep ingest install` can run that sync on an interval via LaunchAgent.

Agents never need to leave your machine to search that archive.

## MCP plane

`memgrep serve` exposes memory tools (and optional suites like Cursor, Jira, Neon, gcloud) over stdio or HTTP. Cursor agents attach the HTTP MCP with a bearer token so `recall` / `remember` / `get_chat` work mid-task.

## Telegram plane

`memgrep telegram` long-polls Telegram. Free text becomes a Cursor agent turn in an allowlisted workspace. Multi-profile bots and macOS LaunchAgents keep it running while the Mac is awake.

## Jobs plane

`memgrep jobs` stores cron schedules that resolve a playbook from memory, run Cursor with a prompt, and optionally notify Telegram.

## Loop plane

The coding loop is a per-project profile under `~/.memgrep/loops/<name>/`: inputs, exit conditions, and exit actions. `loop_run` starts a background verify loop that can open a PR or run custom deploy actions after PASS.
