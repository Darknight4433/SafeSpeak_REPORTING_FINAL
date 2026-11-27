#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — Install 1-Click Desktop Icon on Raspberry Pi
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================================="
echo "🍓 Setting up SafeSpeak 1-Click Desktop Icon..."
echo "======================================================================="

# Ensure all scripts have execute permissions
chmod +x "$DIR"/*.sh 2>/dev/null || true

# Target user desktop
DESKTOP_DIR="$HOME/Desktop"
mkdir -p "$DESKTOP_DIR"

SHORTCUT_FILE="$DESKTOP_DIR/SafeSpeak-Phone-Booth.desktop"

cat << EOF > "$SHORTCUT_FILE"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth
Comment=Launch SafeSpeak Child Safeguarding Phone Booth
Exec=/bin/bash "$DIR/START-PI-KIOSK.sh"
Path=$DIR
Icon=phone
Terminal=true
Categories=Utility;Education;
StartupNotify=false
EOF

# Grant execution and trust metadata (for Raspberry Pi OS Bookworm & Bullseye)
chmod +x "$SHORTCUT_FILE"
chmod +x "$DIR/START-PI-KIOSK.sh"
gio set "$SHORTCUT_FILE" metadata::trusted true 2>/dev/null || true

echo ""
echo "======================================================================="
echo "✅ SafeSpeak Phone Booth icon is now installed on your Desktop!"
echo "   Location: $SHORTCUT_FILE"
echo "   Target:   $DIR/START-PI-KIOSK.sh"
echo "======================================================================="
echo "You can now double-click 'SafeSpeak Phone Booth' on your Desktop!"
echo ""
