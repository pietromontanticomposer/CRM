create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid null references public.contacts(id),
  direction text not null check (direction in ('inbound', 'outbound')),
  gmail_uid bigint,
  message_id_header text,
  in_reply_to text,
  "references" text,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  text_body text,
  html_body text,
  received_at timestamptz,
  raw jsonb,
  created_at timestamptz default now()
);

create unique index if not exists emails_gmail_uid_unique on public.emails (gmail_uid);
create index if not exists emails_message_id_idx on public.emails (message_id_header);
create index if not exists emails_from_email_idx on public.emails (from_email);
create index if not exists emails_contact_id_idx on public.emails (contact_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text,
  contact_id uuid null references public.contacts(id),
  email_id uuid null references public.emails(id),
  title text,
  body text null,
  is_read boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.gmail_state (
  id int primary key,
  last_uid bigint default 0,
  updated_at timestamptz default now()
);

insert into public.gmail_state (id, last_uid)
values (1, 0)
on conflict (id) do nothing;
