---
title: Scheduled Jobs
description: Cron Cursor playbooks with Telegram notify.
---

# Scheduled Jobs

Jobs resolve a playbook from memory, run Cursor on a schedule, and optionally notify Telegram.

```bash
memgrep jobs add --name smoke-5m --cron "*/5 * * * *" \
  --playbook-query "smoke playbook" --cwd ~/dev/project \
  --prompt "Reply with one line: smoke ok and the current time." \
  --mode notify --profile default
memgrep jobs install
memgrep jobs run smoke-5m
memgrep jobs list
```

## Modes

- **notify**: Telegram message with the agent result
- Other modes depend on your installed version; check `memgrep jobs --help`

## Service

```bash
memgrep jobs service
```

Logs: `~/.memgrep/logs/jobs-launchd.log`
