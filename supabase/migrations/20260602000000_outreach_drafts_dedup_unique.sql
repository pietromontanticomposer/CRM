-- Blindatura anti-doppioni (Pietro, 2026-06-02).
-- Rende IMPOSSIBILE a livello di database inserire due contatti outreach con
-- lo stesso proprietario e lo stesso nome (ignorando maiuscole/minuscole e
-- spazi iniziali/finali). Anche con import concorrenti o doppio invio, il DB
-- rifiuta il secondo inserimento con errore 23505 (unique_violation).
-- Il codice (src/app/api/contacts/route.ts) tratta quel 409/23505 come
-- "doppione saltato" e prosegue l'import senza interromperlo.
create unique index if not exists outreach_drafts_owner_lname_uniq
  on public.outreach_drafts (owner_id, lower(btrim(name)))
  where name is not null and btrim(name) <> '';
