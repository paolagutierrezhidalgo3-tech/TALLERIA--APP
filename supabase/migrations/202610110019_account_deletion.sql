-- Account deletion (pending item before the real pilot, found on 11
-- October 2026 while cleaning up the tests of 018). Deleting a Supabase
-- Auth account failed with "Database error deleting user" whenever the
-- account had accepted or sent an invitation: three references to
-- auth.users from 005 had no ON DELETE rule (NO ACTION), and
-- workshop_invitations.invited_by was also NOT NULL. In production that
-- blocked deleting either of its accounts.
--
-- This migration:
-- 1. turns those three references into history that survives the account:
--    workshop_members.invited_by, workshop_invitations.invited_by (no longer
--    NOT NULL) and workshop_invitations.accepted_by become NULL when the
--    referenced account is deleted (ON DELETE SET NULL). The constraint names
--    are the ones verified in production and TEST; they are dropped without
--    IF EXISTS on purpose, so an unexpected schema aborts the whole
--    migration instead of silently skipping a step. A staff account can then
--    be deleted: its own membership goes with it (workshop_members.user_id
--    was already ON DELETE CASCADE) and its accepted invitation stays as a
--    record with accepted_by NULL.
-- 2. refuses to delete the account of a workshop's OWNER while the workshop
--    exists. Without this, deleting the owner would cascade away the owner's
--    membership and leave the workshop -- with its customers' personal data
--    -- without anyone who can manage or erase it through the app (already
--    possible today for an owner who never invited anyone). The way to close
--    a workshop is to delete the workshop first (every table depending on
--    workshops is ON DELETE CASCADE) and then the account. The check runs in
--    a SECURITY DEFINER trigger function so it can read public tables
--    whichever role deletes the user (Supabase Auth uses its own role); it is
--    not executable by anon or authenticated, and as a trigger function it
--    cannot be called through the API anyway. Supabase Auth reports the
--    refusal to the caller as a generic "Database error deleting user"; the
--    message below appears in the database logs.
--
-- Effects on existing functions: none is changed. my_pending_invitation
-- joins the inviter (inner join), so an invitation whose inviter was deleted
-- is no longer shown -- only owners invite, and an owner can only be deleted
-- after their workshop, whose invitations go with it.
-- Recovery: drop the trigger and its function, and re-create the three
-- constraints with the default NO ACTION (restoring NOT NULL on
-- workshop_invitations.invited_by only if no row has it NULL by then).
begin;
-- Dropping and adding these constraints briefly locks workshop_members,
-- workshop_invitations and auth.users. If anything else holds those locks,
-- fail after 5 seconds (the whole migration rolls back) instead of queueing
-- behind it and stalling sign-ins in the meantime.
set local lock_timeout = '5s';

alter table public.workshop_members drop constraint workshop_members_invited_by_fkey;
alter table public.workshop_members add constraint workshop_members_invited_by_fkey
  foreign key (invited_by) references auth.users(id) on delete set null;

alter table public.workshop_invitations alter column invited_by drop not null;
alter table public.workshop_invitations drop constraint workshop_invitations_invited_by_fkey;
alter table public.workshop_invitations add constraint workshop_invitations_invited_by_fkey
  foreign key (invited_by) references auth.users(id) on delete set null;

alter table public.workshop_invitations drop constraint workshop_invitations_accepted_by_fkey;
alter table public.workshop_invitations add constraint workshop_invitations_accepted_by_fkey
  foreign key (accepted_by) references auth.users(id) on delete set null;

create function public.prevent_owner_account_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.workshop_members where user_id = old.id and role = 'owner') then
    raise exception 'No se puede borrar la cuenta del propietario de un taller mientras el taller exista. Elimina antes el taller (con todos sus datos) y después la cuenta.' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.prevent_owner_account_deletion() from public, anon, authenticated;

create trigger prevent_owner_account_deletion
  before delete on auth.users
  for each row execute function public.prevent_owner_account_deletion();

commit;
