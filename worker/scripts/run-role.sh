#!/bin/sh
set -eu

case "${1:-}" in
  dj|lounge|spotlight) export HMO_WORKER_ROLE="$1" ;;
  *) echo "Unknown worker role" >&2; exit 1 ;;
esac

if [ "$HMO_WORKER_ROLE" = lounge ]; then
  export HMO_LOUNGE_DIRECT_ONLY=true
fi

if [ "$HMO_WORKER_ROLE" = dj ]; then
  exec node -r /app/src/persona-bootstrap.js -r /app/src/room-tts-bootstrap.js /app/src/server.js
fi
exec node /app/src/server.js
