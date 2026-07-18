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
