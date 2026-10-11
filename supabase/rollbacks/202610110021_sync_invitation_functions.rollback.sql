-- Rollback of 202610110021_sync_invitation_functions.sql for the real
-- database ONLY. Never applied by tests or tooling: it lives outside
-- supabase/migrations on purpose. It re-creates the exact definitions that
-- production ran before 021 (read with pg_get_functiondef on 11 October
-- 2026). Production stores both bodies with CRLF line endings; this file
-- may have LF, which only changes the line endings. Check after applying
-- with md5(replace(prosrc, chr(13), '')): f865c7aec1906d3d057e1012f2126021
-- (invite_member) and c13eb2965915df1772fc089f3ccdf092 (revoke_invitation).
-- Same signatures and grants. No data to restore. Apply only with explicit
-- authorization, through scripts/apply-migration.mjs.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.invite_member(p_workshop_id uuid, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_role text; v_email text := lower(trim(p_email)); v_id uuid; existing_user uuid;
begin
  select role into actor_role from public.workshop_members where workshop_id = p_workshop_id and user_id = auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  if actor_role <> 'owner' then raise exception 'Solo el propietario puede invitar miembros.'; end if;
  perform 1 from public.workshops where id = p_workshop_id for update;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 255 then raise exception 'Introduce un correo válido.'; end if;
  -- One message for both cases (already a member here, or a member of a
  -- different workshop): a distinct message per case would let an owner use
  -- this form to enumerate which emails are registered anywhere in the
  -- system, not just in their own workshop.
  select user_id into existing_user from public.workshop_members m join auth.users u on u.id = m.user_id where lower(u.email) = v_email;
  if existing_user is not null then raise exception 'Esa persona ya pertenece a un taller.'; end if;
  if (select count(*) from public.workshop_members where workshop_id = p_workshop_id) >= 20 then raise exception 'Este taller admite hasta 20 miembros.'; end if;
  if (select count(*) from public.workshop_invitations where workshop_id = p_workshop_id and status = 'pending') >= 20 then raise exception 'Demasiadas invitaciones pendientes.'; end if;
  insert into public.workshop_invitations(workshop_id, email, invited_by) values (p_workshop_id, v_email, auth.uid())
    on conflict (workshop_id, email) where status = 'pending' do update set created_at = now(), expires_at = now() + interval '7 days'
    returning id into v_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id, metadata)
    values (p_workshop_id, auth.uid(), 'member_invited', 'invitation', v_id, jsonb_build_object('email', v_email));
  return v_id;
end $function$
;
revoke all on function public.invite_member(uuid,text) from public, anon;
grant execute on function public.invite_member(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_workshop uuid; actor_role text;
begin
  select workshop_id into v_workshop from public.workshop_invitations where id = p_invitation_id and status = 'pending';
  if v_workshop is null then raise exception 'La invitación ya no está disponible.'; end if;
  select role into actor_role from public.workshop_members where workshop_id = v_workshop and user_id = auth.uid();
  -- actor_role is null for anyone not a member of v_workshop at all (not just
  -- staff): "actor_role <> 'owner'" alone would evaluate to NULL for them,
  -- which PL/pgSQL's IF treats as false, silently skipping this check.
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  if actor_role <> 'owner' then raise exception 'Solo el propietario puede cancelar invitaciones.'; end if;
  update public.workshop_invitations set status = 'revoked' where id = p_invitation_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id) values (v_workshop, auth.uid(), 'invitation_revoked', 'invitation', p_invitation_id);
end $function$
;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

commit;
