---
title: MCP Setup
description: Attach memgrep memory to Cursor over HTTP MCP.
---

# MCP Setup

## Start the server

```bash
npm start
# or: node dist/cli.js serve --http
```

`npm start` builds if needed, ensures `~/.memgrep/mcp-token`, and installs LaunchAgents for Telegram and jobs when configured.

## Cursor attachment

Point Cursor at the HTTP MCP URL with `Authorization: Bearer <token>`. Token lives in `~/.memgrep/mcp-token` (or env).

For tunnels, set `MEMGREP_PUBLIC_URL` / `MEMGREP_ALLOWED_HOSTS` so DNS-rebinding protection accepts the public host.

## Tools

Core memory tools always register when the store opens. Optional suites (Cursor, Jira, Neon, gcloud, PostHog, Upstash, Product Hunt) appear only when configured via `memgrep <suite> setup`.
