# STATO del progetto CRM-next — cosa va e cosa no

Registro permanente per NON ripartire da zero. Aggiornare qui ogni volta che si
verifica/rompe qualcosa. Ultima revisione: 2026-06-07.

## ✅ FUNZIONA (verificato dal vivo)
- **[2026-06-07 sera] Apertura festival**: con il campo "Festival" all'import,
  ogni mail apre con "Ho visto il suo (film) al 74° Trento Film Festival 2026 e
  ho provato ad avvicinarla…" — nome ESATTO (riconosciuto dal PDF), SOSTITUISCE
  "navigando online" (no doppia apertura), lingua giusta IT/EN. Verificato su 6
  registi reali.
- **[2026-06-07] Fonti mai nel corpo**: sanitizeMailBody (host vero) toglie
  URL/righe "Fonti" non della firma. Monitor su 12 eventi: ZERO fonti nel corpo.
- **[2026-06-07] Logica invio**: email confermata (78%, vista su pagina) →
  approved+inviabile; email incerta (40%) → needs_review non inviabile. Corretto.
- **[2026-06-07] Revisione Claude+Codex**: chiusi i fori (fonti-nel-corpo,
  approvazione di scartate/vuote, pulizia non verificata, send_allowed lasco,
  doppioni). Vincolo unico DB su contacts(owner,email) = doppioni impossibili.
- **Concorrenza rete auto-adattiva** (semaforo CLI AIMD): parte da 3, sale a 6 se
  la rete regge, dimezza a ogni intasamento (testato 3→6 e 6→3→1). Il worker ora
  lavora ~6 contatti in parallelo (prima 1).
- **Tier regista** (Sconosciuto/Emergente/Affermato/Big): assegnato dal materiale
  trovato (visti "affermato", "emergente").
- **Foto regista** best-effort: a volte trovata (es. Elettra Gallone); se manca o
  è rotta → iniziali. Non garantita.
- **Lingua giusta**: italiano per registi italiani ("Ammiro…"), inglese per
  stranieri.
- **Complimento specifico**, ricercato dal worker da solo (es. Iván: Iñaki /
  Patagonia).
- **"Link visione" fuori dal corpo** della mail (campo separato).
- **Fonti** in sezione separata "solo per te, NON inviata".
- **Personalizzazione per import** (campo visibile nell'import) collegata allo
  scrittore.
- **Anti-doppioni**: il DB rifiuta i doppioni + pulsante "Elimina importati oggi".
- **Auto-cancellazione** bozze non approvate alla chiusura del worker (testato).
- **Anti-invenzione**: i validatori bloccano i dettagli non documentati (es.
  "BMX/Abyss" segnalati) → la bozza va in revisione, non parte.
- **UI ripulita** dal gergo (no IMPORT/WRITER/3-AGENT, no send_allowed); verdetto
  in chiaro + cosa fare + checklist; dettagli tecnici sotto expander.
- **Fix Windows**: prompt Claude via STDIN (la shell di Windows tagliava il
  prompt passato come argomento — riprodotto e corretto).
- **Vincolo DB 'processing'** risolto.

## ⚠️ NON VA / APERTO
- **Velocità**: minuti per contatto → 123 = ore anche col parallelo (tetto = limiti
  dell'abbonamento CLI). Scelta: solo gratis.
- **Errori CLI sotto carico**: con molti in parallelo alcuni validatori
  (Claude/Codex) escono in errore → bozza con 1 controllore su 2 (non si perde, va
  in revisione). Il freno automatico NON reagisce a questi errori (segnale non
  collegato). FIX proposto, NON ancora fatto.
- **Email indovinate**: spesso `nome.cognome@gmail.com` a confidence ~0.4 → non
  verificate → needs_review, non auto-inviabili. Limite dei DATI, non dello
  scrittore. Vanno confermate a mano.
- **Foto**: trovata di rado. Spesso iniziali.
- **Windows**: prompt Claude via stdin dovrebbe funzionare; fix sandbox Codex
  (win32 = danger-full-access) è una PREVISIONE non verificata live. Da confermare
  col Claude di Windows.
- **Personalizzazione**: si imposta solo all'import; non si può (ancora) applicare
  a un batch già importato.

## 📌 DECISIONI FISSE
- Solo CLI locali gratis (`claude` + `codex`), niente API a consumo.
- Recall > velocità.
- Nessun invio automatico: Pietro approva tutto.
