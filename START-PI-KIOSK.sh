#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — 1-Click Master Kiosk Launcher for Raspberry Pi
# ==============================================================================
# Usage:
#   1. Double-click "SafeSpeak Phone Booth" on the Raspberry Pi Desktop
#   2. Or in terminal: ./START-PI-KIOSK.sh [optional_laptop_ip]
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================================="
echo "🍓 SafeSpeak Phone Booth — 1-Click Raspberry Pi Kiosk Launcher"
echo "======================================================================="

# 1. Install desktop shortcut on Pi desktop if missing
if [ -d "$HOME/Desktop" ] && [ ! -f "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop" ]; then
    cat << 'EOF' > "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth
Comment=SafeSpeak Dual-Station Kiosk Terminal
Exec=/bin/bash -c "cd $HOME/SafeSpeak_REPORTING_FINAL && ./START-PI-KIOSK.sh"
Icon=phone
Terminal=false
Categories=Utility;Education;
StartupNotify=false
EOF
    chmod +x "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop" 2>/dev/null || true
    echo "✅ Created single-click shortcut on Raspberry Pi Desktop!"
fi

# 2. Wait for display server if launched on system boot
for i in {1..15}; do
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
        break
    fi
    sleep 1
done

# 3. Touchscreen & screen-awake settings (disable screen blanking)
if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null || true
fi

# 4. Auto-discover Laptop Address (Station B)
LAPTOP_IP=""

# Priority 1: User argument passed to script
if [ -n "$1" ]; then
    LAPTOP_IP="$1"
# Priority 2: Saved laptop_ip.txt file if present
elif [ -f "$DIR/laptop_ip.txt" ]; then
    LAPTOP_IP="$(head -n 1 "$DIR/laptop_ip.txt" | tr -d '\r\n ')"
fi

# Priority 3: Try resolving mDNS (desktop-5tk1mc6.local)
if [ -z "$LAPTOP_IP" ] || [ "$LAPTOP_IP" = "auto" ]; then
    if ping -c 1 -W 2 desktop-5tk1mc6.local >/dev/null 2>&1; then
        LAPTOP_IP="desktop-5tk1mc6.local"
    elif ping -c 1 -W 2 192.168.1.9 >/dev/null 2>&1; then
        LAPTOP_IP="192.168.1.9"
    else
        LAPTOP_IP="desktop-5tk1mc6.local"
    fi
fi

echo "🔍 Detected Laptop Target: $LAPTOP_IP"
WS_TARGET="ws://${LAPTOP_IP}:8765"

# 5. Check if Laptop Web Server is accessible on Port 5173
TARGET_URL=""
if curl -s --connect-timeout 2 "http://${LAPTOP_IP}:5173" >/dev/null 2>&1; then
    echo "✅ Connected to Laptop Web Server at http://${LAPTOP_IP}:5173"
    TARGET_URL="http://${LAPTOP_IP}:5173/#/report?ws=${WS_TARGET}"
else
    # Fallback: Host local pre-compiled dist/ bundle on Pi port 8080
    echo "ℹ️ Laptop web server not on 5173. Starting local Pi web server on port 8080..."
    if ! curl -s http://127.0.0.1:8080 >/dev/null 2>&1; then
        python3 -m http.server 8080 --directory "$DIR/dist" >/dev/null 2>&1 &
        sleep 2
    fi
    TARGET_URL="http://localhost:8080/#/report?ws=${WS_TARGET}"
fi

echo "🔗 Target Kiosk URL: $TARGET_URL"
echo "🚀 Launching Fullscreen Chromium Kiosk..."

# 6. Open Hardware-Accelerated Chromium in Locked Kiosk Mode
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
    "$TARGET_URL"
