@echo off
title SafeSpeak All-In-One Launcher (AI + Web)
color 0B

echo =====================================================================
echo [SafeSpeak] Child Safeguarding Platform - All-In-One Launcher
echo =====================================================================
echo  - Station B: RTX 3050 Laptop AI Engine
echo  - Station A: Raspberry Pi Kiosk Terminal
echo =====================================================================
echo.

cd /d "%~dp0"

:: Ensure local Python installations take precedence over WindowsApps stub
set "PYTHON_EXE=python"
if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if exist "%PYTHON_EXE%" for %%F in ("%PYTHON_EXE%") do set "PATH=%%~dpF;%PATH%"

:: 1. Check Python
"%PYTHON_EXE%" --version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 was not found!
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

:: 3. Configure Windows Firewall for Raspberry Pi Inbound Access (Ports 8765 & 5173)
echo [1/5] Configuring Windows Firewall for Raspberry Pi...
netsh advfirewall firewall add rule name="SafeSpeak-AI-Voice-WS-8765" dir=in action=allow protocol=TCP localport=8765 >nul 2>nul
netsh advfirewall firewall add rule name="SafeSpeak-Web-Server-5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>nul
netsh advfirewall firewall add rule name="SafeSpeak-AutoDiscovery-UDP-8767" dir=in action=allow protocol=UDP localport=8767 >nul 2>nul
echo       [OK] Firewall rules active for ports 8765 (AI Voice), 5173 (Web), and 8767 (Auto-Discovery).

:: 4. Detect Current Local LAN IPv4 & Hostname
set "CURRENT_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set "CURRENT_IP=%%b"
    )
)
set "LAPTOP_MDNS=%COMPUTERNAME%.local"

:: Save connection config for Pi
(
echo LAPTOP_IP=%CURRENT_IP%
echo LAPTOP_HOSTNAME=%LAPTOP_MDNS%
echo WS_URL=ws://%CURRENT_IP%:8765
echo MDNS_WS_URL=ws://%LAPTOP_MDNS%:8765
echo WEB_URL=http://%CURRENT_IP%:5173/#/report
) > "%~dp0laptop_connection.txt"

(
echo %CURRENT_IP%
) > "%~dp0laptop_ip.txt"

:: 5. Check / Start Ollama
echo.
echo [2/5] Verifying Ollama AI engine...
where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Ollama CLI not found. AI server will run in resilient zero-dependency mode.
) else (
    set OLLAMA_HOST=0.0.0.0:11434
    set OLLAMA_ORIGINS=*
    curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo       [*] Starting Ollama background engine...
        start /b ollama serve >nul 2>nul
        ping -n 3 127.0.0.1 >nul
    )
    echo       [OK] Ollama engine ready on http://127.0.0.1:11434
)

:: 6. Verify Python Dependencies
echo.
echo [3/5] Verifying Python libraries (websockets, edge-tts)...
"%PYTHON_EXE%" -c "import websockets, edge_tts" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       [*] Installing websockets and edge-tts for Python...
    "%PYTHON_EXE%" -m pip install websockets edge-tts -q
)
echo       [OK] Python dependencies verified.

:: 7. Launch Python Voice AI Server on 0.0.0.0:8765
echo.
echo [4/5] Launching SafeSpeak AI Voice Server (Port 8765)...
set "SAFESPEAK_WS_PORT=8765"
start "SafeSpeak AI Voice Server [Port 8765]" cmd /k "%PYTHON_EXE% scripts\start_phone_booth_server.py"
ping -n 3 127.0.0.1 >nul

:: 8. Launch Vite Web Server on 0.0.0.0:5173
echo.
echo [5/5] Launching SafeSpeak Web Platform (Port 5173)...
start "SafeSpeak Web Server [Port 5173]" cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"

:: Wait for servers to spin up
echo.
echo Waiting for servers to initialize...
ping -n 4 127.0.0.1 >nul

:: 9. Display Network Connection Info
echo.
echo =====================================================================
echo  SAFESPEAK DUAL-STATION NETWORK STATUS:
echo =====================================================================
echo  LAPTOP (This PC):
echo    - IPv4 Address:    %CURRENT_IP%
echo    - Hostname / mDNS: %LAPTOP_MDNS%
echo    - AI Voice Socket: ws://%CURRENT_IP%:8765
echo    - Web Server URL:  http://%CURRENT_IP%:5173
echo.
echo  RASPBERRY PI (Station A - Kiosk):
echo    On your Raspberry Pi, run either:
echo       bash START-PI-KIOSK.sh
echo    Or open in Pi browser:
echo       http://%CURRENT_IP%:5173/#/report
echo =====================================================================
echo.

:: Automatically open browser locally
start http://localhost:5173/#/report

exit /b 0
