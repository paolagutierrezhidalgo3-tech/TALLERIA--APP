-- Brings two invitation functions in the real database in line with the
-- repository. The 005 file was corrected after it had been applied to
-- production, so production still runs earlier versions of:
-- - invite_member: locks the workshop row FOR UPDATE, which conflicts with
--   the FOR KEY SHARE lock that accept_invitation's member insert takes on
--   that same row through the foreign key, so inviting and accepting at the
--   same moment can deadlock; it never turns stale pending invitations into
--   'expired', so they keep counting towards the 20-pending limit; and it
--   answers with one generic message for "already a member here" and
--   "member of another workshop".
-- - revoke_invitation: reads the invitation without locking it and then
--   updates it by id, so revoking at the same moment as the invitee accepts
--   can turn an already accepted invitation back into 'revoked' while the
--   membership stays; it has no specific message for an accepted invitation.
-- This migration redefines both with exactly the bodies of the 005 file
-- (the versions every test, TEST and migrations 018-020 assume). Same
-- signatures, return types, security definer, search_path and grants. It
-- changes no data and no other function. Not included on purpose:
-- create_workshop (differs only in the encoding of the accent of a message
-- that the app cannot trigger: it is only raised without a signed-in user,
-- and anon cannot execute the function) and remove_member (differs only in
-- comments). It does not depend on 019 or 020 and touches nothing they
-- define, so it can be applied before or after them.
-- Recovery: supabase/rollbacks/202610110021_sync_invitation_functions.rollback.sql
-- re-creates the two previous production definitions; no data to restore.
begin;
set local lock_timeout = '5s';

create or replace function public.invite_member(p_workshop_id uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; v_email text := lower(trim(p_email)); v_id uuid; existing_user uuid;
begin
  select role into actor_role from public.workshop_members where workshop_id = p_workshop_id and user_id = auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  if actor_role <> 'owner' then raise exception 'Solo el propietario puede invitar miembros.'; end if;
  -- FOR NO KEY UPDATE, not FOR UPDATE: this still serializes concurrent
  -- invite_member calls against each other (both modes conflict with
  -- themselves), but FOR UPDATE would also conflict with the FOR KEY SHARE
  -- lock Postgres takes on this same workshops row to satisfy the
  -- workshop_members.workshop_id foreign key when accept_invitation inserts
  -- a member. Holding FOR UPDATE here while accept_invitation holds the
  -- invitation row (from its own `for update` select) creates a lock-order
  -- cycle -- this function waiting on that invitation row via the upsert
  -- below, accept_invitation waiting on this workshops row via the FK check
  -- -- which Postgres's deadlock detector resolves by aborting one side.
  -- FOR NO KEY UPDATE doesn't conflict with FOR KEY SHARE, so it can't
  -- participate in that cycle.
  perform 1 from public.workshops where id = p_workshop_id for no key update;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 255 then raise exception 'Introduce un correo válido.'; end if;
  if exists(select 1 from public.workshop_members m join auth.users u on u.id = m.user_id where m.workshop_id = p_workshop_id and lower(u.email) = v_email) then
    raise exception 'Ese correo ya pertenece a un miembro de este taller.'; end if;
  select user_id into existing_user from public.workshop_members m join auth.users u on u.id = m.user_id where lower(u.email) = v_email;
  if existing_user is not null then raise exception 'Esa persona ya pertenece a otro taller.'; end if;
  if (select count(*) from public.workshop_members where workshop_id = p_workshop_id) >= 20 then raise exception 'Este taller admite hasta 20 miembros.'; end if;
  -- Flip stale pending rows to 'expired' first: otherwise they keep occupying
  -- both the pending quota below and the ON CONFLICT slot above forever,
  -- since nothing else ever transitions a row past its expires_at.
  update public.workshop_invitations set status = 'expired' where workshop_id = p_workshop_id and status = 'pending' and expires_at <= now();
  if (select count(*) from public.workshop_invitations where workshop_id = p_workshop_id and status = 'pending') >= 20 then raise exception 'Demasiadas invitaciones pendientes.'; end if;
  insert into public.workshop_invitations(workshop_id, email, invited_by) values (p_workshop_id, v_email, auth.uid())
    on conflict (workshop_id, email) where status = 'pending' do update set created_at = now(), expires_at = now() + interval '7 days'
    returning id into v_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id, metadata)
    values (p_workshop_id, auth.uid(), 'member_invited', 'invitation', v_id, jsonb_build_object('email', v_email));
  return v_id;
end $$;
revoke all on function public.invite_member(uuid,text) from public, anon;
grant execute on function public.invite_member(uuid,text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_workshop uuid; v_status text; actor_role text;
begin
  -- Lock the row (regardless of status) before branching on it: accept_invitation
  -- takes the same row lock, so this blocks until any in-flight acceptance
  -- commits or rolls back, instead of racing an unconditional UPDATE against it
  -- and silently reverting an already-accepted membership back to 'revoked'.
  select workshop_id, status into v_workshop, v_status from public.workshop_invitations where id = p_invitation_id for update;
  if v_workshop is null then raise exception 'La invitación ya no está disponible.'; end if;
  select role into actor_role from public.workshop_members where workshop_id = v_workshop and user_id = auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  if actor_role <> 'owner' then raise exception 'Solo el propietario puede cancelar invitaciones.'; end if;
  if v_status = 'accepted' then raise exception 'Esa persona ya se unió al taller. Retírala desde la lista de miembros si quieres revocar su acceso.'; end if;
  if v_status <> 'pending' then raise exception 'La invitación ya no está disponible.'; end if;
  update public.workshop_invitations set status = 'revoked' where id = p_invitation_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id) values (v_workshop, auth.uid(), 'invitation_revoked', 'invitation', p_invitation_id);
end $$;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

commit;
