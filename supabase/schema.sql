create extension if not exists "pgcrypto";

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  company text,
  role text,
  status text not null default 'Da contattare',
  last_action_at date,
  last_action_note text,
  next_action_at date,
  next_action_note text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_contacts_updated on contacts;
create trigger trg_contacts_updated
before update on contacts
for each row execute function set_updated_at();

-- Optional: enable RLS and add policies only if you add auth.
-- alter table contacts enable row level security;
-- create policy "Allow read/write for authenticated users" on contacts
--   for all using (auth.role() = 'authenticated')
--   with check (auth.role() = 'authenticated');
