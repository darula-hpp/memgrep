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

## Keeping memory fresh

One-shot `memgrep ingest` is enough for ad-hoc sync. On macOS you can also install a LaunchAgent that runs ingest on an interval (default hourly). See [Background Ingest](/docs/guides/background-ingest).

## Privacy

There is no cloud sync for the memory store. Optional features (Telegram, Cursor API, MCP suites) use the network only for those integrations.
