create table if not exists public.ai_classify_state (
  id int primary key,
  cursor_offset int not null default 0,
  updated_at timestamptz default now()
);

insert into public.ai_classify_state (id, cursor_offset)
values (1, 0)
on conflict (id) do nothing;
