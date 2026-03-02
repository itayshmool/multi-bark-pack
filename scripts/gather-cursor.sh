#!/bin/bash
# gather-cursor.sh — Run this on the Mac where Cursor CLI works
# Collects ONLY auth tokens and small config files (<1MB each)
set -euo pipefail

TARBALL="/tmp/cursor-auth.tar.gz"
OUT_DIR="/tmp/cursor-auth-export"

echo "🔍 Gathering Cursor auth data (lightweight only)..."
echo ""

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# 1. ~/.cursor/ — only small config files, skip projects/extensions/ai-tracking
if [ -d "$HOME/.cursor" ]; then
    mkdir -p "$OUT_DIR/dot-cursor"
    find "$HOME/.cursor" -maxdepth 1 -type f -size -1M -exec cp {} "$OUT_DIR/dot-cursor/" \; 2>/dev/null
    echo "✓ ~/.cursor/ config files"
fi

# 2. ~/.cursor-agent/ — agent CLI specific auth/config
if [ -d "$HOME/.cursor-agent" ]; then
    mkdir -p "$OUT_DIR/dot-cursor-agent"
    cp -R "$HOME/.cursor-agent/" "$OUT_DIR/dot-cursor-agent/" 2>/dev/null || true
    echo "✓ ~/.cursor-agent/"
fi

# 3. App Support — only auth-related files, no databases or caches
APP_SUPPORT="$HOME/Library/Application Support/Cursor"
if [ -d "$APP_SUPPORT" ]; then
    mkdir -p "$OUT_DIR/app-support"
    # Auth tokens and small config
    for f in storage.json AuthToken token cookies machineid; do
        [ -f "$APP_SUPPORT/$f" ] && cp "$APP_SUPPORT/$f" "$OUT_DIR/app-support/" && echo "  → $f"
    done
    # User settings (json only)
    if [ -d "$APP_SUPPORT/User" ]; then
        mkdir -p "$OUT_DIR/app-support/User"
        for f in settings.json keybindings.json; do
            [ -f "$APP_SUPPORT/User/$f" ] && cp "$APP_SUPPORT/User/$f" "$OUT_DIR/app-support/User/" && echo "  → User/$f"
        done
    fi
fi

# 4. Keychain tokens
echo ""
echo "🔑 Keychain..."
mkdir -p "$OUT_DIR/keychain"
for svc in cursor Cursor cursor-agent cursor.com cursor-auth api.cursor.com; do
    security find-generic-password -s "$svc" -g 2>"$OUT_DIR/keychain/$svc.txt" 2>/dev/null && echo "  → $svc" || true
done
# Remove empty files
find "$OUT_DIR/keychain" -empty -delete 2>/dev/null

# 5. Binary version info
mkdir -p "$OUT_DIR/info"
cursor-agent --version > "$OUT_DIR/info/version.txt" 2>/dev/null || echo "unknown" > "$OUT_DIR/info/version.txt"
uname -a > "$OUT_DIR/info/uname.txt" 2>/dev/null
CURSOR_NODE="$(dirname "$(realpath "$(which cursor-agent 2>/dev/null || echo /dev/null)" 2>/dev/null || echo /dev/null)")/node"
[ -x "$CURSOR_NODE" ] && "$CURSOR_NODE" --version > "$OUT_DIR/info/node-version.txt" 2>/dev/null

# Create tarball
echo ""
echo "📦 Creating tarball..."
tar -czf "$TARBALL" -C /tmp cursor-auth-export
rm -rf "$OUT_DIR"

SIZE="$(du -h "$TARBALL" | cut -f1)"
echo ""
echo "✅ Done! $TARBALL ($SIZE)"
echo ""
echo "Transfer:  scp $TARBALL user@other-mac:/tmp/"
echo "Restore:   ./scripts/restore-cursor.sh /tmp/cursor-auth.tar.gz"
