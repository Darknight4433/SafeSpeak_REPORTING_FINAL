#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth — Dedicated Raspberry Pi Kiosk Launcher
# ==============================================================================
# Launches SafeSpeak in locked fullscreen kiosk mode with touchscreen optimizations,
# audio permissions, and auto-recovery.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Wait briefly on boot for display server and audio to initialize
sleep 2

echo "=========================================================="
echo "🛡️  SafeSpeak Phone Booth — Launching Kiosk Terminal (Pi)"
echo "=========================================================="

# 1. Verify build exists
if [ ! -d "dist" ]; then
    echo "📦 Building production web bundle..."
    npm run build
fi

# 2. Touchscreen & Power Management Safeguards
if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null || true
fi

# 3. Launch Electron with Raspberry Pi Touch & Audio Optimization Flags
export SAFESPEAK_KIOSK=1
export ELECTRON_ENABLE_LOGGING=1

npx electron . \
    --kiosk \
    --no-sandbox \
    --touch-events=enabled \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --enable-speech-dispatcher \
    --ignore-gpu-blocklist \
    --disable-features=Translate,InterestFeedContentSuggestions
