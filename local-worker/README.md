# Local Worker AI Director Outreach

Questo worker gira solo in locale. Non usa Vercel e non usa API a consumo per i tre controlli di validazione: chiama direttamente le CLI installate `gemini`, `claude` e `codex`, poi salva gli esiti su Supabase.

## Prerequisiti

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- CLI disponibili nel `PATH` e gia autenticate:
  - `gemini`
  - `claude`
  - `codex`
- dependencies del progetto installate con `npm install`
- migration Supabase applicata: `supabase/migrations/20260526120000_ai_director_outreach_validation.sql`

## Avvio

Esegui una singola passata:

```bash
npm run outreach:worker -- --once
```

Esegui in polling continuo:

```bash
npm run outreach:worker
```

## Variabili opzionali

- `OUTREACH_WORKER_BATCH_SIZE`
  Default: `10`
- `OUTREACH_WORKER_POLL_MS`
  Default: `15000`
- `GEMINI_MODEL`
- `CLAUDE_MODEL`
- `CODEX_MODEL`

## Flusso

Il worker legge `contacts` con:

- `ai_status = imported`
- `ai_status = draft_ready`

Per ogni contatto:

1. verifica che esistano `ai_email_subject` e `ai_email_body`
2. promuove `imported -> draft_ready` se la bozza e presente
3. invia lo stesso packet ai tre agenti CLI
4. persiste gli audit in `ai_outreach_agent_checks`
5. aggiorna `contacts.ai_agent_checks_json`
6. aggiorna `contacts.ai_validation_status`
7. aggiorna `contacts.ai_status`

## Packet inviato agli agenti

```json
{
  "contact_data": {},
  "verified_facts_json": {},
  "draft_subject": "",
  "draft_body": "",
  "source_link": "",
  "prompt_master_rules": ""
}
```

## Import batch dalla UI

La UI di import accetta un array JSON. Esempio minimo:

```json
[
  {
    "name": "Nome Regista",
    "email": "regista@example.com",
    "company": "Casa di produzione",
    "role": "Regista",
    "draftSubject": "Oggetto approvando",
    "draftBody": "Testo bozza outreach",
    "sourceLink": "https://example.com/work",
    "verifiedFactsJson": {
      "film": "Titolo",
      "festival": "Locarno"
    },
    "promptMasterRules": "Usa il lei, niente superlativi, massimo 120 parole."
  }
]
```

Se `ai_email_subject` o `ai_email_body` mancano, il worker non inventa una bozza: il contatto viene marcato `error` per evitare output non controllati.
