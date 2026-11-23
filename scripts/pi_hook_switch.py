#!/usr/bin/env python3
"""
========================================================================================
SafeSpeak Phone Booth — Physical Telephone Handset Hook Switch Monitor (Raspberry Pi)
========================================================================================
Monitors a physical telephone cradle switch connected to Raspberry Pi GPIO pins.

Wiring Diagram:
- Hook Switch Terminal 1 -> Raspberry Pi GPIO Pin 17 (Physical Pin 11)
- Hook Switch Terminal 2 -> Raspberry Pi Ground (GND, Physical Pin 9 or 14)

Behavior:
- Handset Lifted (Off-Hook): Contact closes (Pin 17 pulls LOW) -> Triggers Call Start
- Handset Placed Back (On-Hook): Contact opens (Pin 17 pulls HIGH) -> Triggers Hang Up
========================================================================================
"""

import sys
import time
import os
import json
import urllib.request

# Configuration
HOOK_GPIO_PIN = int(os.environ.get("SAFESPEAK_HOOK_PIN", 17))
BOOTH_URL = os.environ.get("SAFESPEAK_BOOTH_URL", "http://127.0.0.1:8080")

def check_gpio_available():
    try:
        from gpiozero import Button
        return True, "gpiozero"
    except ImportError:
        try:
            import RPi.GPIO as GPIO
            return True, "rpi.gpio"
        except ImportError:
            return False, None

def main():
    print("======================================================================")
    print("📞 SafeSpeak Physical Telephone Hook Switch Monitor (Raspberry Pi)")
    print("======================================================================")
    print(f"   - Monitoring GPIO Pin: {HOOK_GPIO_PIN} (Internal Pull-Up enabled)")
    print(f"   - Kiosk Target URL:    {BOOTH_URL}")
    print("======================================================================\n")

    available, lib = check_gpio_available()
    if not available:
        print("ℹ️  GPIO libraries not found (expected on non-Pi or development machines).")
        print("   On Raspberry Pi OS, install with: sudo apt install python3-gpiozero python3-rpi.gpio")
        print("   Simulating monitor in demo loop (Press Ctrl+C to stop)...")
        try:
            while True:
                time.sleep(5)
        except KeyboardInterrupt:
            print("\nExiting monitor.")
        return

    print(f"✅ Initializing GPIO using library '{lib}'...")
    
    if lib == "gpiozero":
        from gpiozero import Button
        # Button with pull_up=True: pressed = off-hook (connected to GND)
        hook = Button(HOOK_GPIO_PIN, pull_up=True, bounce_time=0.1)

        def on_lift():
            print("📞 [OFF-HOOK DETECTED] Physical telephone handset lifted!")
            # Future: send hook event to Electron or trigger shortcut

        def on_hangup():
            print("📴 [ON-HOOK DETECTED] Physical telephone handset replaced on cradle!")

        hook.when_pressed = on_lift
        hook.when_released = on_hangup

        print("👂 Listening for handset pick-up events...")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping hook switch monitor.")

if __name__ == "__main__":
    main()
