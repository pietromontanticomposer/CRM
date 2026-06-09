#!/bin/bash
# Launcher Mac del worker CRM — gemello di Avvia-CRM-Worker.bat (Windows).
# Stessi passi: 1) aggiorna da GitHub  2) dipendenze se servono  3) avvia worker.
cd "$(dirname "$0")" || { echo "Cartella del progetto non trovata."; read -n 1; exit 1; }

# Node via NVM (su Mac node sta dentro ~/.nvm, non nel PATH di default).
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

clear
echo "==============================================="
echo "   CRM Worker (Mac)"
echo "   Lascia questa finestra APERTA mentre lavori."
echo "   Prima di chiuderla, approva le mail buone."
echo "   Per FERMARE: chiudi la finestra."
echo "==============================================="
echo

if [ ! -f "package.json" ]; then
  echo "ERRORE: questo file deve stare DENTRO la cartella del progetto."
  read -n 1
  exit 1
fi

# --- 1. AGGIORNAMENTO AUTOMATICO da GitHub ---
echo "[1/3] Cerco aggiornamenti su GitHub..."
HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null)
git pull --ff-only
HEAD_AFTER=$(git rev-parse HEAD 2>/dev/null)

# --- 2. DIPENDENZE (solo se servono) ---
NEED_INSTALL=
[ ! -x "node_modules/.bin/tsx" ] && NEED_INSTALL=1
if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  git diff --name-only "$HEAD_BEFORE" "$HEAD_AFTER" 2>/dev/null | grep -q "package-lock.json" && NEED_INSTALL=1
fi
if [ -n "$NEED_INSTALL" ]; then
  if [ -d "node_modules" ] && [ ! -x "node_modules/.bin/tsx" ]; then
    echo "Rimuovo dipendenze incompatibili (erano per un altro sistema)..."
    rm -rf node_modules
  fi
  echo "[2/3] Aggiorno le dipendenze (la prima volta ci vogliono alcuni minuti)..."
  npm install
else
  echo "[2/3] Tutto aggiornato, nessuna nuova dipendenza."
fi
echo

# --- 3. AVVIO WORKER ---
echo "[3/3] Avvio del worker..."
echo
npm run outreach:worker

echo
echo "==============================================="
echo "   Worker FERMATO. Premi un tasto per chiudere."
echo "==============================================="
read -n 1
