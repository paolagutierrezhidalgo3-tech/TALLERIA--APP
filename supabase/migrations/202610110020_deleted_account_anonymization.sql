-- Anonymization of a deleted account's personal data (data retention policy
-- decided by the user on 11 October 2026: keep only what is needed for legal
-- and audit reasons, anonymize or delete the rest). Depends on 019, which is
-- what makes deleting an account that took part in invitations possible.
--
-- After an account is deleted, its membership is already gone (ON DELETE
-- CASCADE) and invitation references become NULL (019). What still holds
-- personal data of that person is its email address in:
-- 1. workshop_invitations.email -- every invitation sent to that address, in
--    any workshop and status (accepted, pending, expired, revoked);
-- 2. audit_events.metadata->>'email' of 'member_invited' events (the only
--    audit event that stores a member's personal data; customer data in the
--    audit log is handled by the customer erasure of 011/015).
-- This migration adds a BEFORE DELETE trigger on auth.users. The deleted
-- person's addresses are its current email plus any address it accepted an
-- invitation with (it may have changed its email since, e.g. through Secure
-- email change), except an address that belongs to a different account
-- today. The trigger:
-- - replaces the email of every invitation accepted by this account (found by
--   accepted_by, whatever its address) and of every invitation sent to one
--   of those addresses with a fictitious, valid and unique one
--   ('cuenta-eliminada-<invitation id>@anonimizado.invalid', which satisfies
--   the table's lowercase/format check), and turns a still-pending one into
--   'revoked' (nobody can accept it any more); the rest of the row --
--   workshop, dates, status -- stays as the record of what happened;
-- - replaces the email in the 'member_invited' audit events of those
--   invitations or addresses with the text 'cuenta eliminada', keeping the
--   event itself.
-- It must be BEFORE DELETE: the ON DELETE SET NULL of 019 runs as an AFTER
-- trigger and would already have cleared accepted_by. If the deletion does
-- not go ahead -- 019's own BEFORE trigger refusing a workshop owner, or any
-- other error -- the whole statement rolls back and nothing stays
-- anonymized. An account without an email and without accepted invitations
-- is left alone. The affected invitations are locked before the audit log is
-- updated, so a re-invitation running at the same moment (which locks the
-- same pending row) finishes first and its event is anonymized too. Not
-- covered: a brand-new invitation to that address created in the very same
-- instant (no existing row to wait on) survives with the address, exactly
-- like an invitation to an address that never had an account.
-- It also redefines accept_invitation (body of 018 plus a first lock on the
-- caller's auth.users row) so that accepting and deleting the same account
-- take their locks in the same order and cannot deadlock.
-- Kept on purpose (provisional, pending professional review): the internal
-- account identifier (UUID) in audit_events.user_id / entity_id. Once the
-- account is deleted nothing left in the database links it to a person, and
-- it still shows which actions were done by the same (deleted) member.
-- Closing a workshop deletes all of its invitations and audit events in
-- cascade before the owner's account can be deleted, so for an owner this
-- only touches invitations of other workshops.
-- Existing data: an account deleted after 019 and before this migration
-- keeps its email. The backfill at the end covers the case that can be
-- recognised: an accepted invitation whose accepted_by is NULL can only come
-- from a deleted account (accept_invitation always sets it; 019 nulls it).
-- Its address -- in every invitation sent to it and in 'member_invited'
-- events -- is anonymized the same way, except an address that has an
-- account again today. Limitation: a deleted account that only had pending
-- invitations leaves no reliable trace (an invitation to an address without
-- an account can just as well be for someone who never signed up), so it is
-- not backfilled; the production procedure checks beforehand that no such
-- data exists and applies 019 and 020 together.
-- Recovery: drop the trigger and the function; anonymized values cannot be
-- restored (by design).
begin;
set local lock_timeout = '5s';

create function public.anonymize_deleted_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_emails text[];
begin
  -- Addresses of this person: the current one plus any it accepted an
  -- invitation with (it may have changed its email since), except an address
  -- that belongs to a different account today.
  select coalesce(array_agg(distinct s.e), '{}') into v_emails
    from (select lower(trim(old.email)) as e where nullif(trim(old.email), '') is not null
          union
          select i.email from public.workshop_invitations i where i.accepted_by = old.id) s
   where not exists (select 1 from auth.users u where u.id <> old.id and lower(u.email) = s.e);
  -- Lock the affected invitations before touching the audit log: a
  -- concurrent re-invitation (invite_member's ON CONFLICT on a pending row)
  -- holds that row until it commits together with its new 'member_invited'
  -- event, so waiting here makes the audit update below see that event.
  perform 1 from public.workshop_invitations
   where accepted_by = old.id or email = any(v_emails)
     for update;
  -- Audit first, while accepted_by still links this person's invitations.
  update public.audit_events
     set metadata = jsonb_set(metadata, '{email}', to_jsonb('cuenta eliminada'::text))
   where action = 'member_invited'
     and (metadata->>'email' = any(v_emails)
          or entity_id in (select i.id from public.workshop_invitations i where i.accepted_by = old.id));
  update public.workshop_invitations
     set email = 'cuenta-eliminada-' || replace(id::text, '-', '') || '@anonimizado.invalid',
         status = case when status = 'pending' then 'revoked' else status end
   where accepted_by = old.id or email = any(v_emails);
  return old;
end $$;
revoke all on function public.anonymize_deleted_account() from public, anon, authenticated;

create trigger anonymize_deleted_account
  before delete on auth.users
  for each row execute function public.anonymize_deleted_account();

-- Same body as 018 plus one first step: lock the caller's own auth.users row
-- (FOR KEY SHARE, the same lock its workshop_members insert takes later
-- through the foreign key) before locking the invitation. Deleting the
-- account locks that row first and then the invitations (trigger above);
-- without this, accepting an invitation in the very instant the account is
-- deleted takes the same two locks in the opposite order and PostgreSQL
-- aborts one of them as a deadlock. If the account is deleted while this
-- waits, the row is gone and the call ends here.
create or replace function public.accept_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz; inv record; existing uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  perform 1 from auth.users where id = auth.uid() for key share;
  if not found then raise exception 'Debes iniciar sesión.'; end if;
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

-- Backfill for accounts deleted between 019 and this migration (see above).
create temporary table deleted_account_emails on commit drop as
  select distinct i.email from public.workshop_invitations i
   where i.status = 'accepted' and i.accepted_by is null
     and i.email not like 'cuenta-eliminada-%'
     and not exists (select 1 from auth.users u where lower(u.email) = i.email);
update public.audit_events e
   set metadata = jsonb_set(e.metadata, '{email}', to_jsonb('cuenta eliminada'::text))
 where e.action = 'member_invited' and e.metadata->>'email' in (select email from deleted_account_emails);
update public.workshop_invitations
   set email = 'cuenta-eliminada-' || replace(id::text, '-', '') || '@anonimizado.invalid',
       status = case when status = 'pending' then 'revoked' else status end
 where email in (select email from deleted_account_emails);

commit;
