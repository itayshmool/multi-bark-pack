#!/bin/bash
# restore-cursor.sh — Run this on the Mac where Cursor CLI is broken
# Restores auth/config from the tarball gathered on the working Mac
set -euo pipefail

TARBALL="${1:-/tmp/cursor-auth.tar.gz}"

if [ ! -f "$TARBALL" ]; then
    echo "❌ Tarball not found: $TARBALL"
    echo "Usage: ./scripts/restore-cursor.sh /path/to/cursor-auth.tar.gz"
    exit 1
fi

echo "🔧 Restoring Cursor auth data..."
echo ""

EXTRACT_DIR="/tmp/cursor-auth-export"
rm -rf "$EXTRACT_DIR"
tar -xzf "$TARBALL" -C /tmp

# 1. Restore ~/.cursor/ config files
if [ -d "$EXTRACT_DIR/dot-cursor" ]; then
    mkdir -p "$HOME/.cursor"
    cp -n "$EXTRACT_DIR/dot-cursor/"* "$HOME/.cursor/" 2>/dev/null || true
    echo "✓ ~/.cursor/ config files"
fi

# 2. Restore ~/.cursor-agent/
if [ -d "$EXTRACT_DIR/dot-cursor-agent" ]; then
    mkdir -p "$HOME/.cursor-agent"
    cp -R "$EXTRACT_DIR/dot-cursor-agent/"* "$HOME/.cursor-agent/" 2>/dev/null || true
    echo "✓ ~/.cursor-agent/"
fi

# 3. Restore App Support auth files
APP_SUPPORT="$HOME/Library/Application Support/Cursor"
if [ -d "$EXTRACT_DIR/app-support" ]; then
    mkdir -p "$APP_SUPPORT"
    for f in "$EXTRACT_DIR/app-support/"*; do
        name="$(basename "$f")"
        if [ -d "$f" ]; then
            mkdir -p "$APP_SUPPORT/$name"
            cp -R "$f/"* "$APP_SUPPORT/$name/" 2>/dev/null || true
        else
            cp "$f" "$APP_SUPPORT/$name" 2>/dev/null || true
        fi
        echo "  → $name"
    done
fi

# 4. Show keychain info
if [ -d "$EXTRACT_DIR/keychain" ] && [ "$(ls -A "$EXTRACT_DIR/keychain" 2>/dev/null)" ]; then
    echo ""
    echo "🔑 Keychain entries from source Mac:"
    for f in "$EXTRACT_DIR/keychain/"*.txt; do
        [ -f "$f" ] && echo "  → $(basename "$f" .txt)" && head -3 "$f"
    done
    echo "⚠️  Keychain items must be added manually if auth still fails."
fi

# 5. Show source info
if [ -d "$EXTRACT_DIR/info" ]; then
    echo ""
    echo "📦 Source Mac:"
    cat "$EXTRACT_DIR/info/version.txt" 2>/dev/null || true
    cat "$EXTRACT_DIR/info/node-version.txt" 2>/dev/null || true
fi

rm -rf "$EXTRACT_DIR"

echo ""
echo "✅ Done. Test with: cursor-agent --version"
