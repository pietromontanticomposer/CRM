-- Add `section` (cinema | live_music) to contacts and propagate it to
-- notifications and scheduled_emails via a BEFORE INSERT trigger so existing
-- insert paths don't need changes.

alter table if exists public.contacts
  add column if not exists section text not null default 'cinema';

alter table if exists public.contacts
  drop constraint if exists contacts_section_check;

alter table if exists public.contacts
  add constraint contacts_section_check
  check (section in ('cinema', 'live_music'));

create index if not exists contacts_owner_section_idx
  on public.contacts (owner_id, section);

alter table if exists public.notifications
  add column if not exists section text not null default 'cinema';

alter table if exists public.notifications
  drop constraint if exists notifications_section_check;

alter table if exists public.notifications
  add constraint notifications_section_check
  check (section in ('cinema', 'live_music'));

create index if not exists notifications_owner_section_idx
  on public.notifications (owner_id, section);

alter table if exists public.scheduled_emails
  add column if not exists section text not null default 'cinema';

alter table if exists public.scheduled_emails
  drop constraint if exists scheduled_emails_section_check;

alter table if exists public.scheduled_emails
  add constraint scheduled_emails_section_check
  check (section in ('cinema', 'live_music'));

create index if not exists scheduled_emails_owner_section_idx
  on public.scheduled_emails (owner_id, section);

create or replace function public.set_section_from_contact()
returns trigger as $$
declare
  contact_section text;
begin
  if new.contact_id is not null then
    select section into contact_section from public.contacts where id = new.contact_id;
    if contact_section is not null then
      new.section := contact_section;
    end if;
  end if;
  if new.section is null then
    new.section := 'cinema';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notifications_section on public.notifications;
create trigger trg_notifications_section
before insert on public.notifications
for each row execute function public.set_section_from_contact();

drop trigger if exists trg_scheduled_emails_section on public.scheduled_emails;
create trigger trg_scheduled_emails_section
before insert on public.scheduled_emails
for each row execute function public.set_section_from_contact();
