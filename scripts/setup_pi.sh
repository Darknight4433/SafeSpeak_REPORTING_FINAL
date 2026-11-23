#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth — 1-Click Complete Raspberry Pi OS Setup
# ==============================================================================
# Prepares a fresh Raspberry Pi OS (Pi 4 or Pi 5, 32-bit or 64-bit) for 24/7
# standalone school phone booth kiosk deployment.
#
# Tasks performed:
# 1. System packages (ALSA, GTK3, speech-dispatcher, unclutter, ffmpeg)
# 2. Permissions (adds user to audio, video, input, and gpio groups)
# 3. Disables screen sleep, screen saver, and DPMS blanking
# 4. Hides mouse cursor when idle on touchscreen
# 5. Optimizes ALSA audio for USB telephone handset
# 6. Installs Systemd autostart service (auto-launches on Pi power-on)
# 7. Compiles the production web assets and verifies kiosk launcher
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

CURRENT_USER="${SUDO_USER:-$USER}"

echo "======================================================================="
echo "🍓 SafeSpeak Phone Booth — Raspberry Pi OS Automated Configuration"
echo "======================================================================="
echo "   Target directory: $DIR"
echo "   Configuring user: $CURRENT_USER"
echo "======================================================================="

# 1. Update and install prerequisite system packages
echo -e "\n📦 1. Installing required Raspberry Pi packages..."
sudo apt update
sudo apt install -y \
    curl git nodejs npm \
    libasound2 libasound2-plugins libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    speech-dispatcher espeak-ng pulseaudio pulseaudio-utils alsa-utils \
    unclutter x11-xserver-utils ffmpeg python3 python3-pip

# 2. Ensure current user is in necessary hardware groups
echo -e "\n🔑 2. Setting hardware permissions for user '$CURRENT_USER'..."
sudo usermod -aG audio,video,input,dialout "$CURRENT_USER" || true
if grep -q "gpio" /etc/group; then
    sudo usermod -aG gpio "$CURRENT_USER" || true
fi

# 3. Disable Screen Blanking / Sleep for 24/7 Kiosk Operation
echo -e "\n🖥️  3. Disabling screen blanking and power-saving sleep..."
# For X11 / Raspberry Pi OS Desktop
AUTOSTART_DIR="/home/$CURRENT_USER/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

# Screensaver inhibitor script
SCREEN_CFG="/home/$CURRENT_USER/.xsessionrc"
cat << 'EOF' > "$SCREEN_CFG"
# SafeSpeak Kiosk: Disable Screen Sleep & Power Management
xset s off
xset -dpms
xset s noblank
# Hide cursor after 1 second of touchscreen inactivity
unclutter -idle 1 -root &
EOF
chmod +x "$SCREEN_CFG"
chown "$CURRENT_USER:$CURRENT_USER" "$SCREEN_CFG"

# For Wayland / Wayfire on Pi OS Bookworm
WAYFIRE_INI="/home/$CURRENT_USER/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
    echo "Configuring Wayland idle inhibitor..."
    sed -i 's/screensaver_timeout = .*/screensaver_timeout = 0/' "$WAYFIRE_INI" || true
fi

# 4. Audio Configuration (ALSA & USB Telephone Handset)
echo -e "\n📞 4. Configuring audio handset and mixer levels..."
# Unmute and set capture/playback channels to 85%
amixer set Master 85% unmute 2>/dev/null || true
amixer set Speaker 85% unmute 2>/dev/null || true
amixer set PCM 85% unmute 2>/dev/null || true
amixer set Capture 85% unmute 2>/dev/null || true
amixer set Mic 85% unmute 2>/dev/null || true

# 5. Build Production Client Bundle
echo -e "\n🔨 5. Compiling SafeSpeak production web bundle..."
npm install --no-audit --no-fund
npm run build

# 6. Configure Autostart (Systemd Kiosk Service & Desktop Autostart)
echo -e "\n🚀 6. Configuring automated startup on boot..."

# Desktop Autostart File
DESKTOP_ENTRY="$AUTOSTART_DIR/safespeak-phone-booth.desktop"
cat << EOF > "$DESKTOP_ENTRY"
[Desktop Entry]
Type=Application
Name=SafeSpeak Phone Booth Kiosk
Comment=Dedicated School Safety Voice Booth
Exec=/usr/bin/bash -c "cd $DIR && ./scripts/start-booth-pi.sh"
Terminal=false
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF
chown "$CURRENT_USER:$CURRENT_USER" "$DESKTOP_ENTRY"

# Systemd User Unit (Fallback Watchdog)
SYSTEMD_USER_DIR="/home/$CURRENT_USER/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"
SERVICE_FILE="$SYSTEMD_USER_DIR/safespeak-kiosk.service"

cat << EOF > "$SERVICE_FILE"
[Unit]
Description=SafeSpeak Phone Booth Kiosk Service
After=graphical.target sound.target network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=/usr/bin/bash $DIR/scripts/start-booth-pi.sh
Restart=always
RestartSec=5
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$CURRENT_USER/.Xauthority
Environment=SAFESPEAK_KIOSK=1

[Install]
WantedBy=default.target
EOF
chown -R "$CURRENT_USER:$CURRENT_USER" "/home/$CURRENT_USER/.config/systemd"

echo -e "\n======================================================================="
echo "🎉 Raspberry Pi OS Configuration Complete!"
echo "======================================================================="
echo "   - Hardware groups: audio, video, input configured"
echo "   - Screen blanking & sleep: Disabled for 24/7 kiosk operation"
echo "   - Mouse cursor: Set to hide on touchscreen idle"
echo "   - Autostart installed at: $DESKTOP_ENTRY"
echo "   - Audio test tool: ./scripts/check_pi_audio.sh"
echo "   - Start Phone Booth now: ./scripts/start-booth-pi.sh"
echo "======================================================================="
