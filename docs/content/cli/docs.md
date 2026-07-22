---
title: Docs CLI
description: Fill Jinja-style Word templates under .memgrep/templates into .memgrep/docs.
---

# Docs CLI

Project-local Word template fill with a small localhost editor.

```bash
memgrep docs setup
memgrep docs status
memgrep docs list
memgrep docs fill <template.docx> --context '{"title":"Retro"}' [--name slug]
memgrep docs fill <template.docx> --context-file ./fields.json --name sprint-retro
memgrep docs edit [slug] [--port 8791]
```

Alias: `memgrep doc …`

## Layout

```
<cwd>/
  .memgrep/
    templates/     # source .docx with {{ field }} / {{ dotted.path }}
    docs/          # filled .docx + .context.json sidecars
```

- **setup** — create `templates` and `docs` dirs (idempotent)
- **status** — show paths and counts
- **list** — list templates in `.memgrep/templates`
- **fill** — apply JSON context; writes `.memgrep/docs/<slug>.docx` and `.context.json`
- **edit** — start `127.0.0.1` web UI (default port `8791`); save re-fills from the original template

Placeholders are Nunjucks-style variables only (`{{ name }}`). Loops/conditionals are out of scope for v1.

## MCP

Always registered (no credentials): `docs_setup`, `docs_list_templates`, `docs_extract`, `docs_fill`, `docs_list`, `docs_serve`. Paths resolve from the MCP server process cwd. See [Optional Suites](/docs/mcp/optional-suites).
