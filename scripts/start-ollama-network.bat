@echo off
REM ==============================================================================
REM SafeSpeak - Start Ollama for Local Network (Raspberry Pi / Linux Clients)
REM ==============================================================================
REM This script binds Ollama to 0.0.0.0 so other devices on the same Wi-Fi/LAN
REM (such as your Raspberry Pi running SafeSpeak) can access the LLM.
REM ==============================================================================

echo [SafeSpeak] Setting Ollama to listen on all network interfaces (0.0.0.0:11434)...
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*

echo [SafeSpeak] Finding your Laptop's IP address on this network:
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0.*0.0.0.0') do (
    echo [SafeSpeak] Local Gateway / IP Interface: %%a
)
ipconfig | findstr /i "IPv4"

echo.
echo =====================================================================
echo SafeSpeak AI Server is now starting on your Laptop.
echo On your Raspberry Pi, in SafeSpeak's AI settings or .env, enter:
echo    http://YOUR_LAPTOP_IP:11434
echo =====================================================================
echo.

ollama serve
