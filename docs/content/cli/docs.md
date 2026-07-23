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

### Placeholders

Scalar fields:

```text
{{ title }}
{{ meeting.date }}
```

### Rich text (Markdown → Word)

Use a `| rich` placeholder; it may sit alone in a paragraph or next to a label:

```text
{{ deliberations | rich }}
TEST INFORMATION:{{ test_information | rich }}
{{ testing_scope | rich }}Out of Scope:
```

Sole-paragraph rich replaces that paragraph with Markdown→Word paragraphs. Mixed paragraphs keep the label text (preserving paragraph properties) and inject the Markdown paragraphs at the placeholder site.

Context value is Markdown. Supported:

- `**bold**` / `*italic*`
- `#` / `##` / `###` headings (bold; body stays Arial 12pt)
- bullet / numbered lists (nest for indentation)
- `>` blockquote indentation

Rich output always forces **Arial 12pt** (scalars/loops still inherit the template run styles).

```json
{
  "deliberations": "## 3.1 Review\n\n**Closed:** DSTV pending…\n\n- Item one\n  - Nested detail\n\n> Note indented"
}
```

The docs editor shows a Markdown toolbar for `| rich` fields.

### Table row loops

Repeat a table row (or block of rows) with Nunjucks-style tags:

```text
{% for item in attendees %}{{ item.name }}{% endfor %}
```

Put `{% for item in attendees %}` and `{% endfor %}` in the same row, or on their own marker rows around the template row. Context should include an array:

```json
{
  "title": "Retro",
  "attendees": [
    { "name": "Ada", "role": "Chair" },
    { "name": "Bob", "role": "Scribe" }
  ]
}
```

The localhost editor (`docs edit` / `docs_serve`) shows iterable collections with **Add row** / **Remove** controls.

### Block / table loops

Repeat an entire Word table (or a contiguous block of tables ± paragraphs) once per item in a context array. Put the `{% for %}` / `{% endfor %}` markers on their own paragraphs immediately before and after the table. Nested row loops inside the block resolve against the outer item (Nunjucks scoping):

```text
{% for case in test_cases %}
  [ entire test-case table ]
  TEST CASE #{{ case.number }}
  {{ case.title }}
  {% for p in case.steps %}
    {{ p.number }} | {{ p.test_step_input }} | …
  {% endfor %}
{% endfor %}
```

```json
{
  "task_id": "TASK-123",
  "test_cases": [
    {
      "number": "1",
      "title": "Login happy path",
      "steps": [
        {
          "number": "1",
          "test_step_input": "Open login",
          "expected_results": "Form shown",
          "actual_results": "Form shown",
          "pass_fail": "PASS"
        }
      ]
    }
  ]
}
```

`docs extract` reports nested iterables (`test_cases` as block → `steps` as rows). The editor shows **Add case** / nested **Add row** for steps. An empty array removes the template table and markers.

Existing single-table row loops are unchanged.

## MCP

Always registered (no credentials): `docs_setup`, `docs_list_templates`, `docs_extract`, `docs_fill`, `docs_list`, `docs_serve`. Paths resolve from the MCP server process cwd. See [Optional Suites](/docs/mcp/optional-suites).
