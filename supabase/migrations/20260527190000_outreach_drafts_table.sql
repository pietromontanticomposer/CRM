-- outreach_drafts: contatti in limbo, NON ancora salvati nei contacts.
-- Vengono inseriti qui quando Pietro carica un PDF; il worker li processa
-- (enrichment + writer + 3-agent validation) e li tiene qui. Solo dopo
-- l'approvazione esplicita di Pietro nella batch view, una draft viene
-- promossa nei contacts. Reject = DELETE dalla tabella.

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  batch_id uuid not null,
  batch_name text not null,
  section text not null default 'cinema',
  -- identita' destinatario
  name text not null,
  email text,
  company text,
  role text default 'Regista',
  notes text,
  language text,
  source_link text,
  -- contesto per AI (include pdf_full_text)
  verified_facts_json jsonb not null default '{}'::jsonb,
  prompt_master_rules text,
  -- workflow status
  ai_status text not null default 'imported',
  ai_validation_status text not null default 'not_checked',
  -- output del writer
  ai_email_subject text,
  ai_email_body text,
  ai_template_used text,
  ai_link_visione text,
  ai_risk_score text,
  ai_risk_score_numeric numeric,
  ai_writer_reason text,
  ai_generated_at timestamptz,
  -- output dei validatori
  ai_agent_checks_json jsonb not null default '{}'::jsonb,
  ai_validation_summary text,
  ai_send_allowed boolean not null default false,
  -- enrichment email
  email_source_url text,
  email_source_type text,
  email_confidence numeric,
  email_enrichment_status text,
  email_enrichment_reason text,
  email_found_at timestamptz,
  -- timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.outreach_drafts
  drop constraint if exists outreach_drafts_ai_status_check;

alter table if exists public.outreach_drafts
  add constraint outreach_drafts_ai_status_check
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

alter table if exists public.outreach_drafts
  drop constraint if exists outreach_drafts_ai_validation_status_check;

alter table if exists public.outreach_drafts
  add constraint outreach_drafts_ai_validation_status_check
  check (
    ai_validation_status in (
      'not_checked',
      'passed',
      'needs_review',
      'blocked',
      'error'
    )
  );

create index if not exists outreach_drafts_owner_idx
  on public.outreach_drafts (owner_id);

create index if not exists outreach_drafts_batch_idx
  on public.outreach_drafts (batch_id);

create index if not exists outreach_drafts_ai_status_idx
  on public.outreach_drafts (ai_status);

-- L'audit table degli agenti deve poter puntare a una draft OPPURE a un contact
-- A questo punto non rompiamo la FK esistente: il worker, quando lavora sulle
-- drafts, scrivera' batch_id (gia' esistente) ma lascera' contact_id NULL.
-- Rendiamo contact_id nullable.
alter table if exists public.ai_outreach_agent_checks
  alter column contact_id drop not null;

alter table if exists public.ai_outreach_agent_checks
  add column if not exists draft_id uuid references public.outreach_drafts(id) on delete cascade;

create index if not exists ai_outreach_agent_checks_draft_idx
  on public.ai_outreach_agent_checks (draft_id, created_at desc);
