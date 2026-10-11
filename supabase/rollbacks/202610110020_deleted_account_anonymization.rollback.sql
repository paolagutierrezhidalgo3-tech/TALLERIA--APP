-- Rollback of 202610110020_deleted_account_anonymization.sql for the real
-- database ONLY. Never applied by tests or tooling: it lives outside
-- supabase/migrations on purpose. Apply only with explicit authorization,
-- through scripts/apply-migration.mjs, and BEFORE the rollback of 019 if
-- both are rolled back. It removes the anonymization trigger and its
-- function and restores accept_invitation exactly as in migration 018
-- (body md5 55619311670577261a02848ffa5ff1d8, the one production runs
-- before 020). Values already anonymized cannot be restored (by design).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

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

commit;
