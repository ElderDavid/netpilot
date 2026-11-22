@echo off
title NetPilot 0.1
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node 22 o superior.
  pause
  exit /b 1
)
echo Iniciando NetPilot...
node agent\index.mjs
pause
