---
title: Installation
description: Install memgrep from npm or from source.
---

# Installation

## Global (recommended)

```bash
npm install -g memgrep
memgrep --version
```

Native addons (`hnswlib`, `better-sqlite3`) build on install. The embedding model (~25 MB) downloads once on first run. Memory search is offline after that.

## From source

```bash
git clone https://github.com/darula-hpp/memgrep.git
cd memgrep
npm install
npm run build
node dist/cli.js --help
```

## Config home

By default memgrep stores state under `~/.memgrep/` (`MEMGREP_HOME` overrides). That includes the memory store, Telegram profiles, Cursor config, loop profiles, and logs.

## Docs site (this site)

```bash
cd docs
npm install
npm run dev
```

Production docs are published at [memgrep.getuigen.dev](https://memgrep.getuigen.dev).
