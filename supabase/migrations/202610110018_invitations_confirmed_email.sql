-- Invitations only for a confirmed email (security plan after the Strix
-- pentest, block C). An invitation is matched to the invitee by
-- auth.users.email alone (005), so whoever holds an account with that
-- address can see and accept it. With "Confirm email" on -- as in
-- production -- an unconfirmed account never gets a session, so this
-- already holds; this migration makes the rule explicit in the database
-- instead of depending only on that project setting.
--
-- What it covers: any session whose account has no confirmed email
-- (auth.users.email_confirmed_at is null): accounts created unconfirmed
-- through the admin API, accounts registered unconfirmed that a later
-- configuration change lets sign in, or any future sign-in method that
-- yields a session before the email is verified. What it does NOT cover:
-- with "Confirm email" turned off, Supabase marks every NEW sign-up as
-- confirmed on the spot (email_confirmed_at is set), so this check cannot
-- tell a real owner of the address from someone who just typed it --
-- keeping "Confirm email" on remains the actual protection.
--
-- This migration redefines, with the same signatures, security definer,
-- search_path and grants as 005:
-- 1. my_pending_invitation: an unconfirmed caller gets an error instead of
--    the invitation (no workshop name or inviter email for an address the
--    caller hasn't proven), and instead of null, which the app would read
--    as "no invitation" and route to onboarding -- where creating a
--    workshop would permanently block accepting the invitation later;
-- 2. accept_invitation and decline_invitation: rejected for an unconfirmed
--    caller (declining someone else's invitation would otherwise let the
--    address-typer cancel it).
-- Accounts that already belong to a workshop are unaffected: the app only
-- asks for a pending invitation when the caller has no membership, and
-- nothing here touches membership, roles or any other function.
-- Recovery: re-running the three definitions from 005 restores the
-- previous behaviour; no data is changed by this migration.
begin;

create or replace function public.my_pending_invitation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz; result jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_confirmed is null then raise exception 'Confirma tu correo electrónico antes de continuar.' using errcode = 'P0001'; end if;
  select jsonb_build_object('id', i.id, 'workshop_id', i.workshop_id, 'workshop_name', w.name, 'invited_by_email', u.email) into result
    from public.workshop_invitations i join public.workshops w on w.id = i.workshop_id join auth.users u on u.id = i.invited_by
    where lower(i.email) = lower(v_email) and i.status = 'pending' and i.expires_at > now() order by i.created_at desc limit 1;
  return result;
end $$;
revoke all on function public.my_pending_invitation() from public, anon;
grant execute on function public.my_pending_invitation() to authenticated;

-- Same body as 005 except the confirmation check right after reading the
-- caller's email, before the invitation row is even locked.
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

create or replace function public.decline_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_confirmed is null then raise exception 'Confirma tu correo electrónico antes de continuar.' using errcode = 'P0001'; end if;
  update public.workshop_invitations set status = 'revoked' where id = p_invitation_id and status = 'pending' and lower(email) = lower(v_email);
end $$;
revoke all on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.decline_invitation(uuid) to authenticated;

commit;
