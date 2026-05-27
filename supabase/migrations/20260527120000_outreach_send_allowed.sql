-- Adds ai_send_allowed flag on contacts and per-agent validation flags on ai_outreach_agent_checks.
-- All adds are idempotent: safe to re-run on environments where columns may already exist.

alter table if exists public.contacts
  add column if not exists ai_send_allowed boolean not null default false;

create index if not exists contacts_ai_send_allowed_idx
  on public.contacts (ai_send_allowed);

alter table if exists public.ai_outreach_agent_checks
  add column if not exists contact_ok boolean not null default false;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists email_ok boolean not null default false;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists draft_ok boolean not null default false;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists send_allowed boolean not null default false;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists suggested_status text;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists failed boolean not null default false;
