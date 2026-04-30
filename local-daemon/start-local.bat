@echo off
TITLE OmniRouteAI - Local Daemon

set MITM_PROXY=true

echo.
echo =========================================================
echo    OmniRouteAI Local Daemon v2.0.0
echo =========================================================
echo.

cd /d "%~dp0"

echo Starting the OmniRouteAI Local Daemon...
echo.
node src/main.js

pause
