#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak Phone Booth - Secondary Laptop AI Server Launcher (Linux)
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "====================================================================="
echo "🛡️  Starting SafeSpeak Phone Booth AI Server (Qwen 2.5 7B)"
echo "====================================================================="

if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERROR] python3 not found. Please install python3."
    exit 1
fi

python3 "$DIR/start_phone_booth_server.py"
