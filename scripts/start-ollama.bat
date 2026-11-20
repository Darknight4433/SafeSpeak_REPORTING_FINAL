@echo off
echo Starting Ollama for SafeSpeak...
where ollama >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Ollama was not found in your PATH.
    echo Please install Ollama from: https://ollama.com/download/windows
    pause
    exit /b 1
)

echo Starting Ollama background server...
start /B ollama serve

timeout /t 3 /nobreak >nul
echo Checking models...
ollama list
echo.
echo If you need to pull the lightweight recommended model, run:
echo    ollama pull llama3.2:1b
echo.
pause
