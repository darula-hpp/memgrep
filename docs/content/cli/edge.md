---
title: Edge CLI
description: Pair, install, and operate the edge node client.
---

# Edge CLI

```bash
memgrep edge token
memgrep edge pair <hub-url> --token <token> [--tools edge_ping,edge_run] [--no-sync]
memgrep edge daemon
memgrep edge install [--tools ...] [--no-sync]
memgrep edge uninstall
memgrep edge service
memgrep edge status
```

- **token** - run on the cloud hub; prints pairing token
- **pair** - run on the edge host; writes `~/.memgrep/edge.json`
- **install** - background service (LaunchAgent / systemd --user / Windows Startup)
- **daemon** - foreground client (what the service runs)

See [Edge Node + Cloud Hub](/docs/guides/edge-hub).
