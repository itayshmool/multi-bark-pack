#!/bin/bash
# Run bark-pack on a local repo
# Usage: ./run-on-repo.sh /path/to/your/repo

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

BARK_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTS_DIR="$BARK_DIR/projects"

# --- Validate input ---
if [ -z "$1" ]; then
    echo -e "${RED}Usage:${NC} ./run-on-repo.sh /path/to/your/repo"
    exit 1
fi
REPO_PATH="$1"

REPO_PATH="$(cd "$REPO_PATH" 2>/dev/null && pwd)" || {
    echo -e "${RED}Directory not found:${NC} $1"
    exit 1
}

REPO_NAME="$(basename "$REPO_PATH")"
LINK_PATH="$PROJECTS_DIR/$REPO_NAME"

echo ""
echo -e "${BOLD}🐕 bark-pack — run on repo${NC}"
echo ""
echo -e "  Repo:     ${GREEN}$REPO_PATH${NC}"
echo -e "  Name:     $REPO_NAME"
echo -e "  Bark dir: $BARK_DIR"
echo ""

# --- Preflight checks ---
for cmd in node tmux yarn; do
    if ! command -v $cmd &>/dev/null; then
        echo -e "${RED}Missing:${NC} $cmd — run ./prerequisites.sh first"
        exit 1
    fi
done

if [ ! -d "$BARK_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    (cd "$BARK_DIR" && yarn install)
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
echo -e "${BOLD}Starting bark-pack server...${NC}"
echo ""
echo -e "  Send a message to your bot with:"
echo -e "  ${GREEN}Work on $REPO_NAME in projects/$REPO_NAME. <your task>${NC}"
echo ""
echo -e "  Watch pups: ${BOLD}tmux ls${NC} / ${BOLD}tmux attach -t bark-<name>${NC}"
echo -e "  Stop:       ${BOLD}Ctrl+C${NC}"
echo ""

cd "$BARK_DIR"
exec bash start.sh
