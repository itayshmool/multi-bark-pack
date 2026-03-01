#!/bin/bash
# multi-bark-pack prerequisites installer — Wix edition
# Switches to Wix internal npm registry before yarn install.
# Usage: ./scripts/prerequisites-wix.sh [--yes]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export WIX_MODE=true
source "$SCRIPT_DIR/prerequisites.sh"
