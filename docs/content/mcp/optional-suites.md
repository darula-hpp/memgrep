---
title: Optional Suites
description: Cursor, Jira, Neon, gcloud, and other optional MCP tool packs.
---

# Optional Suites

These register only when configured:

| Suite | Setup | Purpose |
| --- | --- | --- |
| Cursor | `memgrep cursor setup` | Local agent run / workspaces |
| Loop | `memgrep loop setup` / `loop init` | Coding loop tools |
| Jira | `memgrep jira setup` | Issues and transitions |
| Neon | `memgrep neon setup` | Read-only Neon metadata |
| gcloud | `memgrep gcloud setup` | Logs and GCE inspect |
| PostHog | `memgrep posthog setup` | Analytics queries |
| Upstash | `memgrep upstash setup` | Redis REST helpers |
| Product Hunt | `memgrep producthunt setup` | PH read APIs |
| Edge (HTTP serve) | `memgrep edge token` + host `edge pair` | `edge_status`, `edge_ping`, `edge_run` when an edge is connected |

Edge tools are registered on HTTP `serve` always; they return **edge offline** until an edge node is paired and connected. See [Edge Node + Cloud Hub](/docs/guides/edge-hub).

Unconfigured suites (except edge) are omitted from the tool list entirely.
