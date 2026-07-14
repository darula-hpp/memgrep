#!/usr/bin/env bash
# Back-compat: full stop (telegram + jobs + tunnel).
exec "$(cd "$(dirname "$0")" && pwd)/stop-all.sh" "$@"
