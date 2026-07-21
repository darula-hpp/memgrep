---
title: Jobs CLI
description: Cron schedules for Cursor playbooks.
---

# Jobs CLI

```bash
memgrep jobs add --name <name> --cron "<expr>" --playbook-query "..." --cwd <path> --prompt "..."
memgrep jobs add ... --requires edge              # fail if edge node offline
memgrep jobs add ... --executor edge --cwd /path  # Cursor turn on edge node
memgrep jobs list
memgrep jobs run <name>
memgrep jobs install
memgrep jobs service
memgrep jobs remove <name>
```

See the [Scheduled Jobs](/docs/guides/scheduled-jobs) guide for a full example.
