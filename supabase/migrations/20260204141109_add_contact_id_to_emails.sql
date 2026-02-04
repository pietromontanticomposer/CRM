alter table if exists public.emails
  add column if not exists contact_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'emails_contact_id_fkey'
  ) then
    alter table public.emails
      add constraint emails_contact_id_fkey
      foreign key (contact_id) references public.contacts(id) on delete set null;
  end if;
end $$;

create index if not exists emails_contact_id_idx on public.emails (contact_id);
