---
title: MCP Overview
description: How memgrep exposes tools to agents.
---

# MCP Overview

memgrep runs an MCP server that Cursor (and other clients) can attach to.

```bash
node dist/cli.js serve --http
# or npm start for the full local stack
```

Auth: bearer token from `~/.memgrep/mcp-token`. Public tunnels need an allowlisted host via `MEMGREP_PUBLIC_URL` or related env vars.

See [MCP Setup](/docs/guides/mcp-setup).
