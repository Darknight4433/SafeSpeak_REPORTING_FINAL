# 🍓 SafeSpeak Phone Booth — Complete Raspberry Pi OS Setup & Configuration Guide

This guide walks you through configuring your **Raspberry Pi (Pi 4 or Pi 5)** as a dedicated, standalone **SafeSpeak School Phone Booth Kiosk**.

---

## 1. Hardware Checklist

| Component | Recommendation | Connection |
| :--- | :--- | :--- |
| **Raspberry Pi** | Raspberry Pi 4 (4GB+) or Raspberry Pi 5 | Official USB-C Power Supply |
| **OS** | Raspberry Pi OS (64-bit Bookworm recommended) | MicroSD (32GB+ Class 10 / A2) |
| **Display** | 7" to 15" Touchscreen or HDMI Monitor | HDMI / DSI Ribbon Cable |
| **Telephone Handset** | USB Telephone Handset or 3.5mm Handset with USB Audio Dongle | USB 2.0 / 3.0 Port |
| **Hook Switch (Optional)** | Physical Telephone Cradle Microswitch | GPIO Pin 17 & Ground |

---

## 2. One-Command Automated Pi Setup

Clone or copy the SafeSpeak project to your Raspberry Pi, open a terminal, and run:

```bash
chmod +x ./scripts/setup_pi.sh
./scripts/setup_pi.sh
```

### What `setup_pi.sh` Automatically Does:
1. **Installs System Dependencies**: ALSA sound tools, GTK3, speech-dispatcher, unclutter, and ffmpeg.
2. **Configures Permissions**: Adds your Pi user to `audio`, `video`, `input`, and `gpio` groups so Electron can access the handset mic and speaker without permission popups.
3. **Disables Screen Sleep / Blanking**: Prevents the screen from turning off or going to sleep 24/7.
4. **Hides Mouse Cursor**: Automatically hides the cursor after 1 second of touchscreen inactivity.
5. **Calibrates Audio Levels**: Unmutes and sets handset mic and speaker volume to 85%.
6. **Compiles Production Bundle**: Runs `npm install` and `npm run build`.
7. **Installs Autostart Kiosk**: Generates `~/.config/autostart/safespeak-phone-booth.desktop` so SafeSpeak launches into fullscreen locked kiosk mode whenever the Pi powers on.

---

## 3. Verify Audio Handset on the Pi

To verify that your physical handset microphone and earpiece are functioning:

```bash
chmod +x ./scripts/check_pi_audio.sh
./scripts/check_pi_audio.sh
```

This interactive tool will:
1. List all detected USB and ALSA audio cards.
2. Prompt you to speak into the telephone handset (records 3 seconds).
3. Play back the recording through the handset earpiece.
4. Test the Text-to-Speech (TTS) voice synthesizer.

---

## 4. Connecting the Pi to the Secondary Laptop (RTX 3050)

SafeSpeak's heavy AI inference (Qwen 2.5 7B streaming LLM) runs on your secondary laptop.

1. **On your Secondary Laptop**:
   - Run `start-phone-booth-server.bat` (Windows) or `scripts/start-phone-booth-server.sh` (Linux).
   - The script will display its LAN IP address (for example: `192.168.1.15`).

2. **On the Raspberry Pi**:
   - In the SafeSpeak Voice Booth screen, tap the **Settings (gear icon)** in the top right.
   - Enter your secondary laptop's address:
     ```
     ws://192.168.1.15:8765
     ```
   - Tap **Save Address**. The status badge will change to **🟢 AI Assistant Ready**.

> [!TIP]
> Both the Raspberry Pi and the secondary laptop must be connected to the same Wi-Fi router or local school LAN network.

---

## 5. Manual Launch & Kiosk Controls

To launch the kiosk manually anytime on the Pi:

```bash
# Standard desktop window:
./scripts/start-linux.sh

# Dedicated fullscreen kiosk mode:
./scripts/start-booth-pi.sh
```

---

## 6. (Optional) Physical Telephone Cradle Hook Switch Wiring

If using a real vintage or payphone handset cradle with a mechanical switch:
- **Wire 1**: Connect to **GPIO Pin 17** (Physical Pin 11 on the 40-pin header)
- **Wire 2**: Connect to **GND** (Physical Pin 9 or 14)

Run the GPIO monitor:
```bash
python3 ./scripts/pi_hook_switch.py
```
When a student lifts the handset off the cradle, the switch pulls GPIO 17 to GND, triggering the call start event. Replacing the handset on the cradle triggers the hang-up and submit event.
