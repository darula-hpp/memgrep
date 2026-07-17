---
title: Introduction
description: What memgrep is and when to use it.
---

# Introduction

memgrep is local agent memory, Cursor from your phone, and scheduled playbooks.

It started as searchable memory for coding agents. It still is that: every chat across Cursor, Claude Code, and Kiro, fully local, recallable via CLI or MCP. It also grew into a thin remote coding path: an allowlisted Telegram bot that drives a real Cursor agent in a real project folder, with memgrep memory attached mid-task. And jobs: attach a remembered playbook to a cron schedule so Cursor runs it on a timer.

## The point

Lock the workflows you already figured out. `remember` a playbook once. Later the agent `recall`s it (from Cursor, Claude, Kiro, or Telegram) instead of vibing the same steps from scratch and burning tokens every time. Schedule it if it should run on a clock.

## What you get

- **Playbooks you reuse.** Store the procedure. Pull it into the next run with `recall` / `get_chat`, or fire it on a cron with `memgrep jobs`.
- **Memory that outlives sessions.** Ingest transcripts into one local store. Any MCP-capable agent can search mid-task.
- **Cursor from your phone.** Telegram long-polls, runs `@cursor/sdk` against a cwd on your machine, and streams replies back.
- **Fully local memory plane.** Embeddings on-device. SQLite plus HNSW. No cloud for your chat archive.

## Next

- [Quick Start](/docs/getting-started/quick-start)
- [Installation](/docs/getting-started/installation)
- [How It Works](/docs/concepts/how-it-works)
