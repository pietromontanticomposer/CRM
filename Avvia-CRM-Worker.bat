@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================
echo   CRM Worker - avvio in corso...
echo   (chiudi questa finestra per FERMARE il worker)
echo ===============================================
echo.

if not exist "package.json" (
  echo ERRORE: questo file NON e' dentro la cartella dell'app.
  echo Spostalo dentro la cartella "crm-next" ^(quella che contiene package.json^) e riprova.
  echo.
  pause
  exit /b
)

REM Le dipendenze valide per Windows hanno lo shim "tsx.cmd". Se manca
REM (cartella assente, oppure copiata dal Mac) la ricostruisco per Windows.
if not exist "node_modules\.bin\tsx.cmd" (
  echo Preparazione dipendenze per Windows. La prima volta ci vogliono alcuni minuti...
  if exist "node_modules" (
    echo Rimuovo le dipendenze vecchie ^(erano per Mac^)...
    rmdir /s /q "node_modules"
  )
  echo.
  call npm install
  echo.
)

call npm run outreach:worker
echo.
echo ===============================================
echo   Worker FERMATO. Premi un tasto per chiudere.
echo ===============================================
pause >nul
