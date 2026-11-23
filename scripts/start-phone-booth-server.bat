@echo off
REM ==============================================================================
REM SafeSpeak Phone Booth - Secondary Laptop AI Server Launcher
REM Runs Ollama + Qwen 2.5 7B + WebSocket Server on RTX 3050 6GB
REM ==============================================================================
title SafeSpeak Phone Booth AI Server (Fast Voice Engine)
color 0A

echo =====================================================================
echo 🛡️  Starting SafeSpeak Phone Booth AI Server (Llama 3.2 3B / Qwen)
echo =====================================================================

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 was not found in your PATH.
    echo Please install Python 3 from https://www.python.org/
    pause
    exit /b 1
)

python "%~dp0start_phone_booth_server.py"

if %ERRORLEVEL% NEQ 0 (
    echo [Server Exited with error %ERRORLEVEL%]
    pause
)
