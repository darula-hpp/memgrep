---
title: Coding Loop
description: Per-project loop profiles with inputs, exits, and actions.
---

# Coding Loop

The loop is an agnostic coding cycle: free-text task, pinned inputs, exit conditions, and post-PASS actions.

## Profiles

Editable config lives in the **project**:

`<cwd>/.memgrep/loop.json` (plus input/exit/action manifests)

The global template stays at `~/.memgrep/loop.base/`. A thin named pointer is stored at `~/.memgrep/loops/<name>/project.json` so `loop use` / active profile still work.

```bash
memgrep loop init launchpad --cwd ~/dev/project
memgrep loop use launchpad
memgrep loop status
```

Open `<repo>/.memgrep/` in your IDE to edit defaults. Commit that folder if the team should share exits/actions.

## Run

```bash
memgrep loop run --task "Ship the portal" --profile launchpad
# or via MCP: loop_run with optional profile
```

`loop_run` starts in the background. Telegram notifies on completion. Inspect with `memgrep loop runs`.

## Upserts

```bash
memgrep loop input set --id outputDir --kind text --value examples/app --profile launchpad
memgrep loop exit set --id tests --kind text --value "All tests pass" --profile launchpad
memgrep loop action set --id github_pr --kind builtin --value github_pr --profile launchpad
```

Active profile: `~/.memgrep/loop.active` or `MEMGREP_LOOP_PROFILE`.
