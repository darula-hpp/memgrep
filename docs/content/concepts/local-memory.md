---
title: Local Memory
description: On-device embeddings, SQLite, and hybrid recall.
---

# Local Memory

memgrep keeps your chat archive on disk under `~/.memgrep/`.

## Pieces

- **SQLite** for chat metadata and FTS5 keyword search
- **HNSW** for vector nearest-neighbor search
- **Transformers.js** for local embeddings (model cached after first download)

## Hybrid recall

Default mode fuses keyword and vector rankings (RRF) so exact ids and error strings still surface even when semantics are weak.

```bash
memgrep recall "ECONNRESET loop" --mode hybrid
memgrep recall "ECONNRESET loop" --mode keyword
```

## Privacy

There is no cloud sync for the memory store. Optional features (Telegram, Cursor API, MCP suites) use the network only for those integrations.
