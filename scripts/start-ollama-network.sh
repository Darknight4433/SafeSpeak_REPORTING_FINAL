#!/usr/bin/env bash
# ==============================================================================
# SafeSpeak - Start Ollama for Local Network (Raspberry Pi / Linux Clients)
# ==============================================================================
# Binds Ollama to 0.0.0.0 so Raspberry Pi / client devices on the network can connect.
# ==============================================================================

export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"

echo "====================================================================="
echo "🛡️  SafeSpeak AI Server (Laptop Host)"
echo "====================================================================="
echo "Finding Laptop IP addresses on this network:"
hostname -I 2>/dev/null || ip addr | grep 'inet ' | awk '{print $2}'

echo ""
echo "Ollama is listening on port 11434 across all network interfaces."
echo "On your Raspberry Pi, enter: http://<YOUR_LAPTOP_IP>:11434"
echo "====================================================================="

ollama serve
