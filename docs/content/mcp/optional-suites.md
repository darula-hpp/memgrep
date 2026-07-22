---
title: Optional Suites
description: Cursor, Jira, Neon, gcloud, and other optional MCP tool packs.
---

# Optional Suites

These register only when configured (except **Docs**, which is always registered):

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
| Docs | `memgrep docs setup` (optional; creates dirs) | Fill Jinja-style Word templates under `.memgrep/templates` → `.memgrep/docs`; local web editor via `docs_serve` |
| Edge (HTTP serve) | `memgrep edge token` + host `edge pair` | `edge_status`, `edge_ping`, `edge_run` when an edge is connected |

**Docs tools** (`docs_setup`, `docs_list_templates`, `docs_extract`, `docs_fill`, `docs_list`, `docs_serve`) use the MCP server process cwd: templates in `<cwd>/.memgrep/templates`, filled output in `<cwd>/.memgrep/docs`.

Edge tools are registered on HTTP `serve` always; they return **edge offline** until an edge node is paired and connected. See [Edge Node + Cloud Hub](/docs/guides/edge-hub).

Unconfigured credential suites (except edge and docs) are omitted from the tool list entirely.
