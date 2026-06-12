#!/bin/bash
# Launcher Mac del worker CRM — gemello di Avvia-CRM-Worker.bat (Windows).
# Passi: 1) aggiorna da GitHub  2) passa la mano a scripts/mac-worker.sh
# (SEMPRE fresco dopo il pull: dipendenze se servono + avvio worker).
# "exec" = questo file smette di essere letto dopo il pull, cosi' un
# auto-aggiornamento non puo' corromperlo mentre gira.
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

echo "[1/3] Cerco aggiornamenti su GitHub..."
HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null)
git pull --ff-only
exec bash "scripts/mac-worker.sh" "$HEAD_BEFORE"
