-- Team management: staff invitations (email-matched, no outgoing email sent by this app)
-- and the RPCs the frontend uses to manage owner/staff membership.
-- Apply AFTER 202609200004_search_versions.sql. Additive only: does not alter
-- execute_command, workspace_snapshot or lookup_options.
begin;

alter table public.workshop_members add column invited_by uuid references auth.users(id);
alter table public.workshop_members add column created_at timestamptz not null default now();

create table public.workshop_invitations (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 255),
  role text not null default 'staff' check (role = 'staff'),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);
create unique index workshop_invitations_pending_unique on public.workshop_invitations(workshop_id, email) where status = 'pending';
create index workshop_invitations_email_pending on public.workshop_invitations(email) where status = 'pending';
create index workshop_invitations_tenant on public.workshop_invitations(workshop_id, created_at desc);

alter table public.workshop_invitations enable row level security;
-- Only the owner of the same workshop can list its invitations. The invited
-- person never reads this table directly; my_pending_invitation() below is
-- their only window, scoped to their own verified email.
create policy owner_invitations on public.workshop_invitations for select to authenticated
  using (workshop_id in (select workshop_id from public.workshop_members where user_id = (select auth.uid()) and role = 'owner'));
revoke all on public.workshop_invitations from public, anon, authenticated;
grant select on public.workshop_invitations to authenticated;

-- Roster for the caller's workshop. security definer: authenticated has no
-- direct grant on auth.users, so reading member emails needs the elevated
-- context, exactly like invite_member/accept_invitation below. The function
-- still enforces its own membership/role check before returning anything.
create function public.list_members(p_workshop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor_role text;
begin
  select role into actor_role from public.workshop_members where workshop_id = p_workshop_id and user_id = auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'email', u.email, 'created_at', m.created_at) order by m.created_at), '[]')
                from public.workshop_members m join auth.users u on u.id = m.user_id where m.workshop_id = p_workshop_id),
    'invitations', case when actor_role = 'owner' then
      (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'status', i.status, 'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at desc), '[]')
       from public.workshop_invitations i where i.workshop_id = p_workshop_id and i.status = 'pending' and i.expires_at > now())
      else '[]'::jsonb end);
end $$;
revoke all on function public.list_members(uuid) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;

-- Owner invites a staff member by email. Only ever creates a pending row;
-- TALLERIA does not send an email itself in this iteration.
create function public.invite_member(p_workshop_id uuid, p_email text) returns uuid
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

-- Owner cancels a pending invitation.
create function public.revoke_invitation(p_invitation_id uuid) returns void
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

-- Owner removes an existing member. The owner itself can never be removed
-- this way (no ownership transfer in this iteration).
create function public.remove_member(p_workshop_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  select role into actor_role from public.workshop_members where workshop_id = p_workshop_id and user_id = auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode = '42501'; end if;
  if actor_role <> 'owner' then raise exception 'Solo el propietario puede retirar miembros.'; end if;
  select role into target_role from public.workshop_members where workshop_id = p_workshop_id and user_id = p_user_id;
  if target_role is null then raise exception 'Esa persona no pertenece a este taller.'; end if;
  if target_role = 'owner' then raise exception 'No puedes retirar al propietario del taller.'; end if;
  delete from public.workshop_members where workshop_id = p_workshop_id and user_id = p_user_id;
  insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id) values (p_workshop_id, auth.uid(), 'member_removed', 'member', p_user_id);
end $$;
revoke all on function public.remove_member(uuid,uuid) from public, anon;
grant execute on function public.remove_member(uuid,uuid) to authenticated;

-- The invited person's only window onto invitations: scoped entirely to
-- their own verified auth.users.email, never a client-supplied value, and
-- takes no parameters, so there is nothing to manipulate.
create function public.my_pending_invitation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_email text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  select email into v_email from auth.users where id = auth.uid();
  select jsonb_build_object('id', i.id, 'workshop_id', i.workshop_id, 'workshop_name', w.name, 'invited_by_email', u.email) into result
    from public.workshop_invitations i join public.workshops w on w.id = i.workshop_id join auth.users u on u.id = i.invited_by
    where lower(i.email) = lower(v_email) and i.status = 'pending' and i.expires_at > now() order by i.created_at desc limit 1;
  return result;
end $$;
revoke all on function public.my_pending_invitation() from public, anon;
grant execute on function public.my_pending_invitation() to authenticated;

-- Accepting takes ONLY the invitation id. workshop_id and the matching email
-- are both derived server-side (from the invitation row and from
-- auth.users via auth.uid()) -- never from a client-supplied parameter --
-- so an invitation id cannot be replayed by anyone but the person it was
-- actually addressed to.
create function public.accept_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text; inv record; existing uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  select email into v_email from auth.users where id = auth.uid();
  select * into inv from public.workshop_invitations where id = p_invitation_id for update;
  if inv is null or inv.status <> 'pending' then raise exception 'La invitación ya no está disponible.'; end if;
  -- Expiry is enforced here on every attempt via expires_at, not via a status
  -- flip: an update immediately followed by this exception would be rolled
  -- back together with it (no savepoint), so it would never persist. Instead
  -- list_members() and my_pending_invitation() both filter expires_at > now(),
  -- which keeps a merely-stale 'pending' row from ever being shown or reused
  -- as accepted; a fresh invite_member() call still reuses the row via its
  -- ON CONFLICT upsert, refreshing expires_at as normal.
  if inv.expires_at <= now() then raise exception 'La invitación ha caducado. Pide al propietario que envíe una nueva.'; end if;
  -- A NULL v_email (no verified email on the account) must reject, not pass
  -- through: NULL <> inv.email evaluates to NULL, and `if NULL then` never
  -- fires its branch, which would let an emailless account silently accept
  -- anyone's invitation.
  if v_email is null then raise exception 'Esta invitación es para otro correo.'; end if;
  if lower(v_email) <> inv.email then raise exception 'Esta invitación es para otro correo.'; end if;
  select workshop_id into existing from public.workshop_members where user_id = auth.uid();
  if existing is not null then raise exception 'Tu cuenta ya pertenece a un taller.'; end if;
  -- Serialize concurrent acceptances into the same workshop (distinct lock
  -- space from the per-user lock above) so the capacity check below and the
  -- insert are atomic together: invite_member enforces the 20-member cap on
  -- invites, but nothing previously enforced it on acceptance.
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

-- Decline can only touch the caller's own invitation (email-matched), same
-- as accept.
create function public.decline_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.workshop_invitations set status = 'revoked' where id = p_invitation_id and status = 'pending' and lower(email) = lower(v_email);
end $$;
revoke all on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.decline_invitation(uuid) to authenticated;

commit;
