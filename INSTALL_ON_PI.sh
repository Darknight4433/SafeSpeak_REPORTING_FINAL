#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — Standalone USB Pendrive Installer for Raspberry Pi
# ==============================================================================
# Copy this single file (INSTALL_ON_PI.sh) onto a USB flash drive (pendrive).
# Plug the pendrive into your Raspberry Pi, open a terminal, and run:
#     bash INSTALL_ON_PI.sh
#
# What this script does automatically:
# 1. Verifies internet connection & installs git if missing.
# 2. Clones the full SafeSpeak repository to your Pi's home directory:
#    ~/SafeSpeak_REPORTING_FINAL (using the ext4 filesystem).
# 3. Executes the resilient all-out Pi master installer (pi-setup-all.sh).
# 4. Sets up audio, 24/7 screen display, permissions, and desktop shortcuts.
# ==============================================================================

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${GREEN}"
echo "======================================================================="
echo "🍓 SafeSpeak Phone Booth — USB Pendrive Raspberry Pi Installer"
echo "======================================================================="
echo -e "${NC}"

REPO_URL="https://github.com/Darknight4433/SafeSpeak_REPORTING_FINAL.git"
TARGET_DIR="$HOME/SafeSpeak_REPORTING_FINAL"

# 0. Clean Interrupted Locks & Self-Heal dpkg (in case terminal was closed midway)
echo -e "${BLUE}▶ 0. Cleaning any interrupted package locks...${NC}"
sudo killall apt apt-get dpkg 2>/dev/null || true
sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null || true
sudo dpkg --configure -a 2>/dev/null || true
sudo apt-get install -f -y 2>/dev/null || true

# 1. Check Internet Connection
echo -e "${BLUE}▶ 1. Checking Internet Connection...${NC}"
if ping -c 1 -W 3 github.com >/dev/null 2>&1 || ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Internet connection detected.${NC}"
else
    echo -e "${YELLOW}⚠ Could not ping github.com directly. Continuing attempt...${NC}"
fi

# 2. Ensure Git is installed
echo -e "\n${BLUE}▶ 2. Verifying Git installation...${NC}"
if ! command -v git >/dev/null 2>&1; then
    echo "Git not found. Installing git via apt..."
    sudo apt-get update -y || true
    sudo apt-get install -y git || true
fi

if command -v git >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Git is ready: $(git --version)${NC}"
else
    echo -e "${RED}❌ Could not install git. Please check your internet connection.${NC}"
    exit 1
fi

# 3. Clone or Update the Repository on Pi Storage (~/SafeSpeak_REPORTING_FINAL)
echo -e "\n${BLUE}▶ 3. Downloading SafeSpeak from GitHub...${NC}"
if [ -d "$TARGET_DIR/.git" ]; then
    echo -e "Repository already exists at ${BOLD}$TARGET_DIR${NC}."
    echo "Pulling latest updates from GitHub..."
    cd "$TARGET_DIR"
    git pull origin main || true
else
    echo -e "Cloning SafeSpeak repository to ${BOLD}$TARGET_DIR${NC}..."
    git clone "$REPO_URL" "$TARGET_DIR" || {
        echo -e "${RED}❌ Git clone failed. Please check your internet connection and try again.${NC}"
        exit 1
    }
    cd "$TARGET_DIR"
fi

# 4. Run the Resilient All-Out Master Setup Script
echo -e "\n${BLUE}▶ 4. Running SafeSpeak Master Setup Script (pi-setup-all.sh)...${NC}"
if [ -f "$TARGET_DIR/pi-setup-all.sh" ]; then
    chmod +x "$TARGET_DIR/pi-setup-all.sh" 2>/dev/null || true
    bash "$TARGET_DIR/pi-setup-all.sh"
elif [ -f "$TARGET_DIR/scripts/setup_pi.sh" ]; then
    chmod +x "$TARGET_DIR/scripts/setup_pi.sh" 2>/dev/null || true
    bash "$TARGET_DIR/scripts/setup_pi.sh"
else
    echo -e "${RED}❌ Setup script not found in $TARGET_DIR.${NC}"
    exit 1
fi

# 5. Success Banner & Instructions
echo -e "\n${BOLD}${GREEN}"
echo "======================================================================="
echo "🎉 SUCCESS: SafeSpeak is fully installed on your Raspberry Pi!"
echo "=======================================================================${NC}"
echo -e "Installation folder: ${BOLD}$TARGET_DIR${NC}"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo -e "1. You can now safely unplug your USB pendrive."
echo -e "2. Double-click the ${BOLD}SafeSpeak Phone Booth${NC} icon on your Pi Desktop,"
echo -e "   or in the terminal run:"
echo -e "   ${BOLD}cd $TARGET_DIR && ./scripts/start-booth-pi.sh${NC}"
echo ""
echo -e "3. To test your telephone handset audio:"
echo -e "   ${BOLD}cd $TARGET_DIR && ./scripts/check_pi_audio.sh${NC}"
echo "======================================================================="
