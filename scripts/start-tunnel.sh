#!/usr/bin/env bash
# Back-compat: start everything (telegram + jobs + tunnel).
exec "$(cd "$(dirname "$0")" && pwd)/start-all.sh" "$@"
