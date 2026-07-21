---
title: Memory Commands
description: Ingest, recall, remember, and manage local chats.
---

# Memory Commands

```bash
memgrep ingest
memgrep recall "query" [--mode hybrid|keyword|vector]
memgrep remember "note text" --title my-title
memgrep copy
memgrep list
memgrep show <id>
memgrep delete <id>
```

`ingest` is incremental after the first full pass. Use `recall` with `--mode keyword` when you need exact strings.

## Background ingest

Keep memory fresh without running `ingest` by hand:

```bash
memgrep ingest install [--interval 1h] [--source cursor,claude,kiro]
memgrep ingest service
memgrep ingest daemon [--interval 1h] [--source ...]
memgrep ingest uninstall
```

See [Background Ingest](/docs/guides/background-ingest).
