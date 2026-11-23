#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth — Configure 1-Tap Desktop Launcher & Boot Autostart
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_USER="${SUDO_USER:-$USER}"
HOME_DIR="$(eval echo "~$CURRENT_USER")"

echo "=========================================================="
echo "🛡️  SafeSpeak Phone Booth — Setting Up 1-Tap Launcher & Autostart"
echo "=========================================================="
echo "Directory:    $DIR"
echo "User:         $CURRENT_USER"
echo "Home:         $HOME_DIR"
echo ""

# Ensure executable permissions on all launcher scripts
chmod +x "$DIR/LAUNCH-PI.sh" 2>/dev/null || true
chmod +x "$DIR/scripts/"*.sh 2>/dev/null || true

# 1. Create 1-Tap Launcher in Home folder (~/launch-safespeak.sh)
HOME_LAUNCHER="$HOME_DIR/launch-safespeak.sh"
cat << EOF > "$HOME_LAUNCHER"
#!/usr/bin/env bash
cd "$DIR"
exec ./LAUNCH-PI.sh
EOF
chmod +x "$HOME_LAUNCHER"
chown "$CURRENT_USER:$CURRENT_USER" "$HOME_LAUNCHER" 2>/dev/null || true
echo "✅ 1. Created 1-Tap Launcher in Home: $HOME_LAUNCHER"

# 2. Find icon
ICON_PATH="$DIR/dist/assets/safespeak-logo-CVCc7JbI.png"
if [ ! -f "$ICON_PATH" ]; then
    ICON_PATH="$DIR/dist/favicon.png"
fi

# 3. Create Desktop Shortcut (~/Desktop/SafeSpeak.desktop)
DESKTOP_DIR="$HOME_DIR/Desktop"
mkdir -p "$DESKTOP_DIR"

cat << EOF > "$DESKTOP_DIR/SafeSpeak.desktop"
[Desktop Entry]
Version=1.0
Type=Application
Name=SafeSpeak Phone Booth
Comment=Dedicated School Safety Assistive AI Phone Booth
Exec=$DIR/LAUNCH-PI.sh
Icon=$ICON_PATH
Path=$DIR
Terminal=false
StartupNotify=true
Categories=Utility;Education;
EOF

chmod +x "$DESKTOP_DIR/SafeSpeak.desktop"
chown "$CURRENT_USER:$CURRENT_USER" "$DESKTOP_DIR/SafeSpeak.desktop" 2>/dev/null || true
echo "✅ 2. Created 1-Tap Desktop Icon: $DESKTOP_DIR/SafeSpeak.desktop"

# 4. Create Boot Autostart (~/.config/autostart/safespeak.desktop)
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat << EOF > "$AUTOSTART_DIR/safespeak.desktop"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth Kiosk
Comment=Autostart SafeSpeak on boot
Exec=$DIR/LAUNCH-PI.sh
Path=$DIR
Terminal=false
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

chmod +x "$AUTOSTART_DIR/safespeak.desktop"
chown "$CURRENT_USER:$CURRENT_USER" "$AUTOSTART_DIR/safespeak.desktop" 2>/dev/null || true
echo "✅ 3. Configured Auto-Launch on Boot: $AUTOSTART_DIR/safespeak.desktop"

# 5. Optional Wayfire / Wayland Support for Raspberry Pi OS Bookworm
WAYFIRE_INI="$HOME_DIR/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
    if ! grep -q "safespeak" "$WAYFIRE_INI"; then
        printf "\n[autostart]\nsafespeak = %s/LAUNCH-PI.sh\n" "$DIR" >> "$WAYFIRE_INI"
        echo "✅ 4. Configured Wayland/Wayfire Autostart: $WAYFIRE_INI"
    fi
fi

# 6. Optional Labwc Autostart for Raspberry Pi OS Bookworm (Labwc)
LABWC_AUTOSTART="$HOME_DIR/.config/labwc/autostart"
if [ -d "$HOME_DIR/.config/labwc" ]; then
    if ! grep -q "LAUNCH-PI.sh" "$LABWC_AUTOSTART" 2>/dev/null; then
        echo "$DIR/LAUNCH-PI.sh &" >> "$LABWC_AUTOSTART"
        chmod +x "$LABWC_AUTOSTART"
        echo "✅ 5. Configured Labwc Autostart: $LABWC_AUTOSTART"
    fi
fi

echo ""
echo "=========================================================="
echo "🎉 Setup Complete! SafeSpeak will now automatically"
echo "   open on boot, and you have a 1-tap Desktop icon!"
echo "=========================================================="
