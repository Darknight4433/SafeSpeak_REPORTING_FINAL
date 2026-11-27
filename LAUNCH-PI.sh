#!/usr/bin/env bash
# ==============================================================================
# 🍓 SafeSpeak Phone Booth — Instant 0-Second Launcher for Raspberry Pi
# ==============================================================================
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/START-PI-KIOSK.sh" "$@"
