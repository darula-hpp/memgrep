---
title: Quick Start
description: Install memgrep and run your first recall in minutes.
---

# Quick Start

Requires Node.js 18+.

## 1. Memory

```bash
npm install -g memgrep
memgrep ingest
memgrep recall "how did we fix the auth race?"
memgrep copy
```

`ingest` indexes chat history (incremental after the first run). `copy` puts the top hit on the clipboard.

Keep memory fresh on macOS without a manual ingest:

```bash
memgrep ingest install
memgrep ingest service
```

## 2. Cursor from your phone

```bash
memgrep telegram
```

First run walks you through BotFather token, Cursor API key, and project cwd. Text your bot, then keep it always-on on macOS:

```bash
memgrep telegram install
memgrep telegram service
```

## 3. Scheduled playbooks

```bash
memgrep remember "Smoke: reply with one line ok + time. Do not edit files." --title smoke-playbook
memgrep jobs add --name smoke-5m --cron "*/5 * * * *" \
  --playbook-query "smoke playbook" --cwd ~/dev/project \
  --prompt "Reply with one line: smoke ok and the current time. Do not edit files." \
  --mode notify --profile default
memgrep jobs install
memgrep jobs run smoke-5m
```

## Always-on on macOS

| Service | Install | Status |
| --- | --- | --- |
| Telegram bots + MCP | `memgrep telegram install` | `memgrep telegram service` |
| Jobs scheduler | `memgrep jobs install` | `memgrep jobs service` |
| Background ingest | `memgrep ingest install` | `memgrep ingest service` |

Telegram + Cursor + jobs need network and a `CURSOR_API_KEY` from the Cursor dashboard.
