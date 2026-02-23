do $$
declare
  constraint_name text;
begin
  if to_regclass('public.todo_tasks') is null then
    return;
  end if;

  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.todo_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%priority%'
  loop
    execute format(
      'alter table public.todo_tasks drop constraint %I',
      constraint_name
    );
  end loop;

  alter table public.todo_tasks
    add constraint todo_tasks_priority_check
    check (priority in ('bassa', 'media', 'alta', 'continuativo'));
end $$;
