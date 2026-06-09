# CONTINUA — riprendi il progetto da qui (anti "perdere pezzi")

Questo file è la FOTO dello stato attuale. Claude lo legge SEMPRE a inizio
sessione. Pietro lo incolla se Claude riparte da zero. Aggiornarlo a ogni cambio
importante. Ultimo aggiornamento: 2026-06-09.

## Cos'è
crm-next: CRM per cold-email a registi di festival. Pietro carica un PDF di
registi sul sito → un "worker" locale (Mac/Windows) per ognuno cerca l'email,
scrive una mail personalizzata e la fa controllare → Pietro rivede e approva.
Pietro NON è sviluppatore: gli si consegna roba funzionante e già provata.

## Come si avvia (entrambi si auto-aggiornano da GitHub all'avvio)
- **Windows:** doppio click su `Avvia-CRM-Worker.bat` (fa `git pull` + `npm install` se serve + avvia).
- **Mac:** doppio click su `Avvia CRM` (sul Desktop) — fa `git pull` + avvia.
  (Il vecchio servizio automatico Mac `com.pietro.crm-worker` è DISATTIVATO:
  era rotto, macOS blocca i background dalla cartella Desktop — EPERM.)
- **Sito:** già online su `crm-smoky-eight.vercel.app`. Deploy: `vercel deploy --prod --yes`.

## Stato (2026-06-09) — VERSIONE DEFINITIVA verificata end-to-end
Provata dal vivo su 3 registi reali del PDF Trento: apertura festival giusta dal
PDF, zero fonti nel corpo (fonti in sezione separata NON inviata), lingua giusta
IT/EN, stato corretto (email indovinata 0.4 → "da rivedere", non parte), nessun
crash. Robustezza: retry sui timeout scrittore; carico CLI ridotto (4 non 6);
un CRASH non cancella più il lavoro (solo la chiusura VOLUTA svuota). tsc 0
errori, 23 test unit ok. DB pulito (0 bozze).

## Limite reale (non bug)
Le email pubbliche dei registi spesso non esistono → confidence 0.4 → "da
rivedere", da confermare a mano. Non si inventano.

## Vincoli HARD (non violare)
- Outreach: SOLO CLI locali `claude` + `codex`. Niente Groq, niente API a
  consumo (Writer/Validator/Research). Writer = codex.
- Nessuna email parte in automatico. Nessun contenuto inventato.
- FILE DA NON TOCCARE: `src/app/api/gmail/send/route.ts`,
  `src/app/api/reminders/run/route.ts`, `src/app/api/scheduled-emails/send/route.ts`,
  `src/app/api/gmail/sync/route.ts`, `src/app/api/postmark/inbound/route.ts`,
  `src/lib/followUp.ts`.
- Commit chiusi con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Prossimo passo
Far girare un batch vero dal sito (Pietro carica il PDF, lascia il worker
acceso, approva le buone). Audit completo dell'app in corso per blindare questo
file (workflow `audit-stato-crm`).

## PROMPT DA INCOLLARE (se Claude perde il filo)
> Progetto `crm-next` in `/Users/pietromontanti/Desktop/Progetti Vari/crm-next`.
> Leggi PRIMA `CONTINUA.md`, `STATO.md`, `CLAUDE.md` e NON ripartire da
> supposizioni. Sono Pietro, non sviluppatore: dammi cose funzionanti e già
> provate da te, niente compiti tecnici a me. Vincoli: solo CLI locali
> claude+codex (no Groq/API a consumo), nessun invio automatico, non toccare i
> file gmail/scheduled-send. Worker: Mac = "Avvia CRM", Windows =
> Avvia-CRM-Worker.bat (entrambi git pull all'avvio). Dimmi dove eravamo e il
> prossimo passo, poi procedi e verifica tu prima di consegnarmi.
