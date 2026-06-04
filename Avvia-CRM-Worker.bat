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
git pull
for /f %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_AFTER=%%H"

set "NEED_INSTALL="
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if not "%HEAD_BEFORE%"=="%HEAD_AFTER%" (
  git diff --name-only "%HEAD_BEFORE%" "%HEAD_AFTER%" | findstr /C:"package-lock.json" >nul && set "NEED_INSTALL=1"
)

REM --- 2. DIPENDENZE (solo se servono) ---
if defined NEED_INSTALL (
  if exist "node_modules" if not exist "node_modules\.bin\tsx.cmd" (
    echo Rimuovo dipendenze incompatibili ^(erano per Mac^)...
    rmdir /s /q "node_modules"
  )
  echo [2/3] Aggiorno le dipendenze ^(la prima volta ci vogliono alcuni minuti^)...
  call npm install
) else (
  echo [2/3] Tutto aggiornato, nessuna nuova dipendenza.
)
echo.

REM --- 3. AVVIO WORKER ---
echo [3/3] Avvio del worker...
echo.
call npm run outreach:worker

echo.
echo ===============================================
echo   Worker FERMATO. Premi un tasto per chiudere.
echo ===============================================
pause >nul
