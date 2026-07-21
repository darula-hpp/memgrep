---
title: Edge Node + Cloud Hub
description: Pair an edge host with a cloud memgrep hub for local tools and memory sync-up.
---

# Edge Node + Cloud Hub

Run **cloud memgrep** as the always-on MCP hub (Telegram, jobs, recall). Install an **edge node** on any machine that has local transcripts or GUI/local-only tools (macOS, Linux, or Windows). The edge dials **out** to the hub, proxies allowlisted tools, and can push memory upward so cloud `recall` sees that host's chats.

This is not the same as exposing edge MCP with a public tunnel. The edge connects out; no inbound ports on the laptop/desktop.

## Roles

| Side | Owns |
| --- | --- |
| Cloud (`memgrep serve --http`) | MCP, Telegram, jobs, edge hub WebSocket, canonical memory |
| Edge (`memgrep edge`) | Local tools (`edge_run`), local ingest, one-way memory push |

## Cloud setup

On the always-on host:

```bash
memgrep edge token          # writes ~/.memgrep/edge-hub.json
memgrep serve --http --host 0.0.0.0 --token "$MEMGREP_MCP_TOKEN"
# Edge WebSocket: ws(s)://<host>:<port>/edge
```

Keep Telegram/jobs on this host as today.

## Edge host setup

On the machine with Cursor/Claude transcripts or local tools:

```bash
memgrep edge pair https://your-hub-host/mcp --token <token-from-edge-token>
memgrep edge install
memgrep edge service
```

Config: `~/.memgrep/edge.json`.

Background install by OS:

| OS | Backend |
| --- | --- |
| macOS | LaunchAgent `com.memgrep.edge` |
| Linux | systemd user unit `memgrep-edge.service` |
| Windows | Startup folder `memgrep-edge.cmd` |

Foreground anywhere: `memgrep edge daemon`.

Optional:

```bash
memgrep edge pair <url> --token <t> --tools edge_ping,edge_run
memgrep edge pair <url> --token <t> --no-sync
```

## Tools (when edge is online)

Cloud MCP exposes:

- `edge_status` - presence / capabilities
- `edge_ping` - round-trip to the edge
- `edge_run` - allowlisted local command (`argv` must match `runAllowlist` in `edge.json`)
- `edge_loop_run` - start a coding loop **on the edge** (background)
- `edge_cursor_run` - one-shot Cursor agent **on the edge** (blocking)

If the edge is asleep or disconnected, these return **edge offline**.

Default `runAllowlist` is platform-aware (POSIX: `echo`/`uname`/`pwd`/`date`; Windows: `echo`/`cmd`/`hostname`/`where`). Edit `~/.memgrep/edge.json` to add binaries you trust.

### Run loop / jobs on the edge

Enable tools at pair time (default includes loop + cursor):

```bash
memgrep edge pair <hub> --token <t> --tools edge_ping,edge_run,edge_loop_run,edge_cursor_run
```

From the cloud hub (or any client that can reach `serve`):

```bash
# Start loop on the edge (uses edge Cursor + loop profile / cwd)
memgrep loop run --task "fix flaky tests" --target edge
# MCP: loop_run with target=edge, or edge_loop_run

# Jobs: Cursor playbook turn executes on the edge
memgrep jobs add ... --executor edge --cwd /path/on/edge
```

`--requires edge` (auto-set for `--executor edge`) fails the run if the edge is offline. The hub stays the control plane; heavy compute stays on the edge.

## Memory sync (edge → cloud)

After local ingest (or on a timer while connected), the edge pushes unsynced chats to the hub by content hash. Cloud re-embeds and stores them with source `edge:<deviceId>:...`. Cloud agents can `recall` edge-host work without the edge being online.

Disable with `--no-sync` at pair time. Synced hashes: `~/.memgrep/edge-synced.json`.

## Jobs that need the edge

```bash
memgrep jobs add ... --requires edge
```

(`mac-edge` is accepted as a deprecated alias.) If the edge is offline when the job fires, the run fails with a clear `edge offline` error (no queue in v1).

## Status

```bash
memgrep edge status
memgrep edge service
# Cloud MCP: edge_status
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3921/edge/status
```
