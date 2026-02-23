create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.todo_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  due_date date,
  priority text not null default 'media' check (priority in ('bassa', 'media', 'alta')),
  is_done boolean not null default false,
  contact_id uuid null references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_todo_tasks_updated on public.todo_tasks;
create trigger trg_todo_tasks_updated
before update on public.todo_tasks
for each row execute function public.set_updated_at();

create index if not exists todo_tasks_is_done_idx
  on public.todo_tasks (is_done);

create index if not exists todo_tasks_due_date_idx
  on public.todo_tasks (due_date);

create index if not exists todo_tasks_contact_id_idx
  on public.todo_tasks (contact_id);
