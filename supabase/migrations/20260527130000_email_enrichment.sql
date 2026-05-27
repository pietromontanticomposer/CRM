-- Email enrichment metadata on contacts. All adds are idempotent.

alter table if exists public.contacts
  add column if not exists email_source_url text;

alter table if exists public.contacts
  add column if not exists email_source_type text;

alter table if exists public.contacts
  add column if not exists email_confidence numeric(3, 2);

alter table if exists public.contacts
  add column if not exists email_found_at timestamptz;

alter table if exists public.contacts
  add column if not exists email_enrichment_status text;

alter table if exists public.contacts
  add column if not exists email_enrichment_reason text;

alter table if exists public.contacts
  drop constraint if exists contacts_email_enrichment_status_check;

alter table if exists public.contacts
  add constraint contacts_email_enrichment_status_check
  check (
    email_enrichment_status is null
    or email_enrichment_status in (
      'not_needed',
      'pending',
      'found_public',
      'present',
      'needs_review',
      'not_found',
      'error'
    )
  );

create index if not exists contacts_email_enrichment_status_idx
  on public.contacts (email_enrichment_status);
