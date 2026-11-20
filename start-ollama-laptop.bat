@echo off
REM ==============================================================================
REM SafeSpeak - Start Ollama AI Server on Laptop for Raspberry Pi / Linux Station
REM ==============================================================================

echo [SafeSpeak] Setting Ollama to listen across local Wi-Fi (0.0.0.0:11434)...
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*

echo [SafeSpeak] Laptop IP addresses on this network:
ipconfig | findstr /i "IPv4"

echo.
echo =====================================================================
echo SafeSpeak AI Server is running on your Laptop!
echo On your Raspberry Pi / Linux client:
echo 1. Open SafeSpeak Report page
echo 2. Click the gear icon (Settings) in the AI bar
echo 3. Enter: http://192.168.1.3:11434
echo =====================================================================
echo.

ollama serve
pause
