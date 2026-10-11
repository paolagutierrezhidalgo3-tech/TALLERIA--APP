-- Rollback of 202610110019_account_deletion.sql for the real database
-- ONLY. Never applied by tests or tooling: it lives outside
-- supabase/migrations on purpose. Apply only with explicit authorization,
-- through scripts/apply-migration.mjs, and only AFTER the rollback of 020
-- if 020 is applied (020 depends on account deletion being possible). It
-- removes the owner guard and puts the references to auth.users and
-- workshop_invitations.invited_by back exactly as production had them before
-- 019 (read with pg_get_constraintdef on 11 October 2026). If any invitation
-- already has invited_by NULL (its inviter was deleted), SET NOT NULL fails
-- and the WHOLE rollback is undone: decide first what to do with those rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop trigger prevent_owner_account_deletion on auth.users;
drop function public.prevent_owner_account_deletion();

alter table public.workshop_members drop constraint workshop_members_invited_by_fkey;
alter table public.workshop_members add constraint workshop_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);

alter table public.workshop_invitations drop constraint workshop_invitations_invited_by_fkey;
alter table public.workshop_invitations add constraint workshop_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table public.workshop_invitations alter column invited_by set not null;

alter table public.workshop_invitations drop constraint workshop_invitations_accepted_by_fkey;
alter table public.workshop_invitations add constraint workshop_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id);

commit;
