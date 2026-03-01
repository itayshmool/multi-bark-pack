#!/bin/bash
# Crontab-friendly script: ensures the server is always running.
# If the server is already up, exits silently.
# Usage: * * * * * /path/to/ensure-server.sh
#
# Logs:
#   .bark-tmp/ensure-server.log  — startup/restart events only (max 100KB)
#   .bark-tmp/server.log         — full server output (max 5MB)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENSURE_LOG="$DIR/.bark-tmp/ensure-server.log"
SERVER_LOG="$DIR/.bark-tmp/server.log"
PORT=3333
MAX_ENSURE_BYTES=102400    # 100KB
MAX_SERVER_BYTES=5242880   # 5MB

# Already running? Exit silently.
if lsof -ti:$PORT >/dev/null 2>&1; then
    exit 0
fi

mkdir -p "$DIR/.bark-tmp"

# Rotate a log file if it exceeds the given size limit
rotate_log() {
    local log="$1" max="$2"
    if [ -f "$log" ] && [ "$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null)" -gt "$max" ]; then
        mv "$log" "$log.old"
    fi
}

rotate_log "$ENSURE_LOG" "$MAX_ENSURE_BYTES"
rotate_log "$SERVER_LOG" "$MAX_SERVER_BYTES"

echo "$(date '+%Y-%m-%d %H:%M:%S') Server not running — starting..." >> "$ENSURE_LOG"

cd "$DIR"
nohup bash scripts/start.sh >> "$SERVER_LOG" 2>&1 &
echo "$(date '+%Y-%m-%d %H:%M:%S') Started (PID $!)" >> "$ENSURE_LOG"
