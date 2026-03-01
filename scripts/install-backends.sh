#!/bin/bash
# multi-bark-pack — Advanced LLM Backend Installer
# Installs, authenticates, and verifies all supported backends.
# Usage: ./scripts/install-backends.sh [--yes] [--skip-auth]

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
SKIP_AUTH=false

for arg in "$@"; do
    case "$arg" in
        --yes|-y)       AUTO_YES=true ;;
        --skip-auth)    SKIP_AUTH=true ;;
    esac
done

confirm() {
    if [ "$AUTO_YES" = true ]; then
        echo "y (auto)"
        return 0
    fi
    ask "$1 (y/n) "
    read -r ans
    [[ "$ans" =~ ^[Yy] ]]
}

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
AUTHENTICATED=()
SKIPPED=()
FAILED=()

# --- .env helpers ---
read_env_var() {
    local var="$1"
    if [ -f "$ROOT_DIR/.env" ]; then
        grep -E "^${var}=" "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-
    fi
}

write_env_var() {
    local var="$1"
    local val="$2"
    local envfile="$ROOT_DIR/.env"

    if [ ! -f "$envfile" ]; then
        echo "${var}=${val}" > "$envfile"
        return
    fi

    if grep -qE "^${var}=" "$envfile" 2>/dev/null; then
        # Update existing
        local tmp="${envfile}.tmp"
        sed "s|^${var}=.*|${var}=${val}|" "$envfile" > "$tmp"
        mv "$tmp" "$envfile"
    elif grep -qE "^#\s*${var}=" "$envfile" 2>/dev/null; then
        # Uncomment existing
        local tmp="${envfile}.tmp"
        sed "s|^#\s*${var}=.*|${var}=${val}|" "$envfile" > "$tmp"
        mv "$tmp" "$envfile"
    else
        # Append
        echo "${var}=${val}" >> "$envfile"
    fi
}

update_enabled_backends() {
    local backends=()
    command -v claude &>/dev/null && backends+=("claude-code")
    command -v cursor-agent &>/dev/null && backends+=("cursor")
    command -v codex &>/dev/null && backends+=("codex")
    command -v gemini &>/dev/null && backends+=("gemini")

    if [ ${#backends[@]} -gt 0 ]; then
        local joined
        joined=$(IFS=,; echo "${backends[*]}")
        write_env_var "ENABLED_BACKENDS" "$joined"

        # Set DEFAULT_BACKEND to first available if not set
        local current_default
        current_default=$(read_env_var "DEFAULT_BACKEND")
        if [ -z "$current_default" ]; then
            write_env_var "DEFAULT_BACKEND" "${backends[0]}"
        fi
    fi
}

# =========================================================
header "multi-bark-pack — Backend Installer"

echo -e "  Installs, authenticates, and verifies LLM backends."
echo -e "  Each backend is optional — you need at least one."
echo ""
if [ "$SKIP_AUTH" = true ]; then
    info "Auth steps will be skipped (--skip-auth)"
    echo ""
fi

# =========================================================
# 1. Claude Code
# =========================================================
header "1/4 — Claude Code (default backend)"

CLAUDE_INSTALLED=false
if command -v claude &>/dev/null; then
    CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "installed")
    ok "Claude Code CLI (${CLAUDE_VER})"
    CLAUDE_INSTALLED=true
    INSTALLED+=("Claude Code")
else
    info "Claude Code is the default and most capable backend."
    info "Requires an Anthropic account (Max or API subscription)."
    echo ""
    if confirm "Install Claude Code CLI?"; then
        echo ""
        npm install -g @anthropic-ai/claude-code
        if command -v claude &>/dev/null; then
            CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "installed")
            ok "Claude Code CLI (${CLAUDE_VER}) installed"
            CLAUDE_INSTALLED=true
            INSTALLED+=("Claude Code")
        else
            fail "Installation failed"
            info "Try manually: npm install -g @anthropic-ai/claude-code"
            FAILED+=("Claude Code")
        fi
    else
        info "Skipped"
        SKIPPED+=("Claude Code")
    fi
fi

# Auth: Claude
if [ "$CLAUDE_INSTALLED" = true ] && [ "$SKIP_AUTH" = false ]; then
    echo ""
    # Quick auth check — claude --version works even without auth,
    # but running a trivial prompt will fail without login
    if claude -p "hi" --max-turns 0 &>/dev/null 2>&1; then
        ok "Authentication verified"
        AUTHENTICATED+=("Claude Code")
    else
        warn "Not authenticated yet"
        info "Claude Code authenticates via your browser."
        if confirm "Run 'claude auth login' now?"; then
            echo ""
            claude auth login
            if claude -p "hi" --max-turns 0 &>/dev/null 2>&1; then
                ok "Authentication successful"
                AUTHENTICATED+=("Claude Code")
            else
                warn "Auth may still be pending — you can run 'claude' later to complete it"
            fi
        else
            info "Run 'claude' later to authenticate"
        fi
    fi
fi

# =========================================================
# 2. Cursor
# =========================================================
header "2/4 — Cursor (optional)"

CURSOR_INSTALLED=false
if command -v cursor-agent &>/dev/null; then
    CURSOR_VER=$(cursor-agent --version 2>/dev/null | head -1 || echo "installed")
    ok "Cursor Agent CLI (${CURSOR_VER})"
    CURSOR_INSTALLED=true
    INSTALLED+=("Cursor")
else
    info "Cursor requires a Cursor Pro/Business subscription."
    info "Auth is shared with the Cursor desktop app."
    echo ""
    if confirm_optional "Install Cursor Agent CLI?"; then
        echo ""
        if command -v brew &>/dev/null; then
            info "Installing via Homebrew..."
            brew install --cask cursor-cli
        else
            info "Installing via curl..."
            curl -fsSL https://cursor.com/install | bash
        fi
        if command -v cursor-agent &>/dev/null; then
            CURSOR_VER=$(cursor-agent --version 2>/dev/null | head -1 || echo "installed")
            ok "Cursor Agent CLI (${CURSOR_VER}) installed"
            CURSOR_INSTALLED=true
            INSTALLED+=("Cursor")
        else
            fail "Installation failed"
            info "Try manually: brew install --cask cursor-cli"
            FAILED+=("Cursor")
        fi
    else
        info "Skipped"
        SKIPPED+=("Cursor")
    fi
fi

# Auth: Cursor
if [ "$CURSOR_INSTALLED" = true ] && [ "$SKIP_AUTH" = false ]; then
    echo ""
    info "Cursor auth is shared with the Cursor desktop app."
    info "If you're logged into Cursor on this machine, you're good."
    ok "No additional auth needed"
    AUTHENTICATED+=("Cursor")
fi

# =========================================================
# 3. OpenAI Codex
# =========================================================
header "3/4 — OpenAI Codex (optional)"

CODEX_INSTALLED=false
if command -v codex &>/dev/null; then
    CODEX_VER=$(codex --version 2>/dev/null | head -1 || echo "installed")
    ok "Codex CLI (${CODEX_VER})"
    CODEX_INSTALLED=true
    INSTALLED+=("Codex")
else
    info "Codex has a free tier via your ChatGPT account."
    info "Pro/Plus gives access to more powerful models (o3, o4-mini)."
    echo ""
    if confirm_optional "Install OpenAI Codex CLI?"; then
        echo ""
        npm install -g @openai/codex
        if command -v codex &>/dev/null; then
            CODEX_VER=$(codex --version 2>/dev/null | head -1 || echo "installed")
            ok "Codex CLI (${CODEX_VER}) installed"
            CODEX_INSTALLED=true
            INSTALLED+=("Codex")
        else
            fail "Installation failed"
            info "Try manually: npm install -g @openai/codex"
            FAILED+=("Codex")
        fi
    else
        info "Skipped"
        SKIPPED+=("Codex")
    fi
fi

# Auth: Codex (device auth)
if [ "$CODEX_INSTALLED" = true ] && [ "$SKIP_AUTH" = false ]; then
    echo ""
    info "Codex uses device-based auth (opens browser to log in)."
    if confirm "Run 'codex login' now?"; then
        echo ""
        codex login
        if [ $? -eq 0 ]; then
            ok "Authentication successful"
            AUTHENTICATED+=("Codex")
        else
            warn "Auth may have failed — you can run 'codex login' later"
        fi
    else
        info "Run 'codex login' later to authenticate"
    fi
fi

# =========================================================
# 4. Google Gemini
# =========================================================
header "4/4 — Google Gemini (optional)"

GEMINI_INSTALLED=false
if command -v gemini &>/dev/null; then
    GEMINI_VER=$(gemini --version 2>/dev/null | head -1 || echo "installed")
    ok "Gemini CLI (${GEMINI_VER})"
    GEMINI_INSTALLED=true
    INSTALLED+=("Gemini")
else
    info "Gemini CLI is free with a Google account."
    info "API keys available from aistudio.google.com."
    echo ""
    if confirm_optional "Install Google Gemini CLI?"; then
        echo ""
        npm install -g @google/gemini-cli
        if command -v gemini &>/dev/null; then
            GEMINI_VER=$(gemini --version 2>/dev/null | head -1 || echo "installed")
            ok "Gemini CLI (${GEMINI_VER}) installed"
            GEMINI_INSTALLED=true
            INSTALLED+=("Gemini")
        else
            fail "Installation failed"
            info "Try manually: npm install -g @google/gemini-cli"
            FAILED+=("Gemini")
        fi
    else
        info "Skipped"
        SKIPPED+=("Gemini")
    fi
fi

# Auth: Gemini (API key or browser)
if [ "$GEMINI_INSTALLED" = true ] && [ "$SKIP_AUTH" = false ]; then
    echo ""
    info "Gemini authenticates via Google account (browser) or API key."
    info "Run 'gemini' once to complete browser-based login, or set GEMINI_API_KEY."

    EXISTING_KEY=$(read_env_var "GEMINI_API_KEY")
    if [ -n "$EXISTING_KEY" ]; then
        ok "GEMINI_API_KEY already set in .env"
        AUTHENTICATED+=("Gemini")
    elif [ -n "$GEMINI_API_KEY" ]; then
        ok "GEMINI_API_KEY set in environment"
        AUTHENTICATED+=("Gemini")
    else
        if confirm "Enter a Gemini API key now?"; then
            ask "API key (AIza...): "
            read -r gemini_key
            if [[ "$gemini_key" =~ ^AIza ]]; then
                write_env_var "GEMINI_API_KEY" "$gemini_key"
                ok "GEMINI_API_KEY saved to .env"
                AUTHENTICATED+=("Gemini")
            else
                warn "Key doesn't start with 'AIza' — saved anyway"
                write_env_var "GEMINI_API_KEY" "$gemini_key"
                info "You can update it later in .env"
            fi
        else
            info "You can set GEMINI_API_KEY in .env or run 'gemini' for browser auth"
        fi
    fi
fi

# =========================================================
# Update .env with installed backends
# =========================================================
header "Updating .env"

update_enabled_backends
ENABLED=$(read_env_var "ENABLED_BACKENDS")
DEFAULT=$(read_env_var "DEFAULT_BACKEND")

if [ -n "$ENABLED" ]; then
    ok "ENABLED_BACKENDS=${ENABLED}"
fi
if [ -n "$DEFAULT" ]; then
    ok "DEFAULT_BACKEND=${DEFAULT}"
fi

# =========================================================
# Summary
# =========================================================
header "Summary"

echo -e "  ${BOLD}Installed:${NC}"
if [ ${#INSTALLED[@]} -gt 0 ]; then
    for item in "${INSTALLED[@]}"; do
        ok "$item"
    done
else
    fail "No backends installed"
fi

if [ ${#AUTHENTICATED[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${BOLD}Authenticated:${NC}"
    for item in "${AUTHENTICATED[@]}"; do
        ok "$item"
    done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${BOLD}Skipped:${NC}"
    for item in "${SKIPPED[@]}"; do
        warn "$item"
    done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${BOLD}Failed:${NC}"
    for item in "${FAILED[@]}"; do
        fail "$item"
    done
fi

echo ""

# Final status
TOTAL_INSTALLED=${#INSTALLED[@]}
if [ "$TOTAL_INSTALLED" -eq 0 ]; then
    fail "No backends available. Install at least one to use multi-bark-pack."
    exit 1
fi

echo -e "  ${GREEN}${BOLD}${TOTAL_INSTALLED} backend(s) ready!${NC}"
echo ""
echo -e "  Next steps:"
echo ""
if [ ! -f "$ROOT_DIR/.env" ] || ! grep -q "TELEGRAM_TOKEN\|WA_ENABLED=true\|SLACK_BOT_TOKEN" "$ROOT_DIR/.env" 2>/dev/null; then
    echo -e "    1. Configure a chat platform:"
    echo -e "       ${BOLD}./scripts/setup.sh${NC}"
    echo ""
    echo -e "    2. Start the server:"
    echo -e "       ${BOLD}yarn start${NC}"
else
    echo -e "    Start the server:"
    echo -e "       ${BOLD}yarn start${NC}"
fi
echo ""
