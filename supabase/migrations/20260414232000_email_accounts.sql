create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null,
  provider text not null check (provider in ('gmail', 'outlook', 'imap')),
  email text not null,
  display_name text null,
  username text null,
  imap_host text null,
  imap_port integer not null default 993,
  imap_secure boolean not null default true,
  smtp_host text null,
  smtp_port integer null,
  smtp_secure boolean null,
  mailbox text null,
  password_encrypted text null,
  access_token_encrypted text null,
  refresh_token_encrypted text null,
  token_expires_at timestamptz null,
  oauth_scopes text[] not null default '{}',
  sync_enabled boolean not null default true,
  sync_status text not null default 'ready',
  last_uid bigint not null default 0,
  last_sync_at timestamptz null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_email_accounts_updated on public.email_accounts;
create trigger trg_email_accounts_updated
before update on public.email_accounts
for each row execute function set_updated_at();

create index if not exists email_accounts_provider_idx on public.email_accounts (provider);
create index if not exists email_accounts_email_idx on public.email_accounts (lower(email));
create index if not exists email_accounts_sync_enabled_idx on public.email_accounts (sync_enabled);

alter table public.emails
  add column if not exists email_account_id uuid null references public.email_accounts(id) on delete set null;

alter table public.emails
  add column if not exists provider text null;

alter table public.emails
  add column if not exists provider_uid text null;

update public.emails
set provider = coalesce(provider, 'gmail'),
    provider_uid = coalesce(provider_uid, gmail_uid::text)
where gmail_uid is not null;

drop index if exists emails_gmail_uid_unique;

create unique index if not exists emails_legacy_gmail_uid_unique
on public.emails (gmail_uid)
where email_account_id is null and gmail_uid is not null;

create unique index if not exists emails_account_provider_uid_unique
on public.emails (email_account_id, provider_uid)
where email_account_id is not null and provider_uid is not null;

create index if not exists emails_email_account_id_idx
on public.emails (email_account_id);
