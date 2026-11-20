#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Linux Launcher Script
# ==============================================================================
# Starts SafeSpeak desktop application on Linux / Ubuntu / Debian / Raspberry Pi
# Supports kiosk mode, optional offline Vosk STT, and background Ollama AI.
#
# Usage:
#   ./scripts/start-linux.sh            # Standard desktop window
#   ./scripts/start-linux.sh --kiosk    # Fullscreen locked school kiosk mode
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=========================================================="
echo "🛡️  SafeSpeak — Student Voice & Reporting Platform (Linux)"
echo "=========================================================="

# 1. Check if built files exist
if [ ! -d "dist" ]; then
  echo "📦 First run: Building production web bundle..."
  npm run build
fi

# 2. Check if Vosk STT server is desired
if [ -d "stt" ] && command -v python3 >/dev/null 2>&1; then
  if curl -s http://127.0.0.1:5000/status >/dev/null 2>&1; then
    echo "🎤 Vosk STT server is already running on port 5000."
  else
    echo "💡 Note: To enable offline voice transcription on Linux:"
    echo "   run in a separate terminal: npm run stt:dev"
  fi
fi

# 3. Check if Ollama is running
if curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "🦙 Ollama AI is active on http://127.0.0.1:11434"
else
  echo "ℹ️  Ollama is not running. SafeSpeak will use its built-in rule & memory engine."
fi

# 4. Check for kiosk flag
KIOSK_FLAG=""
if [[ "$*" == *"--kiosk"* ]]; then
  echo "🖥️  Starting in Fullscreen Kiosk Mode..."
  KIOSK_FLAG="--kiosk"
fi

# 5. Launch Electron
echo "🚀 Launching SafeSpeak Application..."
export SAFESPEAK_KIOSK=${SAFESPEAK_KIOSK:-0}
npx electron . $KIOSK_FLAG
