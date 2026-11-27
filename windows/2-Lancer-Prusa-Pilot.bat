@echo off
title Prusa Pilot 3D — Serveur Local
echo Demarrage de Prusa Pilot 3D (avec PrusaSlicer integre)...
echo Ne fermez pas cette fenetre tant que vous utilisez l'application.
echo.

REM Ouvre automatiquement http://localhost:3000 dans le navigateur Windows apres 3 secondes
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

REM Lance le serveur Next.js + PrusaSlicer dans la distribution WSL2 par defaut
wsl -- bash -lc "cd ~/prusa && pkill -f 'Xtigervnc :98' 2>/dev/null || true; pkill -f prusa-slicer 2>/dev/null || true; npm start"

echo.
echo Le serveur s'est arrete.
pause
