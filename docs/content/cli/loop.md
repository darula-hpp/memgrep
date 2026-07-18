---
title: Loop CLI
description: Per-project loop profiles and background runs.
---

# Loop CLI

```bash
memgrep loop init <name> [--cwd <path>] [--force]
memgrep loop use <name>
memgrep loop setup [--profile <name>]
memgrep loop status [--profile <name>]
memgrep loop run --task "..." [--profile <name>]
memgrep loop runs [runId]
memgrep loop input|exit|action set|rm ...
```

- Project config: `<cwd>/.memgrep/` (`loop.json` + manifests + `AGENTS.md`)
- Home pointer: `~/.memgrep/loops/<name>/project.json`
- Template: `~/.memgrep/loop.base/`
- Active: `~/.memgrep/loop.active`
