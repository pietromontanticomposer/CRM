# CONTINUA — riprendi il progetto da qui (anti "perdere pezzi")

Questo file è la FOTO dello stato attuale. Claude lo legge SEMPRE a inizio
sessione. Pietro lo incolla se Claude riparte da zero. Aggiornarlo a ogni cambio
importante. Ultimo aggiornamento: 2026-06-09.

## Cos'è
crm-next: CRM per cold-email a registi di festival. Pietro carica un PDF di
registi sul sito → un "worker" locale (Mac/Windows) per ognuno cerca l'email,
scrive una mail personalizzata e la fa controllare → Pietro rivede e approva.
Pietro NON è sviluppatore: gli si consegna roba funzionante e già provata.

## Come si avvia (PARITÀ Mac/Windows — verificata 2026-06-09)
Due launcher GEMELLI nel repo (quindi anche la logica di avvio si auto-aggiorna).
Stessi 3 passi: 1) `git pull --ff-only` 2) `npm install` solo se serve (tsx
mancante o package-lock cambiato) 3) `npm run outreach:worker`.
- **Windows:** doppio click su `Avvia-CRM-Worker.bat`.
- **Mac:** doppio click su `Avvia CRM` (Desktop) — è una scorciatoia che chiama
  `Avvia-CRM-Worker.command` nel repo. Se la scorciatoia si perde, ricreala con:
  `cd "<repo>" && exec bash "./Avvia-CRM-Worker.command"`.
- Mac verificato dal vivo (pull→dipendenze→worker in polling); parità confermata
  con Codex. Windows NON eseguibile da qui: la logica è identica al Mac, ma la
  conferma 100% va fatta sul PC Windows (vedi CLAUDE-SYNC: aperto il caso Claude
  CLI exit 1 su Windows, separato dal launcher).
- Il vecchio servizio automatico Mac `com.pietro.crm-worker` è DISATTIVATO
  (`.plist.disabled`): era rotto, macOS blocca i background dal Desktop (EPERM).
- **Sito:** online su `crm-smoky-eight.vercel.app`. Deploy: `vercel deploy --prod --yes`.

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

## Invio mail — APPROVA = SALVA + INVIA (2026-06-09)
Nella schermata di revisione il tasto **"Approva e invia"** salva il contatto in
`contacts` E invia subito la mail (con firma `firma_pietro.png` + CV allegato).
Tecnica: `promoteDraft` in OutreachBatchClient chiama `/approve` poi
`/api/gmail/send` (NON toccato; aggiunge firma+CV e programma il follow-up).
NON è invio automatico: parte SOLO quando Pietro clicca. Il bulk
"Approva e invia i sicuri" manda SOLO i confermati (status `approved`, email
sicura); i `needs_review` (email indovinata) si approvano/inviano uno a uno.
Ogni mail allega anche il CV PDF (comportamento attuale di gmail/send).

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
INVIO VERIFICATO (test a se stessi ok: firma + CV arrivati). Ora: far girare un
batch vero — avvia il worker ("Avvia CRM"/.bat), carica il PDF sul sito, e man
mano approva+invia i buoni. NON chiudere il worker finché non hai approvato i
buoni (la chiusura cancella le bozze non approvate).

## PROMPT DA INCOLLARE (se Claude perde il filo) — versione DETTAGLIATA
> **CHI SONO:** Pietro Montanti, compositore di colonne sonore a Verona, NON
> sviluppatore. Voglio cose funzionanti e GIÀ PROVATE da te, in italiano
> semplice, senza compiti tecnici a me e senza chiedermi cose che puoi decidere
> tu. Non dirmi "hai ragione" a vuoto: sii diretto, verifica prima di consegnare.
>
> **PROGETTO:** `crm-next` in `/Users/pietromontanti/Desktop/Progetti Vari/crm-next`.
> CRM per cold-email a registi di festival. Io carico un PDF di registi sul sito →
> un "worker" locale, per ogni regista, cerca l'email pubblica, scrive una mail
> personalizzata e la fa controllare da 2 validatori → io rivedo e approvo. GitHub
> PUBBLICO `github.com/pietromontanticomposer/CRM.git`. Supabase (ref
> `byrwtovxttvuhqsmwzpx`). Sito su Vercel: `crm-smoky-eight.vercel.app`
> (deploy `vercel deploy --prod --yes`).
>
> **PRIMA DI TUTTO:** leggi `CONTINUA.md`, `STATO.md`, `CLAUDE.md`, `CLAUDE-SYNC.md`
> nel repo. NON ripartire da supposizioni: lì c'è la verità.
>
> **COME PARTE IL WORKER (si auto-aggiornano da GitHub):** Mac = doppio click su
> "Avvia CRM" (sul Desktop, fa git pull + avvia); Windows = doppio click su
> `Avvia-CRM-Worker.bat` (git pull + npm install se serve + avvia). Il vecchio
> servizio automatico Mac (launchd `com.pietro.crm-worker`) è DISATTIVATO perché
> rotto (macOS blocca i background dal Desktop, EPERM).
>
> **PIPELINE worker** (`local-worker/`, tsx): triage (claude) → ricerca email
> (claude+codex) → scrittore (codex) → 2 validatori (claude+codex) → aggregate.
> Concorrenza auto-adattiva (semaforo AIMD in `agents/shared.ts`, max 4). Timeout
> scrittore 7 min con RETRY automatico (colonna `ai_attempts`). Bozze non
> approvate vivono in `outreach_drafts`. Il tasto "Approva e invia" salva il
> contatto in `contacts` E INVIA la mail (firma+CV, via /api/gmail/send, solo al
> click — non automatico); bulk = solo i confermati. Alla
> CHIUSURA VOLUTA del worker le bozze non approvate si cancellano; un CRASH invece
> NON le cancella più.
>
> **VINCOLI HARD (non violare):** Outreach SOLO con CLI locali `claude`+`codex`
> (Writer=codex; doppio check claude+codex). NIENTE Groq, NIENTE API a pagamento
> per Writer/Validator/Research. Nessuna email parte in automatico. Niente
> contenuti inventati: solo da fonti aperte e verificate. FILE DA NON TOCCARE:
> `src/app/api/gmail/send/route.ts`, `src/app/api/reminders/run/route.ts`,
> `src/app/api/scheduled-emails/send/route.ts`, `src/app/api/gmail/sync/route.ts`,
> `src/app/api/postmark/inbound/route.ts`, `src/lib/followUp.ts`. Commit chiusi
> con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
>
> **BATCH FESTIVAL:** all'import, nel campo "Festival" (si riempie da solo dal PDF)
> ogni mail apre con "ho visto il suo (film) al (festival) e ho provato ad
> avvicinarla ma non ci sono riuscito" al posto di "navigando online". Le fonti
> vanno in sezione SEPARATA, mai nel corpo della mail.
>
> **STATO ATTUALE:** versione definitiva provata end-to-end su 3 registi reali del
> PDF Trento (apertura festival giusta, zero fonti nel corpo, lingua giusta,
> "da rivedere" per email indovinate a bassa confidenza, nessun crash). LIMITE
> REALE (non bug): le email pubbliche spesso non esistono → confidence ~0.4 → "da
> rivedere", da confermare a mano; non si inventano.
>
> **COSA FARE:** dimmi dov'eravamo e il prossimo passo, poi PROCEDI e verifica tu
> prima di consegnarmi. AGGIORNA tu `CONTINUA.md` (e questo prompt) ogni volta che
> cambia qualcosa, così resta sempre vero. E chiudi OGNI tuo messaggio con questo
> prompt aggiornato.
