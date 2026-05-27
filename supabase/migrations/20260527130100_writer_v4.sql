-- Writer v4.0: estensione template + risk_score numerico + link visione + reason.

alter table if exists public.contacts
  drop constraint if exists contacts_ai_template_used_check;

alter table if exists public.contacts
  add constraint contacts_ai_template_used_check
  check (
    ai_template_used is null
    or ai_template_used in ('A', 'B', 'C', 'C_TEAM', 'NOT_READY')
  );

alter table if exists public.contacts
  add column if not exists ai_risk_score_numeric numeric(3, 2);

alter table if exists public.contacts
  add column if not exists ai_link_visione text;

alter table if exists public.contacts
  add column if not exists ai_writer_reason text;
