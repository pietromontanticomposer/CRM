# Repository Workflow

- OBBLIGATORIO: dopo ogni modifica completata va sempre eseguito il deploy in produzione.
- Dopo ogni modifica a codice o configurazione, valida il risultato con i controlli rilevanti.
- Per modifiche CRM, esegui sempre `npm run verify` e uno smoke test reale della funzione toccata prima di chiudere.
- NON modificare mai l'obbligo di includere foto/firma `firma_pietro.png` e CV `Curriculum Pietro Montanti.pdf` in follow-up e mantenimento rapporto, a meno che Pietro lo chieda espressamente.
- Se la modifica e' corretta, fai sempre `git commit`.
- Subito dopo il commit, fai sempre deploy in produzione con `vercel deploy --prod --yes`.
- Non lasciare modifiche completate non committate o non deployate, a meno che l'utente chieda esplicitamente di non farlo.
