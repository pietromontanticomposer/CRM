# CONTINUA — riprendi il progetto da qui (anti "perdere pezzi")

Questo file è la FOTO dello stato attuale. Claude lo legge SEMPRE a inizio
sessione. Pietro lo incolla se Claude riparte da zero. Aggiornarlo a ogni cambio
importante. Ultimo aggiornamento: 2026-06-11.

## Cos'è
crm-next: CRM per cold-email a registi di festival. Pietro carica un PDF di
registi sul sito → un "worker" locale (Mac/Windows) per ognuno cerca l'email,
scrive una mail personalizzata e la fa controllare → Pietro rivede e approva.
Pietro NON è sviluppatore: gli si consegna roba funzionante e già provata.

## Come si avvia (PARITÀ Mac/Windows — blindata 2026-06-11)
Due launcher GEMELLI nel repo, SOTTILI e stabili: fanno solo banner + `git pull
--ff-only`, poi passano la mano agli script interni SEMPRE freschi dopo il pull
(`scripts/mac-worker.sh` / `scripts/win-worker.cmd`: npm install se serve +
`npm run outreach:worker`). Motivo: prima il pull riscriveva il launcher MENTRE
girava (rischio file corrotto a metà esecuzione, soprattutto su Windows).
NOTA Windows: il PRIMO avvio dopo questo update può dare un errore strano (il
.bat vecchio si sostituisce mentre gira) → chiudere e riaprire UNA volta.
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

## RIFERIMENTI MUSICALI — ibrido AI+libreria verificata (2026-06-11, commit 09f4374)
I 3 esempi di colonna sonona nella mail NON li sceglie più l'AI a ruota libera
(erano dozzinali: Nomadland/Minari abusati, e rischio compositore sbagliato).
Ora: `local-worker/musicReferences.ts` = LIBRERIA di 16 colonne sonore VERIFICATE
(con `sourceUrl`, taggate per tono, non-cliché, **MODIFICA QUI per il tuo gusto**).
Il codice fa una shortlist per tono (scorer con tag pesati + soglia + penalità
energia); lo scrittore sceglie i 3 più adatti SOLO dalla shortlist (`music_ref_ids`);
il codice VALIDA (solo dalla shortlist, compositori diversi) e li inietta, altrimenti
fallback deterministico. Zero chiamate AI extra. Test 14/14. Provato: Federico →
I Daniel Blake/Capernaum/All That Breathes (sociale). LIMITE ONESTO (codex): tetto
"appropriato e professionale", NON il gusto esatto del regista (servirebbe ricerca
per-regista, evitata). Per renderli ESATTAMENTE tuoi: aggiungi le TUE colonne sonore
preferite nella libreria.

## Stato (2026-06-11) — REDESIGN DEFINITIVO: 5/5 registi TFF → Pronta
PRINCIPIO NUOVO: i controlli MECCANICI li fa il CODICE (istantaneo, sicuro),
le 2 AI (claude+codex) giudicano SOLO la veridicità del complimento. Niente più
AI lente che vanno in timeout o sbagliano conteggi. Le 7 cose risolte:
1. **Sinossi condivisa** scrittore+validatori (`film_synopsis` in verified_facts):
   il complimento è specifico e ancorato a una trama VERA, non si inventa.
2. **Recupero sinossi affidabile**: DDG (gratis) → se spazzatura, fallback
   `fetchFilmSynopsisViaClaude` (sonnet, web vero). `looksLikeNavChrome` scarta i
   MENU dei siti JS (festival/filmtv) che passavano per sinossi (navHits≥6 o >5%).
3. **Validatore = CONTENIMENTO, non ri-ricerca web**: verifica il complimento
   SOLO contro la sinossi fornita (non ri-cerca online) → veloce, niente timeout,
   niente falsi "non documentato". Web solo (facoltativo) per i 3 riferimenti
   musicali. (Cambio chiave: prima ri-cercava tutto online → lento + falsi blocchi.)
4. **Lunghezza**: gestita dal codice (`lintAndFixMailBody`): se >250 parole toglie
   i 3 titoli musicali → frase generica. NON è più motivo di blocco.
5. **Firma nella lingua del corpo**: auto-fix codice (mail EN che chiude "Un
   saluto," → "Best,"). NON è più motivo di blocco.
6. **Parole vietate**: rilevatore deterministico `findForbiddenInBody` (confini di
   parola: "proposta" IT non matcha "proposal" EN). Se il writer ne usa una vera →
   rigenera. Il validatore NON le controlla più (basta falsi match fuzzy).
7. **Coppia regista↔film = dato dell'import** (STEP 0-ter): il validatore NON
   boccia "nessuna fonte associa X al film Y" se Y è in `verified_facts.film`.
PROVATO: Federico Scienza + 5 registi reali TFF 2026 (Vescovo/Kossakovsky/Peedom/
Mizuno/Azzetti) → **5/5 Pronte**, complimenti specifici e veri, claude+codex ok,
ZERO timeout. selfcheck OK, transpile OK.
INFO VERIFICATE CORRETTE 5/5 (2026-06-11): ogni complimento controllato contro
fonti autorevoli indipendenti (Hollywood Reporter, Variety, IMDb, Cineuropa,
Visions du Réel, otroscines, cinemaitaliano, siti festival). Tutte le info trovate
sono CORRETTE. Il meccanismo produce complimenti fattualmente accurati.

FIX IMPORT + FINDER (2026-06-11, commit b59d48d, PUSHATO + DEPLOYATO) — scoperti
sul 1° batch reale (123 registi, PDF Trento FF 2026):
- Import NON spezza più i duo: "Zhang & Knight" resta UN contatto (prima → due
  righe inutili). `splitDirectors` splitta solo su virgola (`parseDirectorsPdf.ts`).
- Import SALTA la sezione OMAGGIO/retrospettiva (Pollack/Redford/Edwards, film
  1963-1998: non sono target, bruciavano quota). `HOMAGE_SECTION` in `parseDirectorsPdf.ts`.
- Finder cerca anche su Instagram bio / Linktree (fonte email per registi indie).
- IMPORTANTE: i fix import/OMAGGIO valgono per i PROSSIMI import; il finder-IG
  vale al PROSSIMO avvio worker (il batch in corso usa il codice vecchio).
OSSERVAZIONE 1° BATCH REALE: il collo di bottiglia NON è il contenuto (che è
risolto) ma l'EMAIL: molti registi non hanno email pubblica (verificato: Iván
Vescovo → solo produzione/Instagram). Tante "mail mancante" sono fisiologiche,
non un bug. Pronte = solo chi ha email pubblica trovabile.

INCIDENTE + FIX PERSISTENZA (2026-06-11, commit 1166c25, con codex, test 10/10):
- La cartella LOCALE del progetto si è svuotata (sync iCloud: DUE "Progetti Vari"
  sul Mac — attiva `Desktop/Progetti Vari/crm-next`, iCloud `Desktop/Scrivania -
  MacBook Pro di Pietro/Progetti Vari/crm-next`). Il worker è morto e la sua
  "pulizia alla chiusura" (`wipeAllDrafts` su SIGTERM/SIGHUP) ha CANCELLATO da
  Supabase l'intero batch di 123 registi.
- FIX DEFINITIVO: la chiusura del worker NON cancella più NULLA (rimosso
  wipeAllDrafts; SIGINT/SIGTERM/SIGHUP/deploy/sleep lasciano le bozze). TTL
  pulizia 2h → 30gg. Orfani "processing" ripresi dalla coda. Verificato dal test.
- RECUPERO fatto: codice ri-clonato da GitHub, `.env.local` ripreso dalla copia iCloud.
- DA FARE PIETRO: (1) ri-caricare il PDF sul sito per ricostruire il batch (import
  gratis, ora con TUTTI i fix: niente nomi spezzati, niente OMAGGIO, bozze che
  PERSISTONO); (2) spostare il progetto FUORI dal Desktop iCloud (o disattivare
  "Ottimizza spazio Mac") per non far più sparire la cartella.
CAVEAT ONESTI (non ancora blindati): (a) il sistema è STOCASTICO, non ho misurato
la stabilità su molte ripetizioni (prima dei fix Iván/Sayaka oscillavano); (b) se
un film non ha NESSUNA trama trovabile online, il complimento resta sul titolo o
va Scartato (onesto: non si inventa); (c) `looksLikeNavChrome` è euristico, non
perfetto; (d) test con email FINTE e senza PDF (l'uso reale col PDF è più facile).

## Limite reale (non bug)
Le email pubbliche dei registi spesso non esistono → confidence 0.4 → "da
rivedere", da confermare a mano. Non si inventano.

## Lezioni / NON rifare (2026-06-10)
- **Consumo = limiti d'ABBONAMENTO, non token.** claude e codex girano sul login
  dell'abbonamento (nessuna chiave API). Sui batch grossi (123) si esauriscono
  ENTRAMBI (codex visto esaurito "fino a Jun 11 22:36"). Non è un bug.
  Soluzioni reali: batch piccoli, oppure ChatGPT Pro / piano Claude più alto.
  Spostare carico tra le due NON aiuta: sono limitate entrambe.
- **TUTTI gli AI devono avere il WEB e verificare info aggiornate** (regola
  Pietro). Stato: claude (`--allowedTools WebSearch WebFetch`) e codex
  (`tools.web_search=true`) ce l'hanno. Ricerca email, scrittore, validatori: ok.
- **GEMINI scartato (testato 2026-06-10, NON riprovare):** la CLI `gemini -p`
  di default è SENZA web → boccia tutto ("nessuna fonte"). Con web (`--approval-mode
  yolo`) = **6 min per chiamata** + non capisce il template festival (boccia per
  "link visione mancante" quando per i festival il link NON c'è). Inusabile come
  validatore/ricerca. Buono SOLO come triage (13s) ma senza web viola la regola
  e non alleggerisce codex → non vale. **Pipeline = solo claude+codex.**

## 3 STATI — niente "da rivedere" (2026-06-10, regola Pietro)
"10 perfetti > 30 di merda". Sia info che email devono essere CERTE, zero dubbio.
- **Pronta** (`approved`) = email certa (presente + confidence ≥ 0.7) + tutti i
  validatori approvano → mail scritta, pronta da inviare.
- **Mail mancante** (`mail_mancante`) = regista valido ma email non trovata/non
  certa (0.4 indovinata) → NON scritta, NON cancellata; manca solo il contatto.
- **Scartata** (`blocked`) = i validatori hanno un dubbio reale sul contenuto.
- Validatore giù (tetto esaurito/rete) → `draft_ready` = RIPROVA (non scarta).
- Spazzatura del triage (non persona) → cancellata (non mostrata).
Backend+UI FATTI (2026-06-10): schermata revisione "formato idiota" — verdetto in
una riga (Pronta/Mail mancante/Scartata), filtri/conteggi a 3, via colori/gergo/
checklist/dettagli-tecnici/fonti/tier. Deployato. 23 unit ok, build ok.

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
Complimento specifico+verificato RISOLTO e provato (Federico → Pronta). Da
committare+pushare così i worker Mac e Windows lo prendono al prossimo avvio
(git pull). Poi: batch vero — avvia il worker ("Avvia CRM"/.bat), carica il PDF
sul sito, approva+invia i buoni. NON chiudere il worker finché non hai approvato
i buoni (la chiusura cancella le bozze non approvate). Da tenere d'occhio: la
sinossi via claude consuma un po' di quota in più (modello sonnet, economico) e
gira solo sulle bozze con email certa — sostenibile su batch piccoli.

## PROMPT DA INCOLLARE (se Claude perde il filo) — versione DETTAGLIATA
> **CHI SONO:** Pietro Montanti, compositore di colonne sonore a Verona, NON
> sviluppatore. Voglio cose funzionanti e GIÀ PROVATE da te, in italiano
> semplice, senza compiti tecnici a me e senza chiedermi cose che puoi decidere
> tu. Non dirmi "hai ragione" a vuoto: sii diretto, verifica prima di consegnare.
>
> **PROGETTO:** `crm-next` in `/Users/pietromontanti/crm-next` (SPOSTATO qui il
> 2026-06-11, FUORI dal Desktop iCloud che faceva sparire la cartella; le vecchie
> copie in `Desktop/Progetti Vari/crm-next` e `Desktop/Scrivania.../crm-next` sono
> STALE, da cestinare). Il launcher "Avvia CRM" sul Desktop punta a `~/crm-next`.
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
> **COME PARTE IL WORKER (si auto-aggiornano da GitHub, struttura blindata
> 2026-06-11):** Mac = doppio click "Avvia CRM" (Desktop) → `Avvia-CRM-Worker.command`
> → git pull → exec `scripts/mac-worker.sh` (deps se servono + worker). Windows =
> `Avvia-CRM-Worker.bat` → git pull → `scripts/win-worker.cmd`. I launcher sono
> sottili così il pull non li corrompe mentre girano. Primo avvio Windows dopo
> l'update: se dà errore strano, chiudere e riaprire UNA volta (transizione dal
> .bat vecchio). Launchd Mac disattivato (EPERM dal Desktop).
>
> **PIPELINE worker** (`local-worker/`, tsx): triage (claude) → ricerca email
> (claude+codex+web) → **recupero SINOSSI reale del film** (DuckDuckGo; se giù
> fallback col web di claude `fetchFilmSynopsisViaClaude`, modello sonnet) →
> scrittore (codex) → controlli MECCANICI nel CODICE (lunghezza, firma-lingua,
> parole-vietate: auto-fix/rigenera) → 2 validatori (claude+codex) → aggregate.
> REDESIGN DEFINITIVO 2026-06-11: i controlli meccanici li fa il codice; le AI
> giudicano SOLO la veridicità del complimento, controllandolo CONTRO la sinossi
> fornita (NON ri-cercano sul web → veloci, niente timeout). Sinossi: DDG → se
> spazzatura (menu siti JS, `looksLikeNavChrome`) fallback claude. Validatore:
> sinossi=FONTE (STEP 0-bis), coppia regista↔film=dato import (STEP 0-ter).
> PROVATO: Federico + 5 registi TFF 2026 → 5/5 Pronte, zero timeout.
> **MODELLI claude (2026-06-11):** validatore = **Opus 4.8** (`claude-opus-4-8`,
> il più forte — scelta Pietro, default nel codice + env `CLAUDE_VALIDATOR_MODEL`);
> triage + ricerca email = default account (più economico). Opus consuma molto
> di più ma gira solo sulle bozze con email certa (poche col gate conf≥0.7).
> Concorrenza auto-adattiva (semaforo AIMD in `agents/shared.ts`, max 4). Timeout
> scrittore 7 min con RETRY automatico (colonna `ai_attempts`). Bozze non
> approvate vivono in `outreach_drafts`. Il tasto "Approva e invia" salva il
> contatto in `contacts` E INVIA la mail (firma+CV, via /api/gmail/send, solo al
> click — non automatico); bulk = solo i confermati. Alla
> CHIUSURA VOLUTA del worker le bozze non approvate si cancellano; un CRASH invece
> NON le cancella più.
>
> **CONSUMO / AI / WEB:** claude e codex girano sul TUO abbonamento (NESSUNA chiave
> API a token). Sui batch grossi (123) si esauriscono ENTRAMBI (codex visto
> esaurito). NON è un bug: o batch piccoli o ChatGPT Pro / piano Claude più alto.
> Spostare carico tra i due non aiuta (limitati entrambi). TUTTI gli AI DEVONO
> avere il web e verificare info aggiornate: claude (`--allowedTools WebSearch
> WebFetch`) e codex (`tools.web_search=true`) ce l'hanno. GEMINI: TESTATO e
> SCARTATO (2026-06-10) — di default senza web boccia tutto, con web 6 min/chiamata
> e non capisce il template festival; NON ririntrodurlo. Pipeline = solo claude+codex.
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
> **3 STATI (niente "da rivedere", 2026-06-10):** Pronta (`approved`, email
> certa conf≥0.7 + validatori ok) / Mail mancante (`mail_mancante`, regista buono
> ma email non certa, non scritta) / Scartata (`blocked`, dubbio reale). Validatore
> giù→`draft_ready` (riprova). Backend + UI "formato idiota" FATTI e deployati.
>
> **STATO ATTUALE:** pipeline provata su 3 registi reali (apertura festival
> giusta, zero fonti nel corpo, lingua giusta, nessun crash). APPROVA = INVIA
> live e VERIFICATO: test invio a se stessi ok, la mail arriva con firma
> (foto `firma_pietro.png`) + CV allegato, via Gmail SMTP. Launcher Mac/Windows
> allineati (auto git pull). LIMITE REALE (non bug): le email pubbliche spesso
> non esistono → confidence ~0.4 → "da rivedere", da confermare a mano; non si
> inventano. Prossimo: far girare un batch vero dal sito.
>
> **COSA FARE:** dimmi dov'eravamo e il prossimo passo, poi PROCEDI e verifica tu
> prima di consegnarmi. AGGIORNA tu `CONTINUA.md` (e questo prompt) ogni volta che
> cambia qualcosa, così resta sempre vero. E chiudi OGNI tuo messaggio con questo
> prompt aggiornato.
