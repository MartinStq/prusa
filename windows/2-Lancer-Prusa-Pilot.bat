@echo off
title Prusa Pilot 3D - Serveur Windows
cd /d "%~dp0.."

if exist "%cd%\vendor\node\node.exe" (
    set "PATH=%cd%\vendor\node;%PATH%"
)

set "NODE_ENV=production"
set "NODE_OPTIONS=--max-old-space-size=384"

echo ==================================================
echo  Prusa Pilot 3D - Demarrage (100%% Windows natif)
echo ==================================================
echo Ne fermez pas cette fenetre tant que vous utilisez l'application.
echo.

REM Ouvre automatiquement http://localhost:3000 apres 3 secondes
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

node server.mjs --prod

echo.
echo Le serveur s'est arrete.
pause
