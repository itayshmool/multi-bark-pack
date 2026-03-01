#!/bin/bash
# Start bark-pack server with auto-restart
# Usage: bash scripts/start.sh [--path=/path/to/repo]
# Without --path, uses the caller's current directory

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

BARK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECTS_DIR="$BARK_DIR/projects"

# --- Parse args ---
REPO_PATH=""
for arg in "$@"; do
    case "$arg" in
        --path=*) REPO_PATH="${arg#--path=}" ;;
    esac
done

# Default to caller's cwd
REPO_PATH="${REPO_PATH:-$(pwd)}"

# Resolve to absolute path
REPO_PATH="$(cd "$REPO_PATH" 2>/dev/null && pwd)" || {
    echo -e "${RED}Directory not found:${NC} $REPO_PATH"
    exit 1
}

REPO_NAME="$(basename "$REPO_PATH")"
LINK_PATH="$PROJECTS_DIR/$REPO_NAME"

echo ""
echo -e "${BOLD}bark-pack${NC}"
echo ""
echo -e "  Repo:     ${GREEN}$REPO_PATH${NC}"
echo -e "  Name:     $REPO_NAME"
echo -e "  Bark dir: $BARK_DIR"
echo ""

# --- Preflight checks ---
for cmd in node tmux yarn; do
    if ! command -v $cmd &>/dev/null; then
        echo -e "${RED}Missing:${NC} $cmd — run ./scripts/prerequisites.sh first"
        exit 1
    fi
done

if [ ! -d "$BARK_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    (cd "$BARK_DIR" && yarn install)
fi

if [ ! -d "$BARK_DIR/dist/server" ]; then
    echo -e "${YELLOW}Building TypeScript...${NC}"
    (cd "$BARK_DIR" && yarn build)
fi

if [ ! -f "$BARK_DIR/.env" ]; then
    echo -e "${RED}No .env found.${NC} Run: cp .env.example .env and configure a platform (Telegram/Slack/WhatsApp)"
    exit 1
fi

# --- Symlink repo into projects/ ---
mkdir -p "$PROJECTS_DIR"

if [ -L "$LINK_PATH" ]; then
    EXISTING_TARGET="$(readlink "$LINK_PATH")"
    if [ "$EXISTING_TARGET" = "$REPO_PATH" ]; then
        echo -e "  ${GREEN}✓${NC} Symlink already exists"
    else
        echo -e "  ${YELLOW}⚠${NC} Symlink points to $EXISTING_TARGET — updating"
        rm "$LINK_PATH"
        ln -s "$REPO_PATH" "$LINK_PATH"
        echo -e "  ${GREEN}✓${NC} Symlink updated"
    fi
elif [ -e "$LINK_PATH" ]; then
    echo -e "  ${YELLOW}⚠${NC} $LINK_PATH already exists (not a symlink) — skipping"
else
    ln -s "$REPO_PATH" "$LINK_PATH"
    echo -e "  ${GREEN}✓${NC} Symlinked → projects/$REPO_NAME"
fi

echo ""
echo -e "${BOLD}Starting server...${NC}"
echo ""
echo -e "  Send a message to your bot with:"
echo -e "  ${GREEN}Work on $REPO_NAME in projects/$REPO_NAME. <your task>${NC}"
echo ""
echo -e "  Watch pups: ${BOLD}tmux ls${NC} / ${BOLD}tmux attach -t bark-<name>${NC}"
echo -e "  Stop:       ${BOLD}Ctrl+C${NC}"
echo ""

# --- Auto-restart loop ---
cd "$BARK_DIR"
export BARK_REPO_PATH="$REPO_PATH"
export BARK_REPO_NAME="$REPO_NAME"
trap 'kill $PID 2>/dev/null; exit 0' SIGINT SIGTERM

while true; do
    node dist/server/index.js &
    PID=$!
    wait $PID
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo ""
        echo "Restarting in 3s..."
        sleep 3
    else
        echo ""
        echo "Server exited with code $EXIT_CODE. Stopping."
        exit $EXIT_CODE
    fi
done
