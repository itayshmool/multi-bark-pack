#!/bin/bash
# multi-bark-pack prerequisites installer
# Usage: ./scripts/prerequisites.sh [--yes]
# Wix: ./scripts/prerequisites-wix.sh [--yes]

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Flags ---
AUTO_YES=false
WIX_MODE="${WIX_MODE:-false}"

for arg in "$@"; do
    case "$arg" in
        --yes|-y) AUTO_YES=true ;;
    esac
done

# Interactive prompt — auto-answers "y" when --yes is set
confirm() {
    if [ "$AUTO_YES" = true ]; then
        echo "y (auto)"
        return 0
    fi
    ask "$1 (y/n) "
    read -r ans
    [[ "$ans" =~ ^[Yy] ]]
}

# Like confirm but for optional items — auto-answers "n" when --yes is set
confirm_optional() {
    if [ "$AUTO_YES" = true ]; then
        echo "n (auto — optional)"
        return 1
    fi
    ask "$1 (y/n) "
    read -r ans
    [[ "$ans" =~ ^[Yy] ]]
}

# --- Tracking ---
INSTALLED=()
SKIPPED=()
FAILED=()

track_ok()   { INSTALLED+=("$1"); }
track_skip() { SKIPPED+=("$1"); }
track_fail() { FAILED+=("$1"); }

# =========================================================
header "multi-bark-pack — Prerequisites"

if [ "$WIX_MODE" = true ]; then
    echo -e "  ${BOLD}${CYAN}Wix mode${NC} — will use internal npm registry"
    echo ""
fi

echo -e "  This script checks and installs system-level"
echo -e "  dependencies needed to run multi-bark-pack."
echo ""

# =========================================================
# Step 0: Verify macOS
# =========================================================
if [[ "$(uname)" != "Darwin" ]]; then
    fail "This script only supports macOS."
    info "Linux support is planned — see ROADMAP.md"
    exit 1
fi

# =========================================================
header "1/8 — Homebrew"
# =========================================================
if command -v brew &>/dev/null; then
    ok "Homebrew $(brew --version 2>/dev/null | head -1 | sed 's/Homebrew //')"
    track_ok "Homebrew"
else
    warn "Homebrew not found"
    info "Homebrew is the package manager used to install tmux, ffmpeg, etc."
    if confirm "Install Homebrew?"; then
        echo ""
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for the rest of this script
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        if command -v brew &>/dev/null; then
            ok "Homebrew installed"
            track_ok "Homebrew"
        else
            fail "Homebrew installation failed"
            info "Install manually: https://brew.sh"
            track_fail "Homebrew"
        fi
    else
        fail "Homebrew is required for installing dependencies"
        track_fail "Homebrew"
        info "Install manually: https://brew.sh"
        info "Then re-run this script"
        exit 1
    fi
fi

# =========================================================
header "2/8 — Node.js (v18+)"
# =========================================================
NEED_NODE=false
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js v${NODE_VERSION}"
        track_ok "Node.js v${NODE_VERSION}"
    else
        warn "Node.js v${NODE_VERSION} — v18+ required"
        NEED_NODE=true
    fi
else
    warn "Node.js not found"
    NEED_NODE=true
fi

if [ "$NEED_NODE" = true ]; then
    if confirm "Install Node.js via Homebrew?"; then
        brew install node
        if command -v node &>/dev/null; then
            NODE_VERSION=$(node --version | sed 's/v//')
            ok "Node.js v${NODE_VERSION} installed"
            track_ok "Node.js v${NODE_VERSION}"
        else
            fail "Node.js installation failed"
            track_fail "Node.js"
        fi
    else
        fail "Node.js 18+ is required"
        track_fail "Node.js"
        info "Install manually: brew install node  or  https://nodejs.org"
    fi
fi

# =========================================================
header "3/8 — yarn"
# =========================================================
if command -v yarn &>/dev/null; then
    ok "yarn $(yarn --version 2>/dev/null)"
    track_ok "yarn"
else
    warn "yarn not found"
    if command -v npm &>/dev/null; then
        if confirm "Install yarn via npm?"; then
            npm install -g yarn
            if command -v yarn &>/dev/null; then
                ok "yarn $(yarn --version 2>/dev/null) installed"
                track_ok "yarn"
            else
                fail "yarn installation failed"
                track_fail "yarn"
            fi
        else
            fail "yarn is required to install dependencies"
            track_fail "yarn"
            info "Install manually: npm install -g yarn"
        fi
    else
        fail "npm not found — install Node.js first"
        track_fail "yarn"
    fi
fi

# =========================================================
header "4/8 — tmux"
# =========================================================
if command -v tmux &>/dev/null; then
    ok "tmux $(tmux -V 2>/dev/null | sed 's/tmux //')"
    track_ok "tmux"
else
    warn "tmux not found"
    info "tmux is required — each agent runs in a tmux session"
    if confirm "Install tmux via Homebrew?"; then
        brew install tmux
        if command -v tmux &>/dev/null; then
            ok "tmux $(tmux -V 2>/dev/null | sed 's/tmux //') installed"
            track_ok "tmux"
        else
            fail "tmux installation failed"
            track_fail "tmux"
        fi
    else
        fail "tmux is required"
        track_fail "tmux"
        info "Install manually: brew install tmux"
    fi
fi

# =========================================================
header "5/8 — Claude Code CLI"
# =========================================================
if command -v claude &>/dev/null; then
    CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "installed")
    ok "Claude Code CLI (${CLAUDE_VER})"
    track_ok "Claude Code CLI"
else
    warn "Claude Code CLI not found"
    info "Claude Code is the default LLM backend"
    if confirm "Install Claude Code CLI via npm?"; then
        npm install -g @anthropic-ai/claude-code
        if command -v claude &>/dev/null; then
            CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "installed")
            ok "Claude Code CLI (${CLAUDE_VER}) installed"
            track_ok "Claude Code CLI"
            echo ""
            info "Run 'claude' once to authenticate before starting the server"
        else
            fail "Claude Code CLI installation failed"
            track_fail "Claude Code CLI"
            info "Install manually: npm install -g @anthropic-ai/claude-code"
        fi
    else
        fail "Claude Code CLI is the default backend"
        track_fail "Claude Code CLI"
        info "Install manually: npm install -g @anthropic-ai/claude-code"
        info "You can still use other backends (cursor, codex, gemini)"
    fi
fi

# =========================================================
header "6/8 — ffmpeg (optional — voice messages)"
# =========================================================
if command -v ffmpeg &>/dev/null; then
    FFMPEG_VER=$(ffmpeg -version 2>/dev/null | head -1 | sed 's/ffmpeg version //' | cut -d' ' -f1)
    ok "ffmpeg ${FFMPEG_VER}"
    track_ok "ffmpeg"
else
    warn "ffmpeg not found (optional — needed for voice messages)"
    if confirm_optional "Install ffmpeg via Homebrew?"; then
        brew install ffmpeg
        if command -v ffmpeg &>/dev/null; then
            ok "ffmpeg installed"
            track_ok "ffmpeg"
        else
            fail "ffmpeg installation failed"
            track_fail "ffmpeg"
        fi
    else
        info "Skipped — voice messages won't work without it"
        track_skip "ffmpeg"
    fi
fi

# =========================================================
header "7/8 — whisper-cpp (optional — voice messages)"
# =========================================================
if command -v whisper-cli &>/dev/null || command -v whisper &>/dev/null; then
    ok "whisper-cpp"
    track_ok "whisper-cpp"
else
    warn "whisper-cpp not found (optional — needed for voice messages)"
    if confirm_optional "Install whisper-cpp via Homebrew?"; then
        brew install whisper-cpp
        if command -v whisper-cli &>/dev/null || command -v whisper &>/dev/null; then
            ok "whisper-cpp installed"
            track_ok "whisper-cpp"
        else
            fail "whisper-cpp installation failed"
            track_fail "whisper-cpp"
        fi
    else
        info "Skipped — voice messages won't work without it"
        track_skip "whisper-cpp"
    fi
fi

# =========================================================
header "8/8 — Node dependencies (yarn install)"
# =========================================================

# Wix registry switch (before yarn install)
if [ "$WIX_MODE" = true ]; then
    echo -e "  ${BOLD}Switching to Wix internal npm registry...${NC}"
    if [ -f "$SCRIPT_DIR/use-wix-registry.sh" ]; then
        bash "$SCRIPT_DIR/use-wix-registry.sh"
        ok "Wix registry lock files restored"
    else
        fail "scripts/use-wix-registry.sh not found"
        info "Expected at: $SCRIPT_DIR/use-wix-registry.sh"
        track_fail "Wix registry"
    fi
    echo ""
fi

if [ -d "$ROOT_DIR/node_modules" ]; then
    ok "node_modules exists"
    if confirm "Re-run yarn install?"; then
        (cd "$ROOT_DIR" && yarn install)
        ok "yarn install complete"
    else
        info "Skipped"
    fi
    track_ok "dependencies"
else
    echo "  Running yarn install..."
    (cd "$ROOT_DIR" && yarn install)
    if [ $? -eq 0 ]; then
        ok "yarn install complete"
        track_ok "dependencies"
    else
        fail "yarn install failed"
        track_fail "dependencies"
    fi
fi

# =========================================================
header "Summary"
# =========================================================

if [ ${#INSTALLED[@]} -gt 0 ]; then
    for item in "${INSTALLED[@]}"; do
        ok "$item"
    done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
    for item in "${SKIPPED[@]}"; do
        warn "$item (skipped)"
    done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
    for item in "${FAILED[@]}"; do
        fail "$item"
    done
fi

echo ""

# Check for critical failures
HAS_CRITICAL_FAIL=false
for item in "${FAILED[@]}"; do
    case "$item" in
        "Node.js"|"tmux"|"Homebrew"|"dependencies")
            HAS_CRITICAL_FAIL=true
            ;;
    esac
done

if [ "$HAS_CRITICAL_FAIL" = true ]; then
    fail "Some required tools are missing. Install them and re-run."
    exit 1
fi

echo -e "  ${GREEN}${BOLD}Prerequisites ready!${NC}"
echo ""
echo -e "  Next steps:"
echo ""
if [ ! -f "$ROOT_DIR/.env" ]; then
    echo -e "    1. Run the setup wizard to configure platforms:"
    echo -e "       ${BOLD}./scripts/setup.sh${NC}"
    echo ""
    echo -e "    2. Start the server:"
    echo -e "       ${BOLD}yarn start${NC}"
else
    echo -e "    Start the server:"
    echo -e "       ${BOLD}yarn start${NC}"
fi
echo ""
echo -e "  Other LLM backends (Cursor, Codex, Gemini):"
echo -e "    ${BOLD}./scripts/install-backends.sh${NC}"
echo ""
