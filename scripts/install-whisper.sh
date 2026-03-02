#!/usr/bin/env bash
# install-whisper.sh — Install ffmpeg + whisper.cpp + multilingual model
# Supports Hebrew, English, and 90+ languages with auto-detection
# 100% local transcription — no cloud API, no cost

set -euo pipefail

MODEL_DIR="/opt/homebrew/share/whisper-cpp/models"
MODEL_FILE="ggml-base.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}"

echo "=== Whisper Voice Transcription Installer ==="
echo ""

# --- Check Homebrew ---
if ! command -v brew &>/dev/null; then
    echo "  Homebrew is required but not installed."
    echo "  Install it from https://brew.sh"
    exit 1
fi

# --- Install ffmpeg ---
if command -v ffmpeg &>/dev/null; then
    echo "  ffmpeg ........... $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
else
    echo "  Installing ffmpeg..."
    brew install ffmpeg
    echo "  ffmpeg ........... installed"
fi

# --- Install whisper-cpp ---
if command -v whisper-cli &>/dev/null; then
    echo "  whisper-cli ...... $(brew list --versions whisper-cpp 2>/dev/null | awk '{print $2}' || echo 'installed')"
else
    echo "  Installing whisper-cpp..."
    brew install whisper-cpp
    echo "  whisper-cli ...... installed"
fi

# --- Download multilingual model ---
if [ -f "${MODEL_DIR}/${MODEL_FILE}" ]; then
    SIZE=$(du -h "${MODEL_DIR}/${MODEL_FILE}" | awk '{print $1}')
    echo "  Model ............ ${MODEL_FILE} (${SIZE})"
else
    echo "  Downloading multilingual model (${MODEL_FILE}, ~142MB)..."
    mkdir -p "${MODEL_DIR}"
    curl -L -o "${MODEL_DIR}/${MODEL_FILE}" "${MODEL_URL}"
    SIZE=$(du -h "${MODEL_DIR}/${MODEL_FILE}" | awk '{print $1}')
    echo "  Model ............ ${MODEL_FILE} (${SIZE})"
fi

# --- Remove old English-only model if multilingual is present ---
OLD_MODEL="${MODEL_DIR}/ggml-base.en.bin"
if [ -f "${OLD_MODEL}" ] && [ -f "${MODEL_DIR}/${MODEL_FILE}" ]; then
    echo "  Removing old English-only model (ggml-base.en.bin)..."
    rm -f "${OLD_MODEL}"
fi

# --- Quick test ---
echo ""
echo "  Running quick test..."
TEST_WAV=$(mktemp /tmp/whisper-test-XXXXXX.wav)
# Generate 1 second of silence as a minimal WAV
ffmpeg -f lavfi -i "anullsrc=r=16000:cl=mono" -t 1 -y "${TEST_WAV}" 2>/dev/null

if whisper-cli -m "${MODEL_DIR}/${MODEL_FILE}" --language auto --no-timestamps "${TEST_WAV}" &>/dev/null; then
    echo "  Test ............. OK"
else
    echo "  Test ............. FAILED (whisper-cli returned an error)"
    rm -f "${TEST_WAV}"
    exit 1
fi
rm -f "${TEST_WAV}"

echo ""
echo "  Voice transcription is ready!"
echo "  Supports: Hebrew, English, and 90+ languages (auto-detected)"
echo "  Model path: ${MODEL_DIR}/${MODEL_FILE}"
echo ""
