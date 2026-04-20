create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_users_email_lower_unique
  on public.app_users (lower(email));

drop trigger if exists trg_app_users_updated on public.app_users;
create trigger trg_app_users_updated
before update on public.app_users
for each row execute function public.set_updated_at();

alter table if exists public.contacts
  add column if not exists owner_id uuid null references public.app_users(id) on delete cascade;

alter table if exists public.emails
  add column if not exists owner_id uuid null references public.app_users(id) on delete cascade;

alter table if exists public.email_accounts
  add column if not exists owner_id uuid null references public.app_users(id) on delete cascade;

alter table if exists public.notifications
  add column if not exists owner_id uuid null references public.app_users(id) on delete cascade;

alter table if exists public.todo_tasks
  add column if not exists owner_id uuid null references public.app_users(id) on delete cascade;

create index if not exists contacts_owner_id_idx
  on public.contacts (owner_id);

create index if not exists emails_owner_id_idx
  on public.emails (owner_id);

create index if not exists email_accounts_owner_id_idx
  on public.email_accounts (owner_id);

create index if not exists notifications_owner_id_idx
  on public.notifications (owner_id);

create index if not exists todo_tasks_owner_id_idx
  on public.todo_tasks (owner_id);
