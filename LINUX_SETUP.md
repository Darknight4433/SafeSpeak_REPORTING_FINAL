# 🐧 Complete Linux & Raspberry Pi Setup Guide for SafeSpeak

This document contains everything you need to run, package, and deploy **SafeSpeak** on Linux distributions (Ubuntu, Debian, Linux Mint, Raspberry Pi OS, Fedora, Arch Linux), including the **Live Voice AI Companion**, **Ollama background AI**, and **fullscreen School Kiosk mode**.

---

## 📋 Table of Contents
1. [System Requirements & Dependencies](#1-system-requirements--dependencies)
2. [Quick Start (Run from Source)](#2-quick-start-run-from-source)
3. [Building Native Linux Packages (.AppImage & .deb)](#3-building-native-linux-packages-appimage--deb)
4. [Raspberry Pi 4 / 5 Deployment](#4-raspberry-pi-4--5-deployment)
5. [Live Voice AI & Feelings Expression](#5-live-voice-ai--feelings-expression)
6. [Offline Ollama AI Setup on Linux](#6-offline-ollama-ai-setup-on-linux)
7. [Offline Vosk Voice Recognition Setup](#7-offline-vosk-voice-recognition-setup)
8. [School Kiosk Mode (Locked Public Station)](#8-school-kiosk-mode-locked-public-station)
9. [Linux Audio & Microphone Configuration](#9-linux-audio--microphone-configuration)
10. [Troubleshooting & FAQ](#10-troubleshooting--faq)

---

## 1. System Requirements & Dependencies

SafeSpeak requires **Node.js 18+ or 20+**, standard audio libraries (`ALSA`, `PulseAudio`/`PipeWire`), and graphical runtime libraries for Electron.

### Ubuntu / Debian / Linux Mint / Raspberry Pi OS (APT)
```bash
sudo apt update
sudo apt install -y curl git nodejs npm \
    libasound2 libasound2-plugins libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    speech-dispatcher ffmpeg pulseaudio-utils
```

### Fedora / RHEL (DNF)
```bash
sudo dnf install -y nodejs npm git alsa-lib alsa-plugins-pulseaudio \
    mesa-libgbm nss atk at-spi2-atk gtk3 speech-dispatcher ffmpeg
```

### Arch Linux / Manjaro (Pacman)
```bash
sudo pacman -Syu --needed nodejs npm git alsa-lib nss mesa gtk3 speech-dispatcher ffmpeg
```

> **Microphone Permission Tip**: Ensure your Linux user account is in the `audio` group:
> ```bash
> sudo usermod -aG audio $USER
> ```
> *(Log out and log back in for changes to take effect)*

---

## 2. Quick Start (Run from Source)

Clone or copy the project folder to your Linux machine, then run:

```bash
# 1. Install Node modules
npm install

# 2. Build production assets
npm run build

# 3. Start SafeSpeak Native Desktop App
./scripts/start-linux.sh
```

Or run via `npm`:
```bash
# Web browser development mode (http://localhost:8080)
npm run dev

# Or launch directly into Electron:
npx electron .
```

---

## 3. Building Native Linux Packages (.AppImage & .deb)

SafeSpeak is configured to build standalone packages that run on any Linux system without needing Node.js or development tools installed.

```bash
npm run dist:linux
```

This generates standalone packages in the `dist_electron/` directory:
- **`SafeSpeak_Reporting_State_Final-0.0.0.AppImage`**: Standalone executable for any Linux distro.
  ```bash
  chmod +x dist_electron/*.AppImage
  ./dist_electron/*.AppImage
  ```
- **`SafeSpeak_Reporting_State_Final_0.0.0_amd64.deb`**: Debian / Ubuntu installer.
  ```bash
  sudo dpkg -i dist_electron/*.deb
  ```

---

## 4. Raspberry Pi 4 / 5 Deployment

SafeSpeak runs smoothly on Raspberry Pi (4B with 4GB+ RAM or Pi 5 recommended).

### Automated Pi Build:
```bash
# For 64-bit Raspberry Pi OS (Recommended):
chmod +x ./scripts/build_pi.sh
./scripts/build_pi.sh arm64

# For 32-bit legacy Pi OS:
./scripts/build_pi.sh armv7
```

### Running on Raspberry Pi:
```bash
# Launch in native window:
./scripts/start-linux.sh

# Or launch as locked school terminal:
./scripts/start-linux.sh --kiosk
```

---

## 5. Live Voice AI & Feelings Expression

SafeSpeak includes a voice companion designed to let children speak freely:

1. **Voice Input**:
   - The child clicks the **Voice Mode** button.
   - The microphone activates with continuous listening.
   - The child's spoken words are transcribed in real time.
2. **Real-Time Emotion Recognition**:
   - The system detects emotional states (e.g. *Scared*, *Anxious*, *Hurt*, *Lonely*, *Overwhelmed*, *Relieved*).
   - Displayed as gentle, reassuring emotion badges on screen so kids know they are understood.
3. **SafeSpeak AI Voice Reassurance**:
   - The AI generates comforting reassurance:
     > *"Your feelings are completely valid. You did nothing wrong and you are safe here. We are listening and right beside you."*
   - The student can click **"Listen to Voice"** to hear this spoken aloud via the Linux `speech-dispatcher` engine.
4. **One-Click Auto-Fill**:
   - The child can tap **"Auto-Fill Form from What You Said"** to automatically populate the category (Bullying, Abuse, Academic, Safety, etc.) and intensity without manually filling dropdowns.

---

## 6. Offline Ollama AI Setup on Linux

SafeSpeak is 100% offline-ready. If you want the full generative intelligence of a local LLM on Linux:

### 1. Install Ollama:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull a lightweight model (fast on CPU & Pi):
```bash
ollama run llama3.2:1b
```
*(Alternative models: `llama3.2:3b`, `qwen2.5:1.5b`, `mistral`)*

### 3. Verify Connection:
```bash
curl http://127.0.0.1:11434/api/tags
```
SafeSpeak connects through the Vite proxy `/api/ollama` automatically. If Ollama is not running, SafeSpeak smoothly falls back to the client-side rule & memory engine with **zero crashes**.

---

## 7. Offline Vosk Voice Recognition Setup

For locations with **zero internet connectivity**, SafeSpeak includes a local Vosk speech server:

### 1. Install Python prerequisites:
```bash
pip install -r stt/requirements.txt
```

### 2. Download the lightweight English model (~40MB):
```bash
python3 stt/download_model.py
```
*(Installs to `~/.local/share/vosk-model-small-en-us-0.15`)*

### 3. Start the STT Server:
```bash
npm run stt:dev
# Or run the script:
./scripts/start-vosk.sh
```
*(Runs on `http://127.0.0.1:5000`)*

Whenever the browser's built-in speech API is unavailable (common in stripped-down Chromium builds on Linux), SafeSpeak records the audio blob and passes it directly to this local server.

---

## 8. School Kiosk Mode (Locked Public Station)

For dedicated school kiosks in hallways, libraries, or counselor lobbies:

```bash
# Start in fullscreen locked kiosk mode:
npx electron . --kiosk

# Or via environment variable:
SAFESPEAK_KIOSK=1 ./scripts/start-linux.sh
```

### Auto-start on Linux Boot (Systemd / Desktop Autostart)
To have the kiosk launch automatically when the Linux machine boots:

Create `~/.config/autostart/safespeak.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=SafeSpeak Kiosk
Exec=/usr/bin/bash -c "cd /path/to/SafeSpeak_REPORTING_FINAL-main && ./scripts/start-linux.sh --kiosk"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
```

---

## 9. Linux Audio & Microphone Configuration

Electron on Linux requires proper audio device mapping:

1. **Verify your microphone is recognized by ALSA**:
   ```bash
   arecord -l
   ```
2. **Test microphone recording**:
   ```bash
   arecord -d 3 -f cd /tmp/test-mic.wav
   aplay /tmp/test-mic.wav
   ```
3. **If audio levels are low or muted**:
   ```bash
   alsamixer
   # or
   pavucontrol
   ```
   Unmute the `Capture` / `Microphone` channel and increase volume to 80-90%.

---

## 10. Troubleshooting & FAQ

### Q: AppImage fails with `FATAL:setuid_sandbox_host.cc ... The SUID sandbox helper binary was found...` on Ubuntu 24.04?
Ubuntu 24.04 restricted unprivileged user namespaces. Run the AppImage with:
```bash
./dist_electron/*.AppImage --no-sandbox
```
Or permanently configure the kernel sysctl:
```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

### Q: Speech Synthesis ("Listen to Voice") produces no sound?
Ensure `speech-dispatcher` and a speech synthesizer (like `espeak-ng` or `festival`) are installed:
```bash
sudo apt install -y speech-dispatcher espeak-ng
spd-say "SafeSpeak voice test"
```

### Q: How do I test the full AI pipeline offline?
In the SafeSpeak reporting form, click the **"Run Self-Test"** button in the AI controls bar. It will simulate student reports against the live keyword engine, Ollama (if active), and memory fallback, printing full diagnostic tables to the browser console.
