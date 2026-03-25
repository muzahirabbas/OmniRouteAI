@echo off
TITLE OmniRouteAI - Local Daemon ^& Ngrok 

echo [1/2] Compiling the Fastify Background Server...
if not exist dist\OmniRouteAI-Local.exe (
    echo Building the daemon executable first...
    call npm run build:win
)

echo [2/2] Starting the OmniRouteAI Local Daemon in the background...
start /B dist\OmniRouteAI-Local.exe

echo.
echo =========================================================
echo    DAEMON IS RUNNING IN BACKGROUND ON PORT 5059
echo =========================================================
echo.
echo Starting Ngrok Tunnel on your Static Domain...
echo Make sure you have authenticated your ngrok client beforehand.
echo.

ngrok http --domain=noninfallible-nonalkaloidal-erna.ngrok-free.dev 5059
