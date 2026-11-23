#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth — Instant 0-Second Launcher for Raspberry Pi
# ==============================================================================
# No npm install needed! Uses pre-compiled dist/ with Raspberry Pi Chromium Kiosk.
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================================="
echo "🛡️  SafeSpeak Phone Booth — Instant Raspberry Pi Launcher"
echo "=========================================================="

# 1. Wait for display server if launched on system boot
for i in {1..15}; do
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
        break
    fi
    sleep 1
done

# 2. Kill any hung npm/node processes from earlier
killall -9 npm node 2>/dev/null || true

# 3. Touchscreen & screen-awake settings
if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null || true
fi

# 3. Start lightweight Python web server on port 8080
if ! curl -s http://127.0.0.1:8080 >/dev/null 2>&1; then
    echo "🌐 Starting SafeSpeak server on port 8080..."
    python3 -m http.server 8080 --directory "$DIR/dist" >/dev/null 2>&1 &
    sleep 2
fi

# 4. Open hardware-accelerated Chromium in Kiosk mode
LAPTOP_TARGET="${1:-192.168.10.39}"
if [[ "$LAPTOP_TARGET" =~ ^ws:// ]] || [[ "$LAPTOP_TARGET" =~ ^wss:// ]]; then
    WS_TARGET="$LAPTOP_TARGET"
else
    WS_TARGET="ws://${LAPTOP_TARGET}:8765"
fi

echo "🔗 Connecting to SafeSpeak AI Server at: $WS_TARGET"
echo "🚀 Opening SafeSpeak Phone Booth..."
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
    "http://localhost:8080/#/?ws=${WS_TARGET}"
