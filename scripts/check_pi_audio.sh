#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth - Raspberry Pi Audio Handset Diagnostic
# ==============================================================================
# Tests microphone capture and speaker playback for the physical telephone handset.
# ==============================================================================

set -e

echo "=========================================================="
echo "📞 SafeSpeak Phone Booth Audio Diagnostic (Raspberry Pi)"
echo "=========================================================="

echo -e "\n1. Listing Playback Devices (aplay -l):"
aplay -l || echo "No aplay found"

echo -e "\n2. Listing Capture Devices (arecord -l):"
arecord -l || echo "No arecord found"

echo -e "\n3. Testing Handset Microphone (Recording 3 seconds to /tmp/booth-test.wav)..."
echo "   👉 Please speak into the telephone handset now..."
arecord -d 3 -f cd /tmp/booth-test.wav

echo -e "\n4. Testing Handset Speaker (Playing back recorded audio)..."
echo "   👉 Listen to the telephone earpiece..."
aplay /tmp/booth-test.wav

echo -e "\n5. Testing Speech Dispatcher (TTS Voice Engine)..."
if command -v spd-say >/dev/null 2>&1; then
    spd-say "SafeSpeak phone booth audio test successful. The voice engine is operational."
    echo "   ✅ Speech dispatcher command issued."
else
    echo "   ℹ️  speech-dispatcher not installed (install with: sudo apt install speech-dispatcher espeak-ng)"
fi

rm -f /tmp/booth-test.wav
echo -e "\n=========================================================="
echo "✅ Audio test complete!"
echo "=========================================================="
