alter table if exists public.contacts
  add column if not exists ai_template_used text;

alter table if exists public.contacts
  add column if not exists ai_risk_score text;

alter table if exists public.contacts
  add column if not exists ai_generated_at timestamptz;

alter table if exists public.contacts
  drop constraint if exists contacts_ai_template_used_check;

alter table if exists public.contacts
  add constraint contacts_ai_template_used_check
  check (
    ai_template_used is null
    or ai_template_used in ('A', 'B', 'C')
  );

alter table if exists public.contacts
  drop constraint if exists contacts_ai_risk_score_check;

alter table if exists public.contacts
  add constraint contacts_ai_risk_score_check
  check (
    ai_risk_score is null
    or ai_risk_score in ('low', 'medium', 'high')
  );
