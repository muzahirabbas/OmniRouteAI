@echo off
TITLE OmniRouteAI - Local Daemon ^& Ngrok 

set MITM_PROXY=true

echo Starting the OmniRouteAI Local Daemon in the background...
start /B node src/main.js

echo.
echo =========================================================
echo    DAEMON IS RUNNING IN BACKGROUND ON PORT 5059
echo =========================================================
echo.
echo Starting Ngrok Tunnel on your Static Domain...
echo Make sure you have authenticated your ngrok client beforehand.
echo.

ngrok http --domain=noninfallible-nonalkaloidal-erna.ngrok-free.dev 5059
