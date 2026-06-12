#!/bin/bash
# Parte DOPO il "git pull" del launcher (Avvia-CRM-Worker.command), quindi
# questo file e' SEMPRE la versione piu' fresca presa da GitHub.
# Argomento $1 = commit HEAD prima del pull (per capire se servono dipendenze).
cd "$(dirname "$0")/.." || { echo "Cartella progetto non trovata."; read -n 1; exit 1; }

HEAD_BEFORE="$1"
HEAD_AFTER=$(git rev-parse HEAD 2>/dev/null)

# --- DIPENDENZE (solo se servono) ---
NEED_INSTALL=
[ ! -x "node_modules/.bin/tsx" ] && NEED_INSTALL=1
if [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
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

# --- AVVIO WORKER ---
echo "[3/3] Avvio del worker..."
echo
npm run outreach:worker

echo
echo "==============================================="
echo "   Worker FERMATO. Premi un tasto per chiudere."
echo "==============================================="
read -n 1
