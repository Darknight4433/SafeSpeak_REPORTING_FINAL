#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth - Raspberry Pi 4 / 5 Build & Preparation Script
# ==============================================================================
# Prepares the Raspberry Pi environment for the SafeSpeak Phone Booth kiosk:
# - Validates system dependencies (Node.js, ALSA, PulseAudio/PipeWire, GTK3)
# - Verifies audio devices (handset mic and speaker)
# - Installs npm dependencies and compiles production assets
# - Builds native ARM64 or ARMv7 Linux package
# - Generates kiosk auto-start configuration
#
# Usage:
#   chmod +x ./scripts/build_pi.sh
#   ./scripts/build_pi.sh          # Auto-detects architecture (arm64 / armv7)
#   ./scripts/build_pi.sh arm64    # Force 64-bit build
#   ./scripts/build_pi.sh armv7    # Force 32-bit build
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "======================================================================="
echo "🍓 SafeSpeak Phone Booth — Raspberry Pi Preparation & Build"
echo "======================================================================="

# 1. Architecture Detection
ARCH_INPUT="${1:-}"
SYS_ARCH="$(uname -m)"

if [ -n "$ARCH_INPUT" ]; then
    TARGET_ARCH="$ARCH_INPUT"
elif [[ "$SYS_ARCH" == "aarch64" || "$SYS_ARCH" == "arm64" ]]; then
    TARGET_ARCH="arm64"
elif [[ "$SYS_ARCH" == "armv7"* || "$SYS_ARCH" == "armhf" ]]; then
    TARGET_ARCH="armv7"
else
    echo "ℹ️  Non-ARM system detected ($SYS_ARCH). Defaulting target to arm64."
    TARGET_ARCH="arm64"
fi

echo "📋 Target Architecture: $TARGET_ARCH (System Arch: $SYS_ARCH)"

# 2. Check Node.js & npm
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js is not installed!"
    echo "   Please install Node.js 18+ or 20+ via NodeSource:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "   sudo apt install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js detected: $NODE_VERSION"

# 3. Check essential system libraries for Electron on Raspberry Pi OS
MISSING_PKGS=()
for pkg in libasound2 libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 speech-dispatcher; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING_PKGS+=("$pkg")
    fi
done

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    echo "⚠️  Missing recommended system packages: ${MISSING_PKGS[*]}"
    echo "   Install them with: sudo apt update && sudo apt install -y ${MISSING_PKGS[*]}"
else
    echo "✅ Core graphical and audio system libraries are present."
fi

# 4. Check Audio Input & Output
echo -e "\n🎤 Checking audio devices for telephone handset..."
if command -v arecord >/dev/null 2>&1; then
    CAPTURE_DEVS=$(arecord -l 2>/dev/null | grep -c "card" || true)
    PLAYBACK_DEVS=$(aplay -l 2>/dev/null | grep -c "card" || true)
    echo "   - Input capture devices found: $CAPTURE_DEVS"
    echo "   - Output playback devices found: $PLAYBACK_DEVS"
    if [ "$CAPTURE_DEVS" -eq 0 ]; then
        echo "   ⚠️  No microphone detected. Connect your USB telephone handset or audio HAT."
    else
        echo "   ✅ Microphone detected."
    fi
fi

# 5. Clean stale caches & build artifacts
echo -e "\n🧹 Cleaning stale caches..."
rm -rf dist dist_electron/linux-unpacked .vite

# 6. Install Node Modules
echo -e "\n📦 Installing project dependencies..."
npm install --no-audit --no-fund

# 7. Compile Production Web Bundle
echo -e "\n🔨 Compiling production web bundle (Vite)..."
npm run build

# 8. Package for Raspberry Pi (Native Electron App)
echo -e "\n📦 Packaging native Linux application for $TARGET_ARCH..."
if [ "$TARGET_ARCH" == "arm64" ]; then
    npm run dist:linux-arm64
else
    npm run dist:linux-armv7
fi

# 9. Autostart Desktop Entry Generator
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DIR/safespeak-phone-booth.desktop"

mkdir -p "$AUTOSTART_DIR"
cat << EOF > "$DESKTOP_FILE"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth Kiosk
Comment=Dedicated School Safety Voice Booth
Exec=/usr/bin/bash -c "cd $DIR && ./scripts/start-linux.sh --kiosk"
Terminal=false
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

echo -e "\n======================================================================="
echo "🎉 Phase 1 Preparation Complete!"
echo "   - Production web build created in: dist/"
echo "   - Native ARM binary built in: dist_electron/"
echo "   - Autostart entry created at: $DESKTOP_FILE"
echo "   - Run manually anytime: ./scripts/start-linux.sh --kiosk"
echo "======================================================================="
