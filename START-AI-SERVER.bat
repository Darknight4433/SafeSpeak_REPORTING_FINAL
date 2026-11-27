@echo off
title SafeSpeak AI Server (Llama 3.2 3B - Ultra Fast)
color 0A

echo =====================================================================
echo 🛡️  SafeSpeak AI Voice Server — Secondary Laptop (RTX 3050)
echo =====================================================================
echo Model: Llama 3.2 3B (Ultra-Fast Spoken Voice Engine)
echo Target Latency: ^<150ms per spoken turn (100+ tokens/sec)
echo =====================================================================
echo.

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

:: 2. Check Ollama
where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Ollama was not found!
    echo Please install Ollama from https://ollama.com/download/windows
    pause
    exit /b 1
)

:: 3. Clean up heavy 7B models if user has them (free ~10GB disk and VRAM)
echo [1/5] Checking for heavy 7B models to free up disk and VRAM...
ollama list | findstr /i "qwen2.5:7b qwen2.5-coder:7b" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo       ⚠️ Found heavy 7B models. Removing them now to save ~10GB...
    ollama rm qwen2.5:7b >nul 2>nul
    ollama rm qwen2.5-coder:7b >nul 2>nul
    echo       ✅ Heavy 7B models removed successfully!
) else (
    echo       ✅ No heavy 7B models consuming VRAM.
)

:: 4. Verify / Pull Fast Model (llama3.2:3b)
echo.
echo [2/5] Checking Llama 3.2 3B model (~2.0 GB)...
ollama list | findstr /i "llama3.2:3b" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       📦 Downloading ultra-fast model: llama3.2:3b ...
    ollama pull llama3.2:3b
) else (
    echo       ✅ llama3.2:3b is already installed and ready!
)

:: 5. Ensure Python websockets dependency
echo.
echo [3/5] Verifying Python websockets library...
python -c "import websockets" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       📦 Installing websockets for Python...
    python -m pip install websockets -q
)
echo       ✅ Python dependencies verified.

:: 6. Set Environment Variables & Start Ollama service on 0.0.0.0
echo.
echo [4/5] Configuring network binding & Windows Firewall for Raspberry Pi access...
netsh advfirewall firewall add rule name="SafeSpeak-AI-Voice-WS-8765" dir=in action=allow protocol=TCP localport=8765 >nul 2>nul
netsh advfirewall firewall add rule name="SafeSpeak-Web-Server-5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>nul
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*
set SAFESPEAK_MODEL=llama3.2:3b
set SAFESPEAK_WS_PORT=8765

:: Start Ollama background service if not already listening
curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo       🚀 Starting Ollama background engine on 0.0.0.0:11434...
    start /b ollama serve >nul 2>nul
    timeout /t 3 /nobreak >nul
)
echo       ✅ Ollama engine running on 0.0.0.0:11434.

:: 7. Display Local Network IPv4 Address & Hostname
echo.
echo =====================================================================
echo [5/5] 🌐 CONNECTION ADDRESSES (Use on Raspberry Pi):
echo.
echo    ⭐ Option 1 (Recommended - NEVER CHANGES on any Wi-Fi):
echo       ws://%COMPUTERNAME%.local:8765
echo.
echo    👉 Option 2 (Current Direct IP):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    echo       ws:%%a:8765
)
echo =====================================================================
echo 💡 Enter either URL above on your Raspberry Pi SafeSpeak Phone Booth!
echo =====================================================================
echo.

:: 8. Launch Python Voice Server
"%PYTHON_EXE%" "%~dp0scripts\start_phone_booth_server.py"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [Server Exited with code %ERRORLEVEL%]
    pause
)
