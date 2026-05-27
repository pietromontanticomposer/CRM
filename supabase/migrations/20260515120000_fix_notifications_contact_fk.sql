-- The original notifications.contact_id foreign key had no ON DELETE action,
-- so deleting a contact with any notification attached failed with a FK
-- violation. Recreate the constraint with ON DELETE CASCADE so notifications
-- are removed together with their contact. Same treatment for email_id, which
-- had the same problem when an email row was deleted.

alter table if exists public.notifications
  drop constraint if exists notifications_contact_id_fkey;

alter table if exists public.notifications
  add constraint notifications_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete cascade;

alter table if exists public.notifications
  drop constraint if exists notifications_email_id_fkey;

alter table if exists public.notifications
  add constraint notifications_email_id_fkey
  foreign key (email_id) references public.emails(id) on delete cascade;
