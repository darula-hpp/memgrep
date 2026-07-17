---
title: Telegram + Cursor
description: Drive a local Cursor agent from Telegram.
---

# Telegram + Cursor

## Setup

```bash
memgrep telegram
```

You will configure:

1. BotFather token
2. Cursor API key
3. Allowlisted workspace cwd(s)

## Always-on

```bash
memgrep telegram install --all
memgrep telegram service
```

Logs: `~/.memgrep/logs/telegram-launchd.log`

## Tips

- Only one poller per bot token. Stop foreground `memgrep telegram` before installing the LaunchAgent.
- Switch workspaces with the bot's workspace commands when you have multiple allowlisted paths.
- Pair with MCP so the agent can `recall` playbooks mid-task.
