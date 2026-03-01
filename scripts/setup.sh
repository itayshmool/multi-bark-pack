#!/bin/bash
# bark-pack interactive setup wizard
# Usage: ./scripts/setup.sh

set -e

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }
ask()  { echo -en "  ${CYAN}?${NC} $1"; }

header() {
    echo ""
    echo -e "${BOLD}${BLUE}═══ $1 ═══${NC}"
    echo ""
}

# --- State ---
ENABLE_WA=false
ENABLE_TG=false
ENABLE_SLACK=false
WA_GROUP="bark-pack"
WA_OWNER=""
TG_TOKEN=""
TG_OWNER=""
SLACK_BOT_TOKEN=""
SLACK_APP_TOKEN=""
SLACK_OWNER=""
MISSING_REQUIRED=false

# =========================================================
header "bark-pack setup wizard"
echo -e "  This wizard will check prerequisites, install"
echo -e "  dependencies, and configure your .env file."
echo ""

# =========================================================
header "1/5 — Prerequisites"

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js v${NODE_VERSION}"
    else
        fail "Node.js v${NODE_VERSION} — v18+ required"
        info "Install: brew install node  or  https://nodejs.org"
        MISSING_REQUIRED=true
    fi
else
    fail "Node.js not found"
    info "Install: brew install node  or  https://nodejs.org"
    MISSING_REQUIRED=true
fi

# tmux
if command -v tmux &>/dev/null; then
    ok "tmux $(tmux -V | sed 's/tmux //')"
else
    fail "tmux not found"
    if command -v brew &>/dev/null; then
        ask "Install tmux via Homebrew? (y/n) "
        read -r ans
        if [[ "$ans" =~ ^[Yy] ]]; then
            brew install tmux
            ok "tmux installed"
        else
            MISSING_REQUIRED=true
        fi
    else
        info "Install: brew install tmux"
        MISSING_REQUIRED=true
    fi
fi

# Claude CLI
if command -v claude &>/dev/null; then
    ok "Claude Code CLI"
    # Quick check if it runs
    if claude --version &>/dev/null; then
        info "$(claude --version 2>&1 | head -1)"
    fi
else
    fail "Claude Code CLI not found"
    info "Install: https://docs.anthropic.com/en/docs/claude-code"
    info "After install, run: claude  (to authenticate)"
    MISSING_REQUIRED=true
fi

# Optional: whisper-cpp
if command -v whisper-cli &>/dev/null; then
    ok "whisper-cpp (voice transcription)"
else
    warn "whisper-cpp not found (optional — needed for voice messages)"
    if command -v brew &>/dev/null; then
        ask "Install whisper-cpp + ffmpeg via Homebrew? (y/n) "
        read -r ans
        if [[ "$ans" =~ ^[Yy] ]]; then
            brew install whisper-cpp ffmpeg
            ok "whisper-cpp + ffmpeg installed"
        else
            info "Skip — voice messages won't work without it"
        fi
    else
        info "Install later: brew install whisper-cpp ffmpeg"
    fi
fi

# Optional: ffmpeg (check separately if whisper was already there)
if command -v ffmpeg &>/dev/null; then
    ok "ffmpeg"
elif ! command -v whisper-cli &>/dev/null; then
    : # already warned above
else
    warn "ffmpeg not found (needed alongside whisper-cpp for voice)"
    info "Install: brew install ffmpeg"
fi

if [ "$MISSING_REQUIRED" = true ]; then
    echo ""
    fail "Missing required tools. Install them and re-run ./scripts/setup.sh"
    exit 1
fi

# =========================================================
header "2/5 — Dependencies"

if [ -d "node_modules" ] && [ -f "yarn.lock" ]; then
    ok "node_modules exists"
    ask "Re-run yarn install? (y/n) "
    read -r ans
    if [[ "$ans" =~ ^[Yy] ]]; then
        yarn install
        ok "yarn install complete"
    else
        info "Skipped"
    fi
else
    echo "  Running yarn install..."
    yarn install
    ok "yarn install complete"
fi

# =========================================================
header "3/5 — Platform Setup"
echo -e "  Enable at least one platform. You can always"
echo -e "  re-run this wizard to add more later."
echo ""

# --- WhatsApp ---
echo -e "  ${BOLD}WhatsApp${NC}"
ask "Enable WhatsApp? (y/n) "
read -r ans
if [[ "$ans" =~ ^[Yy] ]]; then
    ENABLE_WA=true

    ask "WhatsApp group name [bark-pack]: "
    read -r val
    if [ -n "$val" ]; then WA_GROUP="$val"; fi

    ask "Your phone number (digits only, e.g. 972501234567): "
    read -r val
    WA_OWNER="$val"
    if [[ ! "$WA_OWNER" =~ ^[0-9]{10,15}$ ]]; then
        warn "Doesn't look like a phone number — continuing anyway"
    fi

    ok "WhatsApp enabled (group: ${WA_GROUP})"
    info "On first run, scan the QR code with WhatsApp → Linked Devices"
else
    info "WhatsApp skipped"
fi
echo ""

# --- Telegram ---
echo -e "  ${BOLD}Telegram${NC}"
ask "Enable Telegram? (y/n) "
read -r ans
if [[ "$ans" =~ ^[Yy] ]]; then
    ENABLE_TG=true

    echo ""
    info "To create a Telegram bot:"
    info "1. Open https://t.me/BotFather"
    info "2. Send /newbot and follow the prompts"
    info "3. Copy the bot token"
    echo ""

    ask "Bot token (e.g. 123456:ABC-DEF...): "
    read -r val
    TG_TOKEN="$val"
    if [[ ! "$TG_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
        warn "Token format looks unusual — continuing anyway"
    fi

    echo ""
    info "To find your Telegram user ID:"
    info "Send a message to https://t.me/userinfobot"
    echo ""

    ask "Your Telegram user ID (digits): "
    read -r val
    TG_OWNER="$val"
    if [[ ! "$TG_OWNER" =~ ^[0-9]+$ ]]; then
        warn "Expected numeric ID — continuing anyway"
    fi

    ok "Telegram enabled"
    info "Chat ID will be auto-detected on first message"
else
    info "Telegram skipped"
fi
echo ""

# --- Slack ---
echo -e "  ${BOLD}Slack${NC}"
ask "Enable Slack? (y/n) "
read -r ans
if [[ "$ans" =~ ^[Yy] ]]; then
    ENABLE_SLACK=true

    echo ""
    info "To create a Slack app:"
    info ""
    info "1. Go to https://api.slack.com/apps → Create New App"
    info ""
    info "2. Enable Socket Mode (Settings → Socket Mode)"
    info "   Generate an app-level token with 'connections:write' scope"
    info ""
    info "3. Add Bot Token Scopes (OAuth & Permissions):"
    info "   chat:write, channels:history, channels:read,"
    info "   groups:history, groups:read, im:history, im:read,"
    info "   im:write, pins:write, pins:read, users:read,"
    info "   reactions:write"
    info ""
    info "4. Subscribe to Bot Events (Event Subscriptions):"
    info "   message.channels, message.groups, message.im, app_mention"
    info ""
    info "5. Enable Messages Tab (App Home)"
    info ""
    info "6. Install the app to your workspace"
    info "   Then invite the bot to channels: /invite @your-bot"
    echo ""

    ask "Bot token (xoxb-...): "
    read -r val
    SLACK_BOT_TOKEN="$val"
    if [[ ! "$SLACK_BOT_TOKEN" =~ ^xoxb- ]]; then
        warn "Expected token starting with xoxb- — continuing anyway"
    fi

    ask "App token (xapp-...): "
    read -r val
    SLACK_APP_TOKEN="$val"
    if [[ ! "$SLACK_APP_TOKEN" =~ ^xapp- ]]; then
        warn "Expected token starting with xapp- — continuing anyway"
    fi

    echo ""
    info "To find your Slack user ID:"
    info "Click your profile → ⋯ More → Copy member ID"
    echo ""

    ask "Your Slack user ID (U...): "
    read -r val
    SLACK_OWNER="$val"
    if [[ ! "$SLACK_OWNER" =~ ^U[A-Z0-9]+$ ]]; then
        warn "Expected ID starting with U — continuing anyway"
    fi

    ok "Slack enabled"
else
    info "Slack skipped"
fi
echo ""

# --- Validate at least one platform ---
if [ "$ENABLE_WA" = false ] && [ "$ENABLE_TG" = false ] && [ "$ENABLE_SLACK" = false ]; then
    echo ""
    fail "No platforms enabled! You need at least one."
    ask "Start over with platform selection? (y/n) "
    read -r ans
    if [[ "$ans" =~ ^[Yy] ]]; then
        echo ""
        echo "  Please re-run: ./scripts/setup.sh"
        exit 0
    else
        fail "Cannot continue without a platform. Exiting."
        exit 1
    fi
fi

# =========================================================
header "4/5 — Writing .env"

# Backup existing .env
if [ -f ".env" ]; then
    warn ".env already exists"
    ask "Overwrite? (existing file backed up to .env.backup) (y/n) "
    read -r ans
    if [[ "$ans" =~ ^[Yy] ]]; then
        cp .env .env.backup
        ok "Backed up to .env.backup"
    else
        fail "Keeping existing .env. Setup aborted."
        exit 0
    fi
fi

# Build .env content
ENV_CONTENT="# Generated by bark-pack setup wizard — $(date '+%Y-%m-%d %H:%M')
"

# WhatsApp
if [ "$ENABLE_WA" = true ]; then
    ENV_CONTENT+="
# WhatsApp
WA_ENABLED=true
WA_GROUP=${WA_GROUP}
WA_OWNER=${WA_OWNER}
"
else
    ENV_CONTENT+="
# WhatsApp (disabled)
WA_ENABLED=false
"
fi

# Telegram
if [ "$ENABLE_TG" = true ]; then
    ENV_CONTENT+="
# Telegram
TELEGRAM_TOKEN=${TG_TOKEN}
TELEGRAM_CHAT_ID=
TG_OWNER=${TG_OWNER}
"
else
    ENV_CONTENT+="
# Telegram (disabled)
# TELEGRAM_TOKEN=
# TG_OWNER=
"
fi

# Slack
if [ "$ENABLE_SLACK" = true ]; then
    ENV_CONTENT+="
# Slack
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_OWNER=${SLACK_OWNER}
"
else
    ENV_CONTENT+="
# Slack (disabled)
# SLACK_BOT_TOKEN=
# SLACK_APP_TOKEN=
# SLACK_OWNER=
"
fi

# Voice (always optional)
ENV_CONTENT+="
# Voice transcription (optional — macOS/Homebrew default)
# WHISPER_MODEL=/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin
"

echo "$ENV_CONTENT" > .env
ok ".env written"

# =========================================================
header "5/5 — Ready!"

echo -e "  ${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo -e "  Start the server:"
echo -e "    ${BOLD}yarn start${NC}"
echo ""

if [ "$ENABLE_WA" = true ]; then
    echo -e "  ${YELLOW}WhatsApp:${NC} Scan the QR code on first run"
fi
if [ "$ENABLE_TG" = true ]; then
    echo -e "  ${YELLOW}Telegram:${NC} Send a message to your bot to start"
fi
if [ "$ENABLE_SLACK" = true ]; then
    echo -e "  ${YELLOW}Slack:${NC} DM the bot or @mention it in a channel"
fi

echo ""
echo -e "  Send any message to spawn your first pup!"
echo -e "  Use ${BOLD}/help${NC} in chat to see all commands."
echo ""
