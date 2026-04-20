create table if not exists public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  contact_id uuid null references public.contacts(id) on delete set null,
  email_account_id uuid null references public.email_accounts(id) on delete set null,
  to_email text not null,
  subject text null,
  text_body text null,
  html_body text null,
  reply_to_email_id uuid null,
  notification_kind text null,
  send_at date not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz null,
  error text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_emails_send_at
  on public.scheduled_emails (send_at)
  where status = 'pending';

create index if not exists idx_scheduled_emails_owner
  on public.scheduled_emails (owner_id, status);
