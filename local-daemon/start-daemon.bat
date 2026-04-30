@echo off
TITLE OmniRouteAI - Local Daemon ^& Ngrok 

set MITM_PROXY=false

echo.
echo =========================================================
echo    OmniRouteAI Local Daemon v2.0.0
echo =========================================================
echo.

cd /d "%~dp0"

echo Starting the OmniRouteAI Local Daemon in a separate window...
start cmd /k "node src/main.js"

echo.
echo =========================================================
echo    DAEMON IS RUNNING IN BACKGROUND ON PORT 5059
echo =========================================================
echo.
echo Starting Ngrok Tunnel...
echo Make sure you have authenticated your ngrok client beforehand.
echo.

ngrok.exe http --domain=noninfallible-nonalkaloidal-erna.ngrok-free.dev 5059 --host-header=rewrite
