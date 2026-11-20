@echo off
echo ===================================================
echo Pushing SafeSpeak updates to GitHub...
echo ===================================================
git push origin main
if %ERRORLEVEL% EQU 0 (
    echo.
    echo 🎉 Successfully pushed to GitHub!
) else (
    echo.
    echo ❌ Push encountered an error. If prompted, please log in with your GitHub account.
)
pause
