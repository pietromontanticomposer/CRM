alter table if exists public.contacts
  add column if not exists ai_batch_id uuid;

alter table if exists public.contacts
  add column if not exists ai_batch_name text;

alter table if exists public.contacts
  add column if not exists ai_status text not null default 'not_checked';

alter table if exists public.contacts
  add column if not exists ai_email_subject text;

alter table if exists public.contacts
  add column if not exists ai_email_body text;

alter table if exists public.contacts
  add column if not exists verified_facts_json jsonb not null default '{}'::jsonb;

alter table if exists public.contacts
  add column if not exists source_link text;

alter table if exists public.contacts
  add column if not exists prompt_master_rules text;

alter table if exists public.contacts
  add column if not exists ai_agent_checks_json jsonb not null default '{}'::jsonb;

alter table if exists public.contacts
  add column if not exists ai_validation_summary text;

alter table if exists public.contacts
  add column if not exists ai_validation_status text not null default 'not_checked';

alter table if exists public.contacts
  drop constraint if exists contacts_ai_status_check;

alter table if exists public.contacts
  add constraint contacts_ai_status_check
  check (
    ai_status in (
      'not_checked',
      'imported',
      'draft_ready',
      'approved',
      'needs_review',
      'blocked',
      'error'
    )
  );

alter table if exists public.contacts
  drop constraint if exists contacts_ai_validation_status_check;

alter table if exists public.contacts
  add constraint contacts_ai_validation_status_check
  check (
    ai_validation_status in (
      'not_checked',
      'passed',
      'needs_review',
      'blocked',
      'error'
    )
  );

create index if not exists contacts_ai_batch_idx
  on public.contacts (ai_batch_id);

create index if not exists contacts_ai_status_idx
  on public.contacts (ai_status);

create index if not exists contacts_ai_validation_status_idx
  on public.contacts (ai_validation_status);

create table if not exists public.ai_outreach_agent_checks (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  batch_id uuid null,
  agent_name text not null,
  approved boolean not null default false,
  risk_level text not null default 'high',
  issues_json jsonb not null default '[]'::jsonb,
  raw_output text,
  created_at timestamptz not null default now()
);

alter table if exists public.ai_outreach_agent_checks
  drop constraint if exists ai_outreach_agent_checks_agent_name_check;

alter table if exists public.ai_outreach_agent_checks
  add constraint ai_outreach_agent_checks_agent_name_check
  check (agent_name in ('gemini', 'claude', 'codex'));

create index if not exists ai_outreach_agent_checks_contact_idx
  on public.ai_outreach_agent_checks (contact_id, created_at desc);

create index if not exists ai_outreach_agent_checks_batch_idx
  on public.ai_outreach_agent_checks (batch_id, created_at desc);
