@echo off
title SafeSpeak All-In-One Launcher (AI + Web)
color 0B

echo =====================================================================
echo 🛡️  SafeSpeak All-In-One Instant Launcher
echo =====================================================================
echo  - NVIDIA GPU / Ollama AI Model: Llama 3.2 3B
echo  - Voice WebSocket Server: Port 8765
echo  - Web Application: Port 5173
echo =====================================================================
echo.

cd /d "%~dp0"

:: Ensure local Python installations take precedence over WindowsApps stub
if exist "%LOCALAPPDATA%\Python\bin\python.exe" set "PATH=%LOCALAPPDATA%\Python\bin;%PATH%"
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%PATH%"

:: 1. Check Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 was not found in your PATH!
    echo Please install Python 3 from https://www.python.org/ and check "Add python to PATH".
    pause
    exit /b 1
)

:: 2. Check Node.js / NPM
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js / npm was not found in your PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: 3. Check / Start Ollama
echo [1/4] Verifying Ollama AI engine...
where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Ollama CLI not found. AI server will run in resilient zero-dependency mode.
) else (
    set OLLAMA_HOST=0.0.0.0:11434
    set OLLAMA_ORIGINS=*
    curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo       🚀 Starting Ollama background engine...
        start /b ollama serve >nul 2>nul
        timeout /t 2 /nobreak >nul
    )
    echo       ✅ Ollama engine ready on http://127.0.0.1:11434
)

:: 4. Verify Python Websockets Dependency
echo.
echo [2/4] Verifying Python websockets...
python -c "import websockets" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       📦 Installing websockets for Python...
    python -m pip install websockets -q
)
echo       ✅ Python websockets verified.

:: 5. Launch Python Voice AI Server in background window
echo.
echo [3/4] Launching SafeSpeak Voice AI Server (Port 8765)...
start "SafeSpeak AI Voice Server [Port 8765]" cmd /k "color 0A && title SafeSpeak AI Voice Server && python scripts/start_phone_booth_server.py"
timeout /t 2 /nobreak >nul

:: 6. Launch Vite Web Server & Open Browser
echo.
echo [4/4] Launching SafeSpeak Web Platform (Port 5173)...
start "SafeSpeak Web Server [Port 5173]" cmd /k "color 0E && title SafeSpeak Web Server && npm run dev -- --host 0.0.0.0 --port 5173"

:: Wait for servers to spin up
echo.
echo ⏳ Waiting 3 seconds for local servers to start...
timeout /t 3 /nobreak >nul

:: 7. Automatically open browser to the Voice Phone Booth
echo 🚀 Opening SafeSpeak Voice Phone Booth in your browser...
start http://localhost:5173/#/report

echo.
echo =====================================================================
echo ✅ SAFESPEAK IS LIVE AND READY!
echo =====================================================================
echo  - Voice Phone Booth: http://localhost:5173/#/report
echo  - Local AI Server:   ws://127.0.0.1:8765
echo.
echo You can plug in your USB headset and start speaking immediately!
echo =====================================================================
timeout /t 5 >nul
exit /b 0
