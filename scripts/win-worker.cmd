@echo off
REM Parte DOPO il "git pull" del launcher (Avvia-CRM-Worker.bat), quindi questo
REM file e' SEMPRE la versione piu' fresca presa da GitHub.
REM Argomento %1 = commit HEAD prima del pull (per capire se servono dipendenze).
cd /d "%~dp0\.."

set "HEAD_BEFORE=%~1"
for /f %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_AFTER=%%H"

REM --- DIPENDENZE (solo se servono) ---
set "NEED_INSTALL="
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if defined HEAD_BEFORE if not "%HEAD_BEFORE%"=="%HEAD_AFTER%" (
  git diff --name-only "%HEAD_BEFORE%" "%HEAD_AFTER%" | findstr /C:"package-lock.json" >nul && set "NEED_INSTALL=1"
)
if defined NEED_INSTALL (
  if exist "node_modules" if not exist "node_modules\.bin\tsx.cmd" (
    echo Rimuovo dipendenze incompatibili ^(erano per un altro sistema^)...
    rmdir /s /q "node_modules"
  )
  echo [2/3] Aggiorno le dipendenze ^(la prima volta ci vogliono alcuni minuti^)...
  call npm install
) else (
  echo [2/3] Tutto aggiornato, nessuna nuova dipendenza.
)
echo.

REM --- AVVIO WORKER ---
echo [3/3] Avvio del worker...
echo.
call npm run outreach:worker

echo.
echo ===============================================
echo   Worker FERMATO. Premi un tasto per chiudere.
echo ===============================================
pause >nul
