---
title: Playbooks
description: Store procedures once and reuse them across agents.
---

# Playbooks

A playbook is a durable procedure: steps, constraints, script paths, and the judgment you do not want to re-derive every session.

## Store

```bash
memgrep remember "Deploy checklist: ..." --title deploy-prod
```

Or ingest chats where you already solved the problem, then `recall` later.

## Use

- From CLI: `memgrep recall "deploy prod"`
- From MCP: agent calls `recall` / `get_chat`
- From jobs: `--playbook-query` pulls the best match into a scheduled Cursor run

## Tips

- Prefer short, imperative titles.
- Put constraints in the note body ("do not push to main", "use staging first").
- Re-`remember` when the procedure changes so the next recall stays accurate.
