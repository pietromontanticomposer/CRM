create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid null references public.contacts(id) on delete cascade,
  thread_key text not null,
  summary text not null,
  last_email_at timestamptz null,
  model text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists conversation_summaries_contact_thread_idx
  on public.conversation_summaries (contact_id, thread_key);

create index if not exists conversation_summaries_updated_at_idx
  on public.conversation_summaries (updated_at);
