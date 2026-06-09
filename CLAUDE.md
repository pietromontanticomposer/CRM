# CRM-next — Regole di lavoro (Claude)

Queste regole valgono SEMPRE su questo progetto, su Mac e su Windows.

## Modo di lavorare (Pietro, 2026-06-07)
1. Lavora sempre in **Ultracode** quando disponibile.
2. **Prima di modificare un file, ispeziona la struttura attuale.**
3. Preferisci **file completi aggiornati** ai frammenti parziali.
4. **Non rimuovere funzionalità esistenti** se non esplicitamente richiesto.
5. Spiega **solo i passi operativi** necessari. Niente papiri, italiano semplice
   (Pietro non è uno sviluppatore). Mai usare l'emoji 👁️.
6. **Collabora con Codex per ogni modifica/decisione importante**: trovate
   INSIEME la soluzione migliore. Flusso: proponi un approccio → fallo
   criticare/proporre alternative a Codex (`codex exec`, prompt via stdin) →
   sintetizza il meglio → implementa → fai **verificare a Codex** il risultato.
   Riporta a Pietro la conclusione condivisa, non il botta-e-risposta.
7. **Alla fine di OGNI messaggio** a Pietro, includi SEMPRE un blocco
   `📋 PROMPT DA INCOLLARE` con: stato attuale in 1 riga + prossimo passo +
   il puntatore ai file da leggere (`STATO.md`, `CONTINUA.md`, `CLAUDE.md`).
   Serve a NON perdere il filo tra una sessione e l'altra: se Claude riparte da
   zero, Pietro incolla quel prompt e si riprende esattamente da li'.
8. **All'inizio di ogni sessione su questo progetto, leggi PRIMA** `CONTINUA.md`
   e `STATO.md`: sono la fonte di verita'. Non ripartire da supposizioni.

## Vincoli del progetto (hard — non violare)
- **Outreach:** niente Groq da nessuna parte. Niente API a consumo per
  Writer/Validator/Research — SOLO le CLI locali `claude` + `codex`.
  Writer = `codex`. Doppio controllo = `claude` + `codex` (Gemini rimosso).
- **Nessuna email parte in automatico.** Nessun contenuto inventato: solo da
  fonti aperte e verificate.
- **FILE DA NON TOCCARE:** `src/app/api/gmail/send/route.ts`,
  `src/app/api/reminders/run/route.ts`,
  `src/app/api/scheduled-emails/send/route.ts`,
  `src/app/api/gmail/sync/route.ts`, `src/app/api/postmark/inbound/route.ts`,
  `src/lib/followUp.ts`.
- **Deploy** del sito Next: `vercel deploy --prod --yes`
  (produzione: alias `crm-smoky-eight.vercel.app`).
- **Commit/push** solo quando richiesto; chiudi i commit con
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Worker** locale: `local-worker/` (tsx). La concorrenza rete è auto-adattiva
  (semaforo CLI AIMD in `local-worker/agents/shared.ts`).
- **Canale Mac ↔ Windows:** `CLAUDE-SYNC.md` (segui le regole in cima al file).
