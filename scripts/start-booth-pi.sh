#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth — Dedicated Raspberry Pi Kiosk Launcher
# ==============================================================================
# Launches SafeSpeak in locked fullscreen kiosk mode with touchscreen optimizations,
# audio permissions, and auto-recovery.
# Supports both Electron Kiosk and Native Raspberry Pi Chromium Kiosk.
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Wait briefly on boot for display server and audio to initialize
sleep 2

echo "=========================================================="
echo "🛡️  SafeSpeak Phone Booth — Launching Kiosk Terminal (Pi)"
echo "=========================================================="

# 1. Verify build exists
if [ ! -f "dist/index.html" ]; then
    echo "📦 Building production web bundle..."
    npm run build 2>/dev/null || true
fi

# 2. Touchscreen & Power Management Safeguards
if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null || true
fi

# 3. Start local web server in background if not already running on port 8080
if ! curl -s http://127.0.0.1:8080 >/dev/null 2>&1; then
    echo "🌐 Starting SafeSpeak local kiosk server on port 8080..."
    if command -v python3 >/dev/null 2>&1; then
        python3 -m http.server 8080 --directory "$DIR/dist" >/dev/null 2>&1 &
    elif command -v npx >/dev/null 2>&1; then
        npx serve -s dist -l 8080 >/dev/null 2>&1 &
    fi
    sleep 2
fi

# 4. Launch Electron if available, or seamlessly fallback to Pi Chromium Kiosk
export SAFESPEAK_KIOSK=1
export ELECTRON_ENABLE_LOGGING=1

if command -v npx >/dev/null 2>&1 && [ -d "node_modules/electron" ]; then
    echo "🚀 Launching via Electron Kiosk..."
    npx electron . \
        --kiosk \
        --no-sandbox \
        --touch-events=enabled \
        --disable-pinch \
        --overscroll-history-navigation=0 \
        --autoplay-policy=no-user-gesture-required \
        --enable-speech-dispatcher \
        --ignore-gpu-blocklist \
        --disable-features=Translate,InterestFeedContentSuggestions || true
else
    echo "🚀 Launching via Raspberry Pi Hardware-Accelerated Chromium Kiosk..."
    BROWSER_CMD="chromium-browser"
    if ! command -v chromium-browser >/dev/null 2>&1; then
        BROWSER_CMD="chromium"
    fi
    $BROWSER_CMD \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --check-for-update-interval=31536000 \
        --autoplay-policy=no-user-gesture-required \
        --use-fake-ui-for-media-stream \
        --touch-events=enabled \
        --disable-pinch \
        --overscroll-history-navigation=0 \
        --enable-speech-dispatcher \
        "http://localhost:8080"
fi
