create extension if not exists pg_trgm;

create table if not exists public.contact_email_sync_state (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email_account_key text not null,
  email_hash text not null,
  last_sync_at timestamptz not null default now(),
  last_cursor bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_contact_email_sync_state_updated
  on public.contact_email_sync_state;
create trigger trg_contact_email_sync_state_updated
before update on public.contact_email_sync_state
for each row execute function public.set_updated_at();

create unique index if not exists contact_email_sync_state_unique_idx
  on public.contact_email_sync_state
  (owner_key, contact_id, email_account_key, email_hash);

create index if not exists contact_email_sync_state_lookup_idx
  on public.contact_email_sync_state
  (owner_key, contact_id, email_account_key, last_sync_at desc);

create index if not exists emails_owner_contact_received_idx
  on public.emails (owner_id, contact_id, received_at desc);

create index if not exists emails_legacy_contact_received_idx
  on public.emails (contact_id, received_at desc)
  where owner_id is null;

create index if not exists emails_owner_account_provider_uid_idx
  on public.emails (owner_id, email_account_id, provider_uid);

create index if not exists emails_owner_gmail_uid_idx
  on public.emails (owner_id, gmail_uid);

create index if not exists emails_from_email_trgm_idx
  on public.emails using gin (lower(from_email) gin_trgm_ops);

create index if not exists emails_to_email_trgm_idx
  on public.emails using gin (lower(to_email) gin_trgm_ops);

create index if not exists notifications_owner_type_created_idx
  on public.notifications (owner_id, type, created_at desc);

create index if not exists contacts_owner_updated_idx
  on public.contacts (owner_id, updated_at desc);
