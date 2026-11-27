#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — 1-Click Master Kiosk Launcher (Optimized for Pi 3)
# ==============================================================================
# Specially optimized for Raspberry Pi 3 (1GB RAM):
#   - Prevents /dev/shm shared memory crashes (--disable-dev-shm-usage)
#   - Caps disk & media caches to prevent OOM memory exhaustion
#   - Disables extensions, sync, and screen-saver sleep
#   - Auto-discovers Station B (Laptop with RTX 3050)
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================================="
echo "🍓 SafeSpeak Phone Booth — Raspberry Pi 3 Kiosk Launcher"
echo "======================================================================="

# 1. Install/Update single-click desktop shortcut on Pi desktop
if [ -d "$HOME/Desktop" ]; then
    cat << EOF > "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth
Comment=SafeSpeak Dual-Station Kiosk Terminal
Exec=/bin/bash "$DIR/START-PI-KIOSK.sh"
Path=$DIR
Icon=phone
Terminal=true
Categories=Utility;Education;
StartupNotify=false
EOF
    chmod +x "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop" 2>/dev/null || true
    gio set "$HOME/Desktop/SafeSpeak-Phone-Booth.desktop" metadata::trusted true 2>/dev/null || true
fi

# 2. Kill any old hung Chromium or node processes to free 1GB RAM on Pi 3
killall -9 chromium-browser chromium npm node 2>/dev/null || true

# 3. Wait for display server if launched on system boot
for i in {1..15}; do
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
        break
    fi
    sleep 1
done

# 4. Touchscreen & screen-awake settings (disable screen sleep/blanking)
if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null || true
fi

# 5. Auto-discover Laptop Address (Station B)
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

# 6. Check if Laptop Web Server is accessible on Port 5173
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
echo "🚀 Launching Hardware-Accelerated Lightweight Chromium (Pi 3 Mode)..."

# 7. Open Chromium with Pi 3 (1GB RAM) memory optimizations
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
    --disable-dev-shm-usage \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --no-first-run \
    --disk-cache-size=10485760 \
    --media-cache-size=10485760 \
    "$TARGET_URL"
