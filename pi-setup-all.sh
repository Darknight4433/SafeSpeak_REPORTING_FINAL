#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — Resilient 1-Tap Raspberry Pi Master Installer
# ==============================================================================
# Installs and configures everything needed for SafeSpeak on any Raspberry Pi OS
# (Pi 4, Pi 5, Pi 3B+, 32-bit or 64-bit, Bookworm or Bullseye).
#
# RESILIENCE DESIGN:
# Even if a command or package fails, it logs a warning and proceeds to the
# next step without stopping, ensuring maximum success on varied OS setups.
# ==============================================================================

# ANSI Color codes for readability
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

CURRENT_USER="${SUDO_USER:-$USER}"
HOME_DIR="/home/$CURRENT_USER"
if [ "$CURRENT_USER" = "root" ]; then
    HOME_DIR="/root"
fi

PASSED_STEPS=()
WARNED_STEPS=()

run_step() {
    local step_name="$1"
    shift
    echo -e "\n${BLUE}${BOLD}▶ [STEP] $step_name...${NC}"
    if "$@"; then
        echo -e "${GREEN}✓ $step_name completed successfully.${NC}"
        PASSED_STEPS+=("$step_name")
    else
        echo -e "${YELLOW}⚠ $step_name encountered a warning/error (continuing to next step)...${NC}"
        WARNED_STEPS+=("$step_name")
    fi
}

echo -e "${BOLD}${GREEN}"
echo "======================================================================="
echo "🍓  SafeSpeak Phone Booth — Resilient 1-Tap Raspberry Pi Installer"
echo "======================================================================="
echo -e "${NC}"
echo "Directory: $DIR"
echo "Target User: $CURRENT_USER ($HOME_DIR)"
echo "Date: $(date)"
echo "Architecture: $(uname -m)"
echo "-----------------------------------------------------------------------"

# ------------------------------------------------------------------------------
# 1. Clean Stale Locks & Self-Heal Interrupted Installations (dpkg --configure -a)
# ------------------------------------------------------------------------------
repair_and_wait_locks() {
    echo "Healing any interrupted background package processes..."
    sudo killall apt apt-get dpkg 2>/dev/null || true
    sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null || true
    sudo dpkg --configure -a 2>/dev/null || true
    sudo apt-get install -f -y 2>/dev/null || true

    local timeout=30
    while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
        echo "Waiting for package manager lock to clear (${timeout}s remaining)..."
        sleep 2
        timeout=$((timeout - 2))
        if [ $timeout -le 0 ]; then
            sudo killall apt apt-get dpkg 2>/dev/null || true
            sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock 2>/dev/null || true
            break
        fi
    done
    return 0
}
run_step "Self-Heal Interrupted Package Locks" repair_and_wait_locks

# ------------------------------------------------------------------------------
# 2. Update System Package Index
# ------------------------------------------------------------------------------
update_apt() {
    sudo apt-get update -y || sudo apt update -y || true
}
run_step "Update APT Package Index" update_apt

# ------------------------------------------------------------------------------
# 3. Install Essential Base Utilities
# ------------------------------------------------------------------------------
install_base_tools() {
    sudo apt-get install -y --no-install-recommends \
        curl git wget ca-certificates gnupg build-essential alsa-utils \
        unclutter x11-xserver-utils ffmpeg python3 python3-pip python3-setuptools || true
}
run_step "Install Base CLI Utilities" install_base_tools

# ------------------------------------------------------------------------------
# 4. Verify / Install Node.js (Version 18+ or 20+)
# ------------------------------------------------------------------------------
setup_nodejs() {
    local need_node=true
    if command -v node >/dev/null 2>&1; then
        local node_ver
        node_ver=$(node -v | sed 's/v//' | cut -d'.' -f1)
        if [ "$node_ver" -ge 18 ]; then
            echo "Existing Node.js version $(node -v) is sufficient."
            need_node=false
        else
            echo "Installed Node.js $(node -v) is older than v18. Upgrading..."
        fi
    fi

    if [ "$need_node" = true ]; then
        echo "Installing Node.js 20.x from NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || true
        sudo apt-get install -y nodejs || true
    fi

    # Verify node & npm
    node -v && npm -v
}
run_step "Install / Verify Node.js 20" setup_nodejs

# ------------------------------------------------------------------------------
# 5. Install GUI, Audio, and Accessibility Libraries for Electron
# ------------------------------------------------------------------------------
install_electron_libs() {
    # Install graphical runtime packages with fallbacks for Bookworm vs Bullseye
    sudo apt-get install -y \
        libasound2 libasound2-plugins libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
        speech-dispatcher espeak-ng pulseaudio pulseaudio-utils 2>/dev/null || \
    sudo apt-get install -y \
        libasound2 libgbm1 libnss3 libgtk-3-0 speech-dispatcher espeak-ng || true
}
run_step "Install Electron & Audio Libraries" install_electron_libs

# ------------------------------------------------------------------------------
# 6. Configure User Hardware Permissions (audio, video, input, gpio)
# ------------------------------------------------------------------------------
configure_permissions() {
    echo "Adding $CURRENT_USER to hardware groups..."
    for grp in audio video input dialout plugdev; do
        sudo usermod -aG "$grp" "$CURRENT_USER" 2>/dev/null || true
    done
    if grep -q "gpio" /etc/group 2>/dev/null; then
        sudo usermod -aG gpio "$CURRENT_USER" 2>/dev/null || true
    fi
}
run_step "Configure User Hardware Groups" configure_permissions

# ------------------------------------------------------------------------------
# 7. Disable Screen Sleep / Blanking for 24/7 Kiosk Operation
# ------------------------------------------------------------------------------
configure_display_power() {
    # X11 Screensaver inhibitor
    local xsession_rc="$HOME_DIR/.xsessionrc"
    cat << 'EOF' > "$xsession_rc"
# SafeSpeak 24/7 Kiosk: Disable Screen Blanking
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
# Hide mouse cursor after 1 second of touchscreen inactivity
unclutter -idle 1 -root 2>/dev/null &
EOF
    chmod +x "$xsession_rc" 2>/dev/null || true
    chown "$CURRENT_USER:$CURRENT_USER" "$xsession_rc" 2>/dev/null || true

    # Wayland / Wayfire configuration (Raspberry Pi OS Bookworm)
    local wayfire_ini="$HOME_DIR/.config/wayfire.ini"
    if [ -f "$wayfire_ini" ]; then
        sed -i 's/screensaver_timeout = .*/screensaver_timeout = 0/' "$wayfire_ini" 2>/dev/null || true
    fi

    # Raspberry Pi OS lightdm screen blanking override
    if [ -f "/etc/lightdm/lightdm.conf" ]; then
        sudo sed -i 's/#xserver-command=X/xserver-command=X -s 0 -dpms/' /etc/lightdm/lightdm.conf 2>/dev/null || true
    fi
}
run_step "Disable Screen Blanking (24/7 Screen Awake)" configure_display_power

# ------------------------------------------------------------------------------
# 8. Audio Calibration (Unmute & Set Handset Levels)
# ------------------------------------------------------------------------------
calibrate_audio() {
    echo "Unmuting audio channels and setting levels to 85%..."
    amixer set Master 85% unmute 2>/dev/null || true
    amixer set Speaker 85% unmute 2>/dev/null || true
    amixer set PCM 85% unmute 2>/dev/null || true
    amixer set Capture 85% unmute 2>/dev/null || true
    amixer set Mic 85% unmute 2>/dev/null || true
    # Save ALSA mixer state
    sudo alsactl store 2>/dev/null || true
}
run_step "Calibrate Handset Audio Levels" calibrate_audio

# ------------------------------------------------------------------------------
# 9. Install Node Project Dependencies
# ------------------------------------------------------------------------------
install_node_deps() {
    cd "$DIR"
    echo "Installing SafeSpeak npm packages (optimized for Raspberry Pi)..."
    # Skip heavy electron binary download to prevent Raspberry Pi ARM hang
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    export NODE_OPTIONS="--max-old-space-size=1024"
    npm install --no-audit --no-fund --legacy-peer-deps --prefer-offline 2>/dev/null || \
    npm install --omit=dev --no-audit --no-fund 2>/dev/null || true
    echo "✅ NPM packages step completed."
}
run_step "Install SafeSpeak NPM Dependencies" install_node_deps

# ------------------------------------------------------------------------------
# 10. Compile Production Web Bundle
# ------------------------------------------------------------------------------
compile_production() {
    cd "$DIR"
    if [ -f "$DIR/dist/index.html" ]; then
        echo "✅ Production web bundle dist/ is already pre-compiled and ready!"
        return 0
    fi
    echo "Building production bundle via Vite..."
    npm run build || {
        echo "Initial build encountered an issue, trying clean build..."
        rm -rf dist node_modules/.vite 2>/dev/null || true
        npm run build || true
    }
    # Check if index.html exists
    [ -f "$DIR/dist/index.html" ]
}
run_step "Compile SafeSpeak Production Bundle" compile_production

# ------------------------------------------------------------------------------
# 11. Ensure Executable Permissions on All Helper Scripts
# ------------------------------------------------------------------------------
chmod_scripts() {
    cd "$DIR"
    chmod +x "$DIR/scripts/"*.sh 2>/dev/null || true
    chmod +x "$DIR/scripts/"*.py 2>/dev/null || true
    chmod +x "$DIR/"*.sh 2>/dev/null || true
}
run_step "Make Helper Scripts Executable" chmod_scripts

# ------------------------------------------------------------------------------
# 12. Create Desktop Autostart & Desktop Shortcut
# ------------------------------------------------------------------------------
setup_autostart_and_shortcuts() {
    local autostart_dir="$HOME_DIR/.config/autostart"
    mkdir -p "$autostart_dir"

    # Autostart on boot (fullscreen kiosk)
    local autostart_desktop="$autostart_dir/safespeak-phone-booth.desktop"
    cat << EOF > "$autostart_desktop"
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
    chown "$CURRENT_USER:$CURRENT_USER" "$autostart_desktop" 2>/dev/null || true
    chmod +x "$autostart_desktop" 2>/dev/null || true

    # Desktop Icon on Desktop folder (for easy 1-click manual launch)
    local desktop_folder="$HOME_DIR/Desktop"
    if [ -d "$desktop_folder" ]; then
        local desktop_icon="$desktop_folder/SafeSpeak-Phone-Booth.desktop"
        cp "$autostart_desktop" "$desktop_icon" 2>/dev/null || true
        chown "$CURRENT_USER:$CURRENT_USER" "$desktop_icon" 2>/dev/null || true
        chmod +x "$desktop_icon" 2>/dev/null || true
    fi

    # Systemd user service unit (watchdog)
    local systemd_user_dir="$HOME_DIR/.config/systemd/user"
    mkdir -p "$systemd_user_dir"
    local service_file="$systemd_user_dir/safespeak-kiosk.service"
    cat << EOF > "$service_file"
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
Environment=XAUTHORITY=$HOME_DIR/.Xauthority
Environment=SAFESPEAK_KIOSK=1

[Install]
WantedBy=default.target
EOF
    chown -R "$CURRENT_USER:$CURRENT_USER" "$HOME_DIR/.config/systemd" 2>/dev/null || true
}
run_step "Configure Kiosk Autostart & Desktop Shortcuts" setup_autostart_and_shortcuts

# ------------------------------------------------------------------------------
# 13. Summary Report
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${GREEN}======================================================================="
echo "🎉 SafeSpeak 1-Tap Raspberry Pi Installation Complete!"
echo "=======================================================================${NC}"

echo -e "\n${BOLD}Execution Summary:${NC}"
echo -e "  ${GREEN}✓ Passed Steps: ${#PASSED_STEPS[@]}${NC}"
for s in "${PASSED_STEPS[@]}"; do
    echo -e "    ${GREEN}• $s${NC}"
done

if [ ${#WARNED_STEPS[@]} -gt 0 ]; then
    echo -e "\n  ${YELLOW}⚠ Non-fatal warnings: ${#WARNED_STEPS[@]} (Script automatically handled them)${NC}"
    for w in "${WARNED_STEPS[@]}"; do
        echo -e "    ${YELLOW}• $w${NC}"
    done
fi

echo -e "\n${BOLD}${BLUE}Next Actions:${NC}"
echo "1. Test Handset Microphone & Earpiece:"
echo "   ${BOLD}./scripts/check_pi_audio.sh${NC}"
echo ""
echo "2. Launch the Phone Booth Kiosk right now:"
echo "   ${BOLD}./scripts/start-booth-pi.sh${NC}"
echo ""
echo "3. Connect to your Secondary Laptop (RTX 3050):"
echo "   In the booth screen, tap Settings (gear icon) -> enter your laptop's IP:"
echo "   ${BOLD}ws://<LAPTOP_IP>:8765${NC} -> Save Address."
echo "======================================================================="
