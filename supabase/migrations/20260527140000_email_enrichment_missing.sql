-- Allow "missing" as a transient status before enrichment runs.

alter table if exists public.contacts
  drop constraint if exists contacts_email_enrichment_status_check;

alter table if exists public.contacts
  add constraint contacts_email_enrichment_status_check
  check (
    email_enrichment_status is null
    or email_enrichment_status in (
      'not_needed',
      'pending',
      'missing',
      'found_public',
      'present',
      'needs_review',
      'not_found',
      'error'
    )
  );
