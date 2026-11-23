#!/bin/sh
# Start as root only long enough to make the data volume writable for the unprivileged "node" user,
# then drop privileges. If that is not possible (unusual volume), keep running so the app stays up.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if chown -R node:node "$DATA_DIR" 2>/dev/null && command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups node src/server.js
  fi
  echo "[entrypoint] warning: could not switch to user node, running as root" >&2
fi
exec node src/server.js
