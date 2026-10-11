-- Combined rollback of 202610110020_deleted_account_anonymization.sql and
-- 202610110019_account_deletion.sql for the real database ONLY, in ONE
-- transaction: either both are undone or nothing is (never 019 without
-- 020 anonymization, or 020 removed while 019 stays). Never applied by tests
-- or tooling: it lives outside supabase/migrations on purpose. Apply only
-- with explicit authorization, through scripts/apply-migration.mjs. Same
-- statements as the two separate rollback files, 020 first. It stops at
-- the start, changing nothing, if an invitation already lost its inviter
-- (invited_by NULL: NOT NULL could not be restored) -- decide first what to
-- do with those rows. Values already anonymized or references already
-- nulled cannot be restored. lock_timeout limits each lock wait and
-- statement_timeout each statement; production tables are tiny.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
  if exists (select 1 from public.workshop_invitations where invited_by is null) then
    raise exception 'Hay invitaciones sin invitador (invited_by NULL): no se puede restaurar NOT NULL. No se ha cambiado nada.';
  end if;
end $$;

-- 020
drop trigger anonymize_deleted_account on auth.users;
drop function public.anonymize_deleted_account();

-- accept_invitation, copied from 202610110018_invitations_confirmed_email.sql.
create or replace function public.accept_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz; inv record; existing uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_confirmed is null then raise exception 'Confirma tu correo electrónico antes de aceptar la invitación.' using errcode = 'P0001'; end if;
  select * into inv from public.workshop_invitations where id = p_invitation_id for update;
  if inv is null or inv.status <> 'pending' then raise exception 'La invitación ya no está disponible.'; end if;
  if inv.expires_at <= now() then raise exception 'La invitación ha caducado. Pide al propietario que envíe una nueva.'; end if;
  if v_email is null then raise exception 'Esta invitación es para otro correo.'; end if;
  if lower(v_email) <> inv.email then raise exception 'Esta invitación es para otro correo.'; end if;
  select workshop_id into existing from public.workshop_members where user_id = auth.uid();
  if existing is not null then raise exception 'Tu cuenta ya pertenece a un taller.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(inv.workshop_id::text, 2));
  if (select count(*) from public.workshop_members where workshop_id = inv.workshop_id) >= 20 then raise exception 'Este taller admite hasta 20 miembros.'; end if;
  insert into public.workshop_members(workshop_id, user_id, role, invited_by) values (inv.workshop_id, auth.uid(), 'staff', inv.invited_by);
  update public.workshop_invitations set status = 'accepted', accepted_at = now(), accepted_by = auth.uid() where id = p_invitation_id;
  update public.workshop_invitations set status = 'expired' where email = inv.email and status = 'pending' and id <> p_invitation_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id) values (inv.workshop_id, auth.uid(), 'member_joined', 'member', auth.uid());
  return inv.workshop_id;
end $$;
revoke all on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 019
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
