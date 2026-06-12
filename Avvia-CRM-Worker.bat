@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================
echo   CRM Worker
echo   (chiudi questa finestra per FERMARE il worker)
echo ===============================================
echo.

if not exist "package.json" (
  echo ERRORE: questo file deve stare DENTRO la cartella del progetto ^(es. C:\CRM^).
  echo.
  pause
  exit /b
)

REM --- 1. AGGIORNAMENTO AUTOMATICO da GitHub ---
echo [1/3] Cerco aggiornamenti su GitHub...
for /f %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_BEFORE=%%H"
git pull --ff-only & call "scripts\win-worker.cmd" "%HEAD_BEFORE%"
